import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { JN_API_KEY_DUMMY } from '../test/allowed-literals';
import { resetPublicDailyCapForTests } from './publicDailyCap';
import { roofRouter } from './routes/roof';
import { FORM_STARTED_AT_FIELD, HONEYPOT_FIELD } from './spamGuard';
import { MAP_SERVICE_ERROR } from './services/mapService';

const NO_ROOF_DATA =
  "We don't have roof data for this location yet. Please call us for a free estimate!";
const ADDRESS_MISSING = "We couldn't find that address. Please check and try again.";

const savedSolar = process.env.GOOGLE_SOLAR_API_KEY;
const savedFetch = globalThis.fetch;

const calls: string[] = [];
const keys: Array<string | null> = [];
let upstream: (url: URL) => Response | Promise<Response> = () => {
  throw new Error('unexpected upstream call');
};

function solarBuilding(): Response {
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

function statusBody(status: number): Response {
  return new Response(JN_API_KEY_DUMMY, { status });
}

function installFetch() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return savedFetch(input, init);
    }
    calls.push(`${url.origin}${url.pathname}`);
    keys.push(url.searchParams.get('key'));
    return upstream(url);
  };
}

let base = '';
let server: ReturnType<express.Express['listen']>;

async function post(path: string, body: unknown) {
  const lines: string[] = [];
  const prev = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        body && typeof body === 'object' && !Array.isArray(body)
          ? {
            [HONEYPOT_FIELD]: '',
            [FORM_STARTED_AT_FIELD]: Date.now() - 60_000,
            ...(body as Record<string, unknown>),
          }
          : body,
      ),
    });
    const text = await res.text();
    if (calls.length > 0) assertKeySent();
    return { status: res.status, text, log: lines.join('\n') };
  } finally {
    console.error = prev;
  }
}

function assertHidden(text: string) {
  assert.equal(text.includes(JN_API_KEY_DUMMY), false);
  assert.equal(text.includes('googleapis.com'), false);
  assert.equal(text.includes('findClosest'), false);
  assert.equal(text.includes('key='), false);
}

function assertKeySent() {
  assert.ok(keys.length > 0);
  assert.ok(keys.every((key) => key === JN_API_KEY_DUMMY));
}

