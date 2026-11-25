import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import session from 'express-session';
import sharp from 'sharp';
import { ENV_EXAMPLE_API_KEY_PLACEHOLDER, GEMINI_API_KEY_DUMMY, JN_API_KEY_DUMMY } from './allowed-literals';
import { ANALYSIS_UNAVAILABLE_MESSAGE, GEMINI_MODEL } from '../server/services/gemini';
import { mountRoofRoutes } from '../server/mountRoof';

const savedEnv = {
  solar: process.env.GOOGLE_SOLAR_API_KEY,
  browser: process.env.GOOGLE_MAPS_BROWSER_KEY,
  gemini: process.env.GEMINI_API_KEY,
  roof: process.env.ROOF_API_KEY,
};

type GeminiMode = 'success' | 'bad-key' | 'quota' | 'not-found' | 'invalid-json' | 'timeout' | 'safety' | 'partial' | 'mistyped';
type SolarMode = 'ok' | 'missing' | 'throw';

let originalFetch: typeof fetch;
let originalError: typeof console.error;
const outbound: string[] = [];
const geminiCalls: { url: string; search: string; apiKey: string | null; body: string }[] = [];
const errorLogs: string[] = [];
const resendBodies: string[] = [];
let geminiMode: GeminiMode = 'success';
let solarMode: SolarMode = 'ok';

const SAMPLE_ANALYSIS = {
  roofType: 'gable',
  material: { type: 'asphalt shingle', condition: 'fair' },
  features: [],
  complexity: { rating: 2, explanation: 'simple gable' },
  damage: [],
  accessIssues: [],
  estimatedStories: 1,
  overallCondition: { rating: 'fair', notes: 'wear along the ridge' },
  recommendations: ['Replace the ridge cap'],
  sidingMaterial: 'vinyl',
  sidingCondition: { rating: 'good', notes: 'intact' },
  sidingDamage: [],
  estimatedWallArea: 1800,
  sidingRecommendations: [],
  estimatedFacets: 2,
};

function geminiError(status: number, errorStatus: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code: status, status: errorStatus, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchMock() {
  originalFetch = globalThis.fetch;
  outbound.length = 0;
  geminiCalls.length = 0;
  resendBodies.length = 0;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return originalFetch(input, init);
    }
    outbound.push(`${url.origin}${url.pathname}`);
    if (url.hostname === 'api.resend.com') {
      resendBodies.push(typeof init?.body === 'string' ? init.body : '');
      return Response.json({ id: 'email-1' });
    }
    if (url.hostname === 'solar.googleapis.com' && url.pathname === '/v1/buildingInsights:findClosest') {
      if (solarMode === 'throw') throw new Error('solar down');
      if (solarMode === 'missing') return new Response('{}', { status: 404 });
      return Response.json({
        imageryQuality: 'HIGH',
        solarPotential: {
          roofSegmentStats: [{
            pitchDegrees: 20,
            azimuthDegrees: 180,
            stats: { areaMeters2: 100 },
          }],
        },
      });
    }
    if (url.hostname === 'generativelanguage.googleapis.com') {
      const headers = new Headers(init?.headers);
      geminiCalls.push({
        url: `${url.origin}${url.pathname}`,
        search: url.search,
        apiKey: headers.get('x-goog-api-key'),
        body: typeof init?.body === 'string' ? init.body : '',
      });
      if (geminiMode === 'bad-key') {
        return geminiError(400, 'INVALID_ARGUMENT', `API key not valid. Please pass a valid API key. ${GEMINI_API_KEY_DUMMY}`);
      }
      if (geminiMode === 'quota') {
        return geminiError(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota, please check your plan and billing details.');
      }
      if (geminiMode === 'not-found') {
        return geminiError(404, 'NOT_FOUND', `models/${GEMINI_MODEL} is not found for API version v1beta, or is not supported for generateContent.`);
      }
      if (geminiMode === 'timeout') {
        const timeout = new Error('The operation was aborted due to timeout');
        timeout.name = 'TimeoutError';
        throw timeout;
      }
      if (geminiMode === 'safety') {
        return Response.json({ promptFeedback: { blockReason: 'SAFETY' }, candidates: [] });
      }
      if (geminiMode === 'partial') {
        return Response.json({
          candidates: [{ content: { parts: [{ text: '{"roofType":"gable"}' }] }, finishReason: 'STOP' }],
        });
      }
      if (geminiMode === 'mistyped') {
        return Response.json({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ ...SAMPLE_ANALYSIS, features: 'none' }) }] },
            finishReason: 'STOP',
          }],
        });
      }
      if (geminiMode === 'invalid-json') {
        return Response.json({
          candidates: [{ content: { parts: [{ text: 'not json' }] }, finishReason: 'STOP' }],
        });
      }
      return Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify(SAMPLE_ANALYSIS) }] }, finishReason: 'STOP' }],
      });
    }
    throw new Error(`blocked outbound ${url.origin}${url.pathname}`);
  };
}

