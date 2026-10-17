import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import session from 'express-session';
import { ENV_EXAMPLE_API_KEY_PLACEHOLDER, JN_API_KEY_DUMMY } from '../test/allowed-literals';
import { mountRoofRoutes } from './mountRoof';

const savedEnv = {
  solar: process.env.GOOGLE_SOLAR_API_KEY,
  browser: process.env.GOOGLE_MAPS_BROWSER_KEY,
  roof: process.env.ROOF_API_KEY,
};

let originalFetch: typeof fetch;
const outbound: string[] = [];
let solarKeyUsedOnServer = false;

function solarKey(): string {
  return process.env.GOOGLE_SOLAR_API_KEY || '';
}

function installFetchMock() {
  originalFetch = globalThis.fetch;
  outbound.length = 0;
  solarKeyUsedOnServer = false;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return originalFetch(input, init);
    }
    const hostPath = `${url.origin}${url.pathname}`;
    outbound.push(hostPath);
    if (solarKey() && url.searchParams.get('key') === solarKey()) {
      solarKeyUsedOnServer = true;
    }
    if (url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/geocode/json') {
      return Response.json({
        status: 'OK',
        results: [{
          formatted_address: '123 Main St, Raleigh, NC',
          geometry: { location: { lat: 35.78, lng: -78.64 } },
        }],
      });
    }
    if (url.hostname === 'solar.googleapis.com' && url.pathname === '/v1/buildingInsights:findClosest') {
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
    throw new Error(`blocked outbound ${hostPath}`);
  };
}

function widgetApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use(session({
    secret: JN_API_KEY_DUMMY,
    resave: false,
    saveUninitialized: false,
  }));
  app.post('/login', (_req, res) => {
    (_req.session as { userId?: number }).userId = 7;
    res.json({ ok: true });
  });
  mountRoofRoutes(app);
  return app;
}