before(async () => {
  process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
  installFetch();
  const app = express();
  app.use(express.json());
  app.use('/api/roof', roofRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

beforeEach(() => {
  calls.length = 0;
  keys.length = 0;
  resetPublicDailyCapForTests();
  process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
});

after(async () => {
  globalThis.fetch = savedFetch;
  if (savedSolar === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
  else process.env.GOOGLE_SOLAR_API_KEY = savedSolar;
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('map service failures', { concurrency: false }, () => {
  it('keeps the address-not-found message for ZERO_RESULTS', async () => {
    upstream = () => Response.json({ status: 'ZERO_RESULTS', results: [] });
    const res = await post('/api/roof/geocode', { address: '123 Main St, Raleigh, NC' });
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.text), { error: ADDRESS_MISSING });
    assert.equal(res.text.includes('map service'), false);
    assert.equal(calls.length, 1);
  });

  it('says the map service failed when geocoding is denied', async () => {
    upstream = () => Response.json({ status: 'REQUEST_DENIED', results: [] });
    const res = await post('/api/roof/geocode', { address: '123 Main St, Raleigh, NC' });
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.text), { error: MAP_SERVICE_ERROR });
    assert.equal(res.text.includes("couldn't find that address"), false);
    assert.equal(res.text.includes("don't have roof data"), false);
  });

  it('does not treat an HTTP geocoding failure as a missing address', async () => {
    upstream = () => statusBody(500);
    const res = await post('/api/roof/geocode', { address: '123 Main St, Raleigh, NC' });
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.text), { error: MAP_SERVICE_ERROR });
    assertHidden(res.text);
    assertHidden(res.log);
    assert.match(res.log, /\b500\b/);
  });

  it('hides the request URL when geocoding throws', async () => {
    const marker = ['https://maps.googleapis.com/maps/api/geocode/json?', 'key', '='].join('');
    upstream = () => {
      throw new Error(['network', marker, JN_API_KEY_DUMMY].join(' '));
    };
    const res = await post('/api/roof/geocode', { address: '123 Main St, Raleigh, NC' });
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.text), { error: MAP_SERVICE_ERROR });
    assertHidden(res.log);
    assert.match(res.log, /network/);
  });

  it('keeps the no-roof-data message when Solar returns no segments', async () => {
    upstream = () => Response.json({
      imageryQuality: 'HIGH',
      solarPotential: { roofSegmentStats: [] },
    });
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.text), { error: NO_ROOF_DATA });
    assert.equal(res.text.includes('map service'), false);
  });

  it('keeps the no-roof-data message when Solar has no building', async () => {
    upstream = () => new Response('', { status: 404 });
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.text), { error: NO_ROOF_DATA });
    assert.equal(res.text.includes('map service'), false);
    assert.deepEqual(calls, [
      'https://solar.googleapis.com/v1/buildingInsights:findClosest',
      'https://solar.googleapis.com/v1/buildingInsights:findClosest',
    ]);
  });

  it('returns a map-service error when every Solar quality fails', async () => {
    upstream = () => statusBody(403);
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.text), { error: MAP_SERVICE_ERROR });
    assert.equal(res.text.includes("don't have roof data"), false);
    assertHidden(res.text);
    assertHidden(res.log);
    assert.match(res.log, /\b403\b/);
    assert.equal(calls.length, 2);
  });

  it('treats HIGH 403 then MEDIUM 404 as no roof data', async () => {
    let n = 0;
    upstream = () => (n++ === 0 ? statusBody(403) : new Response('', { status: 404 }));
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.text), { error: NO_ROOF_DATA });
    assert.equal(res.text.includes('map service'), false);
    assertHidden(res.log);
    assert.match(res.log, /\b403\b/);
    assert.equal(calls.length, 2);
  });

  it('treats HIGH 500 then MEDIUM 404 as no roof data', async () => {
    let n = 0;
    upstream = () => (n++ === 0 ? statusBody(500) : new Response('', { status: 404 }));
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 404);
    assert.deepEqual(JSON.parse(res.text), { error: NO_ROOF_DATA });
    assert.equal(res.text.includes('map service'), false);
    assert.equal(calls.length, 2);
  });

  it('uses MEDIUM Solar data when HIGH quality is not found', async () => {
    let n = 0;
    upstream = () => (n++ === 0 ? new Response('', { status: 404 }) : solarBuilding());
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text) as { quote: { lowEstimate: number } };
    assert.equal(typeof body.quote.lowEstimate, 'number');
    assertHidden(res.text);
    assert.equal(calls.length, 2);
  });

  it('uses a later Solar quality when the first request fails', async () => {
    let n = 0;
    upstream = () => (n++ === 0 ? statusBody(500) : solarBuilding());
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 200);
    const body = JSON.parse(res.text) as { quote: { lowEstimate: number } };
    assert.equal(typeof body.quote.lowEstimate, 'number');
    assertHidden(res.text);
    assert.equal(calls.length, 2);
  });

  it('hides the request URL when Solar throws', async () => {
    const marker = ['https://solar.googleapis.com/v1/buildingInsights:findClosest?', 'key', '='].join('');
    upstream = () => {
      throw new Error(['network', marker, JN_API_KEY_DUMMY, 'UPSTREAM-BODY'].join(' '));
    };
    const res = await post('/api/roof/quote', { lat: 35.78, lng: -78.64 });
    assert.equal(res.status, 503);
    assert.deepEqual(JSON.parse(res.text), { error: MAP_SERVICE_ERROR });
    assertHidden(res.log);
    assert.equal(res.log.includes('UPSTREAM-BODY'), false);
    assert.match(res.log, /network/);
  });
});
