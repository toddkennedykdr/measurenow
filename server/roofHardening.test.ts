import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import type { Express } from 'express';
import session from 'express-session';
import { JN_API_KEY_DUMMY } from '../test/allowed-literals';
import { malformedJsonHandler } from './middleware/jsonError';
import {
  DEFAULT_PUBLIC_DAILY_CAP,
  PUBLIC_DAILY_CAP_MESSAGE,
  PUBLIC_DAILY_CAP_STATUS,
  ROOF_PUBLIC_DAILY_CAP_ENV,
  easternCalendarDay,
  publicDailyCapLimit,
  resetPublicDailyCapForTests,
  setPublicDailyCapClock,
  takePublicDailySlot,
} from './publicDailyCap';
import { roofRouter } from './routes/roof';
import { getBuildingInsights } from './services/solar';

const BUSY = 'Our online estimate is busy right now. Please call K&D Roofing at 919-977-4074.';
const JAN_15_EVENING_ET = Date.parse('2026-01-16T04:30:00.000Z');
const JAN_16_MORNING_ET = Date.parse('2026-01-16T05:30:00.000Z');

const saved = {
  fetch: globalThis.fetch,
  cap: process.env[ROOF_PUBLIC_DAILY_CAP_ENV],
  solar: process.env.GOOGLE_SOLAR_API_KEY,
  roof: process.env.ROOF_API_KEY,
};

let upstream = 0;

function installUpstreamMock() {
  upstream = 0;
  const realFetch = saved.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return realFetch(input, init);
    }
    const hostPath = `${url.hostname}${url.pathname}`;
    if (url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/geocode/json') {
      upstream += 1;
      return Response.json({
        status: 'OK',
        results: [{
          formatted_address: '123 Main St, Raleigh, NC',
          geometry: { location: { lat: 35.78, lng: -78.64 } },
        }],
      });
    }
    if (url.hostname === 'solar.googleapis.com' && url.pathname === '/v1/buildingInsights:findClosest') {
      upstream += 1;
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

async function withServer(app: Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0, '127.0.0.1');
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

function capApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(session({
    secret: JN_API_KEY_DUMMY,
    resave: false,
    saveUninitialized: false,
  }));
  app.post('/login', (req, res) => {
    (req.session as { userId?: number }).userId = 7;
    res.json({ ok: true });
  });
  app.use('/api/roof', roofRouter);
  return app;
}

