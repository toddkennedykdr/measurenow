import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import session from 'express-session';
import type { NextFunction, Request, Response } from 'express';
import { requireRoofAccess, roofApiKeyMatches, roofRateLimit } from './roofAccess';

const ORIGINAL_KEY = process.env.ROOF_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ROOF_API_KEY;
  else process.env.ROOF_API_KEY = ORIGINAL_KEY;
});

function mockRes() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

describe('roofApiKeyMatches', () => {
  it('rejects every header when ROOF_API_KEY is unset', () => {
    delete process.env.ROOF_API_KEY;
    assert.equal(roofApiKeyMatches('anything'), false);
    assert.equal(roofApiKeyMatches(undefined), false);
  });

  it('accepts only an exact match', () => {
    process.env.ROOF_API_KEY = 'server-secret';
    assert.equal(roofApiKeyMatches('server-secret'), true);
    assert.equal(roofApiKeyMatches('server-secreT'), false);
    assert.equal(roofApiKeyMatches('server-secret-extra'), false);
    assert.equal(roofApiKeyMatches('short'), false);
    assert.equal(roofApiKeyMatches(''), false);
    assert.equal(roofApiKeyMatches(undefined), false);
  });
});

describe('requireRoofAccess', () => {
  it('allows a logged-in session without an API key', () => {
    delete process.env.ROOF_API_KEY;
    let nextCalled = false;
    const req = { session: { userId: 4 }, header: () => undefined } as unknown as Request;
    const res = mockRes();
    requireRoofAccess(req, res as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it('allows a matching x-api-key', () => {
    process.env.ROOF_API_KEY = 'server-secret';
    let nextCalled = false;
    const req = {
      session: {},
      header: (name: string) => (name === 'x-api-key' ? 'server-secret' : undefined),
    } as unknown as Request;
    const res = mockRes();
    requireRoofAccess(req, res as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, true);
  });

  it('returns 401 when there is no session and the key is missing or wrong', () => {
    process.env.ROOF_API_KEY = 'server-secret';
    const req = {
      session: {},
      header: () => 'nope',
    } as unknown as Request;
    const res = mockRes();
    let nextCalled = false;
    requireRoofAccess(req, res as unknown as Response, (() => { nextCalled = true; }) as NextFunction);
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error: 'Not authenticated' });
  });

  it('returns 401 for a presented key when ROOF_API_KEY is unset', () => {
    delete process.env.ROOF_API_KEY;
    const req = {
      session: {},
      header: () => 'server-secret',
    } as unknown as Request;
    const res = mockRes();
    requireRoofAccess(req, res as unknown as Response, (() => { throw new Error('should not continue'); }) as NextFunction);
    assert.equal(res.statusCode, 401);
  });
});

function testApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(session({
    secret: 'test-session-secret',
    resave: false,
    saveUninitialized: false,
  }));
  app.post('/login', (req, res) => {
    (req.session as { userId?: number }).userId = 7;
    res.json({ ok: true });
  });
  app.use(roofRateLimit, requireRoofAccess);
  app.post('/geocode', (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

async function withServer(fn: (base: string) => Promise<void>) {
  const server = testApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  try {
    const { port } = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }
}

describe('roof route gate', () => {
  it('rejects anonymous callers and accepts a session or x-api-key', async () => {
    process.env.ROOF_API_KEY = 'server-secret';
    await withServer(async (base) => {
      const anon = await fetch(`${base}/geocode`, { method: 'POST' });
      assert.equal(anon.status, 401);
      assert.deepEqual(await anon.json(), { error: 'Not authenticated' });

      const keyed = await fetch(`${base}/geocode`, {
        method: 'POST',
        headers: { 'x-api-key': 'server-secret' },
      });
      assert.equal(keyed.status, 200);

      const wrong = await fetch(`${base}/geocode`, {
        method: 'POST',
        headers: { 'x-api-key': 'wrong' },
      });
      assert.equal(wrong.status, 401);

      const login = await fetch(`${base}/login`, { method: 'POST' });
      const cookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie');
      assert.ok(cookie);
      const authed = await fetch(`${base}/geocode`, {
        method: 'POST',
        headers: { cookie: cookie.split(';')[0] },
      });
      assert.equal(authed.status, 200);
    });
  });

  it('returns 429 after 30 requests from the same IP', async () => {
    delete process.env.ROOF_API_KEY;
    await withServer(async (base) => {
      const headers = { 'x-forwarded-for': '203.0.113.50' };
      let last = 0;
      for (let i = 0; i < 31; i++) {
        const res = await fetch(`${base}/geocode`, { method: 'POST', headers });
        last = res.status;
      }
      assert.equal(last, 429);
    });
  });
});