async function withServer(fn: (base: string) => Promise<void>) {
  const server = widgetApp().listen(0, '127.0.0.1');
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

function headerText(res: Response): string {
  return [...res.headers.entries()].map(([name, value]) => `${name}: ${value}`).join('\n');
}

function assertSolarKeyHidden(body: string, headers: string) {
  const key = solarKey();
  assert.ok(key.length > 0);
  assert.equal(body.includes(key), false);
  assert.equal(headers.includes(key), false);
}

async function read(res: Response) {
  const text = await res.text();
  const headers = headerText(res);
  assertSolarKeyHidden(text, headers);
  return { status: res.status, text, headers };
}

before(() => {
  process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
  process.env.GOOGLE_MAPS_BROWSER_KEY = ENV_EXAMPLE_API_KEY_PLACEHOLDER;
  delete process.env.ROOF_API_KEY;
});

beforeEach(() => {
  process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
  process.env.GOOGLE_MAPS_BROWSER_KEY = ENV_EXAMPLE_API_KEY_PLACEHOLDER;
  delete process.env.ROOF_API_KEY;
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

after(() => {
  if (savedEnv.solar === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
  else process.env.GOOGLE_SOLAR_API_KEY = savedEnv.solar;
  if (savedEnv.browser === undefined) delete process.env.GOOGLE_MAPS_BROWSER_KEY;
  else process.env.GOOGLE_MAPS_BROWSER_KEY = savedEnv.browser;
  if (savedEnv.roof === undefined) delete process.env.ROOF_API_KEY;
  else process.env.ROOF_API_KEY = savedEnv.roof;
});

describe('public quote widget', { concurrency: false }, () => {
  it('serves maps-key, geocode, and quote to a logged-out visitor', async () => {
    await withServer(async (base) => {
      const ip = { 'x-forwarded-for': '203.0.113.81' };
      const maps = await read(await fetch(`${base}/api/roof/maps-key`, { headers: ip }));
      assert.equal(maps.status, 200);
      const mapsBody = JSON.parse(maps.text) as { key: string };
      assert.equal(mapsBody.key, ENV_EXAMPLE_API_KEY_PLACEHOLDER);
      assert.notEqual(mapsBody.key, JN_API_KEY_DUMMY);

      const geocode = await read(await fetch(`${base}/api/roof/geocode`, {
        method: 'POST',
        headers: { ...ip, 'content-type': 'application/json' },
        body: JSON.stringify({ address: '123 Main St, Raleigh, NC' }),
      }));
      assert.equal(geocode.status, 200);
      const located = JSON.parse(geocode.text) as { address: string; lat: number; lng: number };
      assert.equal(located.address, '123 Main St, Raleigh, NC');
      assert.equal(located.lat, 35.78);
      assert.equal(located.lng, -78.64);

      const wrongKey = 'x-' + 'api-key';
      const quote = await read(await fetch(`${base}/api/roof/quote`, {
        method: 'POST',
        headers: { ...ip, 'content-type': 'application/json', [wrongKey]: 'nope' },
        body: JSON.stringify({ lat: located.lat, lng: located.lng }),
      }));
      assert.equal(quote.status, 200);
      const quoted = JSON.parse(quote.text) as { quote: { lowEstimate: number } };
      assert.equal(typeof quoted.quote.lowEstimate, 'number');

      assert.equal(solarKeyUsedOnServer, true);
      assert.deepEqual(outbound, [
        'https://maps.googleapis.com/maps/api/geocode/json',
        'https://solar.googleapis.com/v1/buildingInsights:findClosest',
      ]);
    });
  });

  it('returns an empty map key when the browser key is the solar key', async () => {
    process.env.GOOGLE_MAPS_BROWSER_KEY = JN_API_KEY_DUMMY;
    await withServer(async (base) => {
      const res = await read(await fetch(`${base}/api/roof/maps-key`, {
        headers: { 'x-forwarded-for': '203.0.113.83' },
      }));
      assert.equal(res.status, 200);
      assert.deepEqual(JSON.parse(res.text), { key: '' });
    });
  });

  it('treats whitespace around either key as the same solar key', async () => {
    const around = [' ', JN_API_KEY_DUMMY, ' '].join('');
    const edges = ['\n', JN_API_KEY_DUMMY, '\t'].join('');
    const gap = [JN_API_KEY_DUMMY.slice(0, 6), ' ', JN_API_KEY_DUMMY.slice(6)].join('');
    const paddedBrowser = ['  ', ENV_EXAMPLE_API_KEY_PLACEHOLDER, '  '].join('');
    process.env.GOOGLE_SOLAR_API_KEY = around;
    process.env.GOOGLE_MAPS_BROWSER_KEY = edges;
    await withServer(async (base) => {
      const padded = await read(await fetch(`${base}/api/roof/maps-key`, {
        headers: { 'x-forwarded-for': '203.0.113.84' },
      }));
      assert.equal(padded.status, 200);
      assert.deepEqual(JSON.parse(padded.text), { key: '' });
    });

    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    process.env.GOOGLE_MAPS_BROWSER_KEY = gap;
    await withServer(async (base) => {
      const split = await read(await fetch(`${base}/api/roof/maps-key`, {
        headers: { 'x-forwarded-for': '203.0.113.85' },
      }));
      assert.equal(split.status, 200);
      assert.deepEqual(JSON.parse(split.text), { key: '' });
    });

    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    process.env.GOOGLE_MAPS_BROWSER_KEY = paddedBrowser;
    await withServer(async (base) => {
      const other = await read(await fetch(`${base}/api/roof/maps-key`, {
        headers: { 'x-forwarded-for': '203.0.113.86' },
      }));
      assert.equal(other.status, 200);
      assert.deepEqual(JSON.parse(other.text), { key: ENV_EXAMPLE_API_KEY_PLACEHOLDER });
    });
  });

  it('returns 401 for staff roof routes when logged out', async () => {
    await withServer(async (base) => {
      const ip = { 'x-forwarded-for': '203.0.113.82', 'content-type': 'application/json' };
      const photos = await read(await fetch(`${base}/api/roof/analyze-photos`, {
        method: 'POST',
        headers: ip,
        body: '{}',
      }));
      const report = await read(await fetch(`${base}/api/roof/send-report`, {
        method: 'POST',
        headers: ip,
        body: '{}',
      }));
      assert.equal(photos.status, 401);
      assert.equal(report.status, 401);
      assert.deepEqual(JSON.parse(photos.text), { error: 'Not authenticated' });
      assert.deepEqual(JSON.parse(report.text), { error: 'Not authenticated' });
      assert.deepEqual(outbound, []);

      const login = await fetch(`${base}/login`, { method: 'POST' });
      const cookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie');
      assert.ok(cookie);
      const authed = await read(await fetch(`${base}/api/roof/send-report`, {
        method: 'POST',
        headers: { ...ip, cookie: cookie.split(';')[0] },
        body: '{}',
      }));
      assert.equal(authed.status, 400);
      assert.deepEqual(outbound, []);
    });
  });

  it('returns 429 after 30 requests from the same IP', async () => {
    await withServer(async (base) => {
      const headers = { 'x-forwarded-for': '203.0.113.90' };
      let lastStatus = 0;
      for (let i = 0; i < 31; i++) {
        const res = await read(await fetch(`${base}/api/roof/maps-key`, { headers }));
        lastStatus = res.status;
        if (i < 30) assert.equal(res.status, 200);
      }
      assert.equal(lastStatus, 429);
      assert.deepEqual(outbound, []);
    });
  });
});