after(() => {
  globalThis.fetch = saved.fetch;
  resetPublicDailyCapForTests();
  if (saved.cap === undefined) delete process.env[ROOF_PUBLIC_DAILY_CAP_ENV];
  else process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = saved.cap;
  if (saved.solar === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
  else process.env.GOOGLE_SOLAR_API_KEY = saved.solar;
  if (saved.roof === undefined) delete process.env.ROOF_API_KEY;
  else process.env.ROOF_API_KEY = saved.roof;
});

describe('roof hardening', { concurrency: false }, () => {
  it('logs solar failures with the status and not the upstream body or URL', async () => {
    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    const leaked = [
      'https://solar.googleapis.com/v1/buildingInsights:findClosest?key=',
      JN_API_KEY_DUMMY,
      '&marker=UPSTREAM-BODY',
    ].join('');
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(leaked, { status: 403 });
    const lines: string[] = [];
    const prev = console.error;
    console.error = (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '));
    };
    try {
      assert.equal(await getBuildingInsights(35.78, -78.64), null);
    } finally {
      console.error = prev;
      globalThis.fetch = prevFetch;
    }
    const flat = lines.join('\n');
    assert.match(flat, /\b403\b/);
    assert.equal(flat.includes(JN_API_KEY_DUMMY), false);
    assert.equal(flat.includes('solar.googleapis.com'), false);
    assert.equal(flat.includes('findClosest'), false);
    assert.equal(flat.includes('UPSTREAM-BODY'), false);
    assert.equal(flat.includes('key='), false);
  });

  it('returns JSON 400 for a malformed JSON body', async () => {
    globalThis.fetch = saved.fetch;
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(malformedJsonHandler);
    app.post('/api/roof/geocode', (req, res) => {
      res.json({ ok: true, address: req.body?.address ?? null });
    });
    await withServer(app, async (base) => {
      const bad = await fetch(`${base}/api/roof/geocode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      });
      const badText = await bad.text();
      assert.equal(bad.status, 400);
      assert.match(bad.headers.get('content-type') || '', /application\/json/);
      assert.equal(badText.includes('<'), false);
      assert.deepEqual(JSON.parse(badText), { error: 'Invalid JSON' });

      const ok = await fetch(`${base}/api/roof/geocode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: '123 Main St' }),
      });
      assert.equal(ok.status, 200);
      assert.deepEqual(await ok.json(), { ok: true, address: '123 Main St' });
    });
  });

  it('caps public geocode and quote at 500 per Eastern day and resets the next day', async () => {
    assert.equal(DEFAULT_PUBLIC_DAILY_CAP, 500);
    assert.equal(PUBLIC_DAILY_CAP_STATUS, 503);
    assert.equal(PUBLIC_DAILY_CAP_MESSAGE, BUSY);
    assert.equal(easternCalendarDay(JAN_15_EVENING_ET), '2026-01-15');
    assert.equal(easternCalendarDay(JAN_16_MORNING_ET), '2026-01-16');

    delete process.env[ROOF_PUBLIC_DAILY_CAP_ENV];
    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    resetPublicDailyCapForTests();
    setPublicDailyCapClock(() => JAN_15_EVENING_ET);
    installUpstreamMock();

    await withServer(capApp(), async (base) => {
      const started = Date.now() - 60_000;
      const geocodeBody = JSON.stringify({ address: '123 Main St, Raleigh, NC', formStartedAt: started });
      const quoteBody = JSON.stringify({ lat: 35.78, lng: -78.64, formStartedAt: started });
      const post = (path: string, body: string) => fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });

      for (let n = 1; n <= 499; n++) {
        const res = await post('/api/roof/geocode', geocodeBody);
        assert.equal(res.status, 200, `geocode ${n}`);
        await res.arrayBuffer();
      }
      const fiveHundredth = await post('/api/roof/quote', quoteBody);
      const quoted = await fiveHundredth.json() as { quote?: { lowEstimate?: number } };
      assert.equal(fiveHundredth.status, 200);
      assert.equal(typeof quoted.quote?.lowEstimate, 'number');
      const fetchesAtCap = upstream;
      assert.equal(fetchesAtCap, 500);

      const blocked = await post('/api/roof/geocode', geocodeBody);
      const blockedText = await blocked.text();
      assert.equal(blocked.status, 503);
      assert.deepEqual(JSON.parse(blockedText), { error: BUSY });
      assert.equal(upstream, fetchesAtCap);

      const maps = await fetch(`${base}/api/roof/maps-key`);
      assert.equal(maps.status, 200);
      await maps.arrayBuffer();
      assert.equal(upstream, fetchesAtCap);

      setPublicDailyCapClock(() => JAN_16_MORNING_ET);
      const nextDay = await post('/api/roof/geocode', geocodeBody);
      assert.equal(nextDay.status, 200);
      await nextDay.arrayBuffer();
      assert.equal(upstream, fetchesAtCap + 1);
    });
  });

  it('does not count staff sessions or a valid roof key toward the daily cap', async () => {
    process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = '1';
    process.env.ROOF_API_KEY = JN_API_KEY_DUMMY;
    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    resetPublicDailyCapForTests();
    setPublicDailyCapClock(() => JAN_15_EVENING_ET);
    installUpstreamMock();

    await withServer(capApp(), async (base) => {
      const body = JSON.stringify({ address: '123 Main St, Raleigh, NC', formStartedAt: Date.now() - 60_000 });
      const post = (headers: Record<string, string>) => fetch(`${base}/api/roof/geocode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body,
      });
      const login = await fetch(`${base}/login`, { method: 'POST' });
      const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie');
      assert.ok(setCookie);
      const staffCookie = setCookie.split(';')[0];

      const staffFirst = await post({ cookie: staffCookie });
      assert.equal(staffFirst.status, 200);
      await staffFirst.arrayBuffer();
      const keyedFirst = await post({ 'x-api-key': JN_API_KEY_DUMMY });
      assert.equal(keyedFirst.status, 200);
      await keyedFirst.arrayBuffer();
      assert.equal(upstream, 2);

      const anonOk = await post({});
      assert.equal(anonOk.status, 200);
      await anonOk.arrayBuffer();
      assert.equal(upstream, 3);

      const anonBlocked = await post({});
      assert.equal(anonBlocked.status, 503);
      assert.deepEqual(await anonBlocked.json(), { error: BUSY });
      const wrongKey = [JN_API_KEY_DUMMY, '-extra'].join('');
      const wrong = await post({ 'x-api-key': wrongKey });
      assert.equal(wrong.status, 503);
      assert.deepEqual(await wrong.json(), { error: BUSY });
      assert.equal(upstream, 3);

      const staffAfter = await post({ cookie: staffCookie });
      assert.equal(staffAfter.status, 200);
      await staffAfter.arrayBuffer();
      const keyedAfter = await post({ 'x-api-key': JN_API_KEY_DUMMY });
      assert.equal(keyedAfter.status, 200);
      await keyedAfter.arrayBuffer();
      assert.equal(upstream, 5);

      const stillBlocked = await post({});
      assert.equal(stillBlocked.status, 503);
      await stillBlocked.arrayBuffer();
      assert.equal(upstream, 5);
    });
  });

  it('does not spend a daily cap slot on an invalid request', async () => {
    process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = '3';
    delete process.env.ROOF_API_KEY;
    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    resetPublicDailyCapForTests();
    setPublicDailyCapClock(() => JAN_15_EVENING_ET);
    installUpstreamMock();

    await withServer(capApp(), async (base) => {
      const post = (address: string) => fetch(`${base}/api/roof/geocode`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, formStartedAt: Date.now() - 60_000 }),
      });
      for (let n = 1; n <= 3; n++) {
        const res = await post('no');
        assert.equal(res.status, 400, `invalid ${n}`);
        await res.arrayBuffer();
      }
      assert.equal(upstream, 0);
      for (let n = 1; n <= 3; n++) {
        const res = await post('123 Main St, Raleigh, NC');
        assert.equal(res.status, 200, `valid ${n}`);
        await res.arrayBuffer();
      }
      assert.equal(upstream, 3);
      const blocked = await post('123 Main St, Raleigh, NC');
      assert.equal(blocked.status, 503);
      assert.deepEqual(await blocked.json(), { error: BUSY });
      assert.equal(upstream, 3);
    });
  });

  it('accepts only a plain non-negative integer for the daily cap', () => {
    const expectLimit = (raw: string | undefined, limit: number) => {
      if (raw === undefined) delete process.env[ROOF_PUBLIC_DAILY_CAP_ENV];
      else process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = raw;
      assert.equal(publicDailyCapLimit(), limit, JSON.stringify(raw));
    };
    expectLimit(undefined, 500);
    expectLimit('', 500);
    expectLimit('   ', 500);
    expectLimit('1e3', 500);
    expectLimit('0x10', 500);
    expectLimit('5.5', 500);
    expectLimit('-1', 500);
    expectLimit('abc', 500);
    expectLimit('9'.repeat(20), 500);
    expectLimit(String(Number.MAX_SAFE_INTEGER + 2), 500);
    expectLimit('0', 0);
    expectLimit('500', 500);
    expectLimit(' 42 ', 42);
    expectLimit(String(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);

    process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = '0';
    resetPublicDailyCapForTests();
    setPublicDailyCapClock(() => JAN_15_EVENING_ET);
    assert.equal(takePublicDailySlot(), false);
    resetPublicDailyCapForTests();
  });
});