function app() {
  const server = express();
  server.set('trust proxy', 1);
  server.use(express.json());
  server.use(session({
    secret: JN_API_KEY_DUMMY,
    resave: false,
    saveUninitialized: false,
  }));
  server.post('/login', (req, res) => {
    (req.session as { userId?: number }).userId = 7;
    res.json({ ok: true });
  });
  mountRoofRoutes(server);
  return server;
}

async function withServer(fn: (base: string) => Promise<void>) {
  const server = app().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function login(base: string): Promise<string> {
  const res = await fetch(`${base}/login`, { method: 'POST' });
  const cookie = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';')[0];
}

async function photoForm(): Promise<FormData> {
  const jpeg = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 180, g: 40, b: 40 } },
  }).jpeg().toBuffer();
  const form = new FormData();
  form.append('photos', new File([jpeg], 'front.jpg', { type: 'image/jpeg' }));
  form.append('lat', '35.78');
  form.append('lng', '-78.64');
  form.append('address', '123 Main St, Raleigh, NC');
  return form;
}

function assertSecretHidden(text: string) {
  assert.equal(text.includes(GEMINI_API_KEY_DUMMY), false);
  assert.equal(text.includes(JN_API_KEY_DUMMY), false);
}

beforeEach(() => {
  process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
  process.env.GOOGLE_MAPS_BROWSER_KEY = ENV_EXAMPLE_API_KEY_PLACEHOLDER;
  process.env.GEMINI_API_KEY = GEMINI_API_KEY_DUMMY;
  delete process.env.ROOF_API_KEY;
  geminiMode = 'success';
  solarMode = 'ok';
  errorLogs.length = 0;
  originalError = console.error;
  console.error = (...args: unknown[]) => {
    errorLogs.push(args.map((arg) => String(arg)).join(' '));
  };
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.error = originalError;
});

after(() => {
  if (savedEnv.solar === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
  else process.env.GOOGLE_SOLAR_API_KEY = savedEnv.solar;
  if (savedEnv.browser === undefined) delete process.env.GOOGLE_MAPS_BROWSER_KEY;
  else process.env.GOOGLE_MAPS_BROWSER_KEY = savedEnv.browser;
  if (savedEnv.gemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedEnv.gemini;
  if (savedEnv.roof === undefined) delete process.env.ROOF_API_KEY;
  else process.env.ROOF_API_KEY = savedEnv.roof;
});

describe('inspect photo analysis and address reports', { concurrency: false }, () => {
  it('keeps the public quote response on roof data and quote only', async () => {
    await withServer(async (base) => {
      const res = await fetch(`${base}/api/roof/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
        body: JSON.stringify({ lat: 35.78, lng: -78.64 }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      const body = JSON.parse(text) as { quote: { lowEstimate: number }; roofData: { totalAreaSqFt: number } };
      assert.deepEqual(Object.keys(body).sort(), ['lat', 'lng', 'quote', 'roofData']);
      assert.equal(body.roofData.totalAreaSqFt, 1076);
      assert.equal(typeof body.quote.lowEstimate, 'number');
      assert.equal(geminiCalls.length, 0);
      assert.equal(outbound.some((url) => url.includes('anthropic.com')), false);
      assertSecretHidden(text);
    });
  });

  it('builds a roof report from an address with zero photos and does not call Gemini', async () => {
    delete process.env.GEMINI_API_KEY;
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/address-report`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
        body: JSON.stringify({ lat: 35.78, lng: -78.64, address: '123 Main St, Raleigh, NC' }),
      });
      const text = await res.text();
      assert.equal(res.status, 200);
      const body = JSON.parse(text) as {
        address: string;
        analysis: null;
        roofData: { totalAreaSqFt: number; segments: number };
        quote: { roofSquares: number; lowEstimate: number; highEstimate: number; pitchOver12: number };
        buildingMeasurements: { measurementSource: string; stories: number; calculatedWallArea: number };
      };
      assert.equal(body.address, '123 Main St, Raleigh, NC');
      assert.equal(body.analysis, null);
      assert.equal(body.roofData.totalAreaSqFt, 1076);
      assert.equal(body.roofData.segments, 1);
      assert.ok(body.quote.roofSquares > 0);
      assert.ok(body.quote.lowEstimate > 0);
      assert.ok(body.quote.highEstimate >= body.quote.lowEstimate);
      assert.equal(body.quote.pitchOver12, 4.4);
      assert.equal(body.buildingMeasurements.measurementSource, 'satellite');
      assert.equal(body.buildingMeasurements.stories, 2);
      assert.ok(body.buildingMeasurements.calculatedWallArea > 0);
      assert.equal(geminiCalls.length, 0);
      assert.deepEqual(outbound, [
        'https://solar.googleapis.com/v1/buildingInsights:findClosest',
      ]);
      assert.equal(outbound.some((url) => url.includes('anthropic.com')), false);
      assertSecretHidden(text);
    });
  });

  it('returns Gemini analysis in the shape the inspect page expects', async () => {
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.12' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 200, text);
      const body = JSON.parse(text) as {
        analysis: { roofType: string; material: { type: string }; estimatedStories: number; estimatedWallArea: number };
        buildingMeasurements: { stories: number; measurementSource: string; calculatedWallArea: number };
      };
      assert.equal(body.analysis.roofType, 'gable');
      assert.equal(body.analysis.material.type, 'asphalt shingle');
      assert.equal(body.analysis.estimatedStories, 1);
      assert.equal(body.buildingMeasurements.stories, 1);
      assert.equal(body.buildingMeasurements.measurementSource, 'satellite');
      assert.equal(body.buildingMeasurements.calculatedWallArea, body.analysis.estimatedWallArea);
      assert.equal(geminiCalls.length, 1);
      assert.equal(
        geminiCalls[0].url,
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      );
      assert.equal(geminiCalls[0].search, '');
      assert.equal(geminiCalls[0].apiKey, GEMINI_API_KEY_DUMMY);
      assert.notEqual(geminiCalls[0].apiKey, JN_API_KEY_DUMMY);
      const request = JSON.parse(geminiCalls[0].body) as {
        systemInstruction: { parts: { text: string }[] };
        contents: { parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> }[];
        generationConfig: {
          responseMimeType: string;
          thinkingConfig: { thinkingLevel: string };
          responseSchema: { type: string; required: string[] };
        };
      };
      assert.equal(request.generationConfig.responseMimeType, 'application/json');
      assert.equal(request.generationConfig.responseSchema.type, 'OBJECT');
      assert.ok(request.generationConfig.responseSchema.required.includes('features'));
      assert.ok(request.generationConfig.responseSchema.required.includes('material'));
      assert.equal(request.generationConfig.thinkingConfig.thinkingLevel, 'MINIMAL');
      assert.match(request.systemInstruction.parts[0].text, /roofing and siding inspector/);
      const image = request.contents[0].parts.find((part) => part.inlineData);
      assert.equal(image?.inlineData?.mimeType, 'image/jpeg');
      assert.ok(image?.inlineData?.data);
      assert.equal(outbound.some((url) => url.includes('anthropic.com')), false);
      assert.equal(outbound.some((url) => url.includes('api.openai.com')), false);
      assertSecretHidden(text);
    });
  });

  it('logs a missing Gemini key and keeps a friendly response', async () => {
    delete process.env.GEMINI_API_KEY;
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.13' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      assert.equal(geminiCalls.length, 0);
      assert.match(errorLogs.join('\n'), /Gemini API error \(missing key\): GEMINI_API_KEY is not set/);
      assertSecretHidden(text + errorLogs.join('\n'));
    });
  });

  it('logs a bad Gemini key without echoing it', async () => {
    geminiMode = 'bad-key';
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.14' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      const logged = errorLogs.join('\n');
      assert.match(logged, /Gemini API error \(bad key\):/);
      assert.match(logged, /http=400/);
      assert.match(logged, /status=INVALID_ARGUMENT/);
      assert.match(logged, /\[redacted\]/);
      assertSecretHidden(text + logged);
    });
  });

  it('logs Gemini quota errors and returns the friendly message', async () => {
    geminiMode = 'quota';
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.15' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      const logged = errorLogs.join('\n');
      assert.match(logged, /Gemini API error \(quota\):/);
      assert.match(logged, /http=429/);
      assert.match(logged, /status=RESOURCE_EXHAUSTED/);
      assert.equal(text.includes('RESOURCE_EXHAUSTED'), false);
      assertSecretHidden(text + logged);
    });
  });

  it('logs a missing Gemini model and returns the friendly message', async () => {
    geminiMode = 'not-found';
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.16' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      const logged = errorLogs.join('\n');
      assert.match(logged, /Gemini API error \(model not found\):/);
      assert.match(logged, /http=404/);
      assert.match(logged, /status=NOT_FOUND/);
      assert.match(logged, new RegExp(`model=${GEMINI_MODEL}`));
      assertSecretHidden(text + logged);
    });
  });

  it('logs an unparseable Gemini analysis and returns the friendly message', async () => {
    geminiMode = 'invalid-json';
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.17' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      assert.match(errorLogs.join('\n'), /Gemini API error \(invalid response\):/);
      assert.match(errorLogs.join('\n'), /could not parse analysis JSON/);
      assertSecretHidden(text);
    });
  });

  it('logs a Gemini timeout and returns the friendly message', async () => {
    geminiMode = 'timeout';
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.18' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      assert.match(errorLogs.join('\n'), /Gemini API error \(timeout\):/);
      assertSecretHidden(text);
    });
  });

  it('logs a Gemini safety block and returns the friendly message', async () => {
    geminiMode = 'safety';
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.19' },
        body: await photoForm(),
      });
      const text = await res.text();
      assert.equal(res.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      assert.match(errorLogs.join('\n'), /Gemini API error \(safety block\):/);
      assert.match(errorLogs.join('\n'), /blockReason=SAFETY/);
      assertSecretHidden(text);
    });
  });

  it('rejects partial and mis-typed Gemini JSON', async () => {
    geminiMode = 'partial';
    await withServer(async (base) => {
      const cookie = await login(base);
      const partial = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.20' },
        body: await photoForm(),
      });
      const partialText = await partial.text();
      assert.equal(partial.status, 503);
      assert.deepEqual(JSON.parse(partialText), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      assert.match(errorLogs.join('\n'), /analysis failed validation/);
      assertSecretHidden(partialText);
    });

    geminiMode = 'mistyped';
    errorLogs.length = 0;
    await withServer(async (base) => {
      const cookie = await login(base);
      const mistyped = await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: { cookie, 'x-forwarded-for': '203.0.113.21' },
        body: await photoForm(),
      });
      const text = await mistyped.text();
      assert.equal(mistyped.status, 503);
      assert.deepEqual(JSON.parse(text), { error: ANALYSIS_UNAVAILABLE_MESSAGE });
      assert.match(errorLogs.join('\n'), /analysis failed validation/);
    });
  });

  it('keeps address reports behind a staff session and reports missing roof data', async () => {
    await withServer(async (base) => {
      const loggedOut = await fetch(`${base}/api/roof/address-report`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.22' },
        body: JSON.stringify({ lat: 35.78, lng: -78.64 }),
      });
      assert.equal(loggedOut.status, 401);
      await loggedOut.text();

      const cookie = await login(base);
      const bad = await fetch(`${base}/api/roof/address-report`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.23' },
        body: JSON.stringify({ lat: 'north' }),
      });
      const badText = await bad.text();
      assert.equal(bad.status, 400);
      assert.deepEqual(JSON.parse(badText), { error: 'Invalid coordinates.' });

      solarMode = 'missing';
      const missing = await fetch(`${base}/api/roof/address-report`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.24' },
        body: JSON.stringify({ lat: 35.78, lng: -78.64, address: '123 Main St, Raleigh, NC' }),
      });
      const missingText = await missing.text();
      assert.equal(missing.status, 404);
      assert.deepEqual(JSON.parse(missingText), {
        error: "We don't have roof data for this location yet. Call K&D Roofing at (919) 977-4074 to schedule a documented inspection.",
      });

      solarMode = 'throw';
      const broken = await fetch(`${base}/api/roof/address-report`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.25' },
        body: JSON.stringify({ lat: 35.78, lng: -78.64 }),
      });
      const brokenText = await broken.text();
      assert.equal(broken.status, 500);
      assert.equal(JSON.parse(brokenText).error.includes('call us for a free estimate'), false);
    });
  });

  it('words a zero-photo email as a roof report', async () => {
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/send-report`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.26' },
        body: JSON.stringify({
          address: '123 Main St, Raleigh, NC',
          roofData: { totalAreaSqFt: 1076, segments: 1 },
          quote: { lowEstimate: 5600, highEstimate: 6900, roofSquares: 12.4, pitchOver12: 4.4 },
          analysis: null,
        }),
      });
      assert.equal(res.status, 200);
      await res.text();
      const sent = JSON.parse(resendBodies[0]) as { subject: string; html: string };
      assert.equal(sent.subject, 'Roof Report — 123 Main St, Raleigh, NC');
      assert.equal(sent.subject.includes('Roof & Siding Inspection'), false);
      assert.equal(sent.html.includes('Complete Property Measurements'), false);
      assert.match(sent.html, /Roof Report/);
      assert.match(sent.html, /K&D Roofing|K&amp;D Roofing|K&D <span/);
      assert.match(sent.html, /No inspection photos were included/);
    });
  });

  it('says photo analysis was unavailable when photos were attached but Gemini failed', async () => {
    await withServer(async (base) => {
      const cookie = await login(base);
      const res = await fetch(`${base}/api/roof/send-report`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.27' },
        body: JSON.stringify({
          address: '123 Main St, Raleigh, NC',
          roofData: { totalAreaSqFt: 1076, segments: 1 },
          quote: { lowEstimate: 5600, highEstimate: 6900, roofSquares: 12.4, pitchOver12: 4.4 },
          analysis: null,
          photoAnalysisUnavailable: true,
        }),
      });
      assert.equal(res.status, 200);
      await res.text();
      const sent = JSON.parse(resendBodies[0]) as { html: string };
      assert.match(sent.html, /Photo analysis was unavailable/);
      assert.equal(sent.html.includes('No inspection photos were included'), false);
      assert.equal(sent.html.includes('Add photos'), false);
    });
  });
});
