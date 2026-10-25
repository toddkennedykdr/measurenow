import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import express from 'express';
import session from 'express-session';
import { JN_API_KEY_DUMMY } from '../test/allowed-literals';
import { leadRouter } from './routes/lead';

const saved = {
  fetch: globalThis.fetch,
  resend: process.env.RESEND_API_KEY,
  jn: process.env.JN_API_KEY,
  alias: process.env.JOBNIMBUS_API_KEY,
  roof: process.env.ROOF_API_KEY,
};

const outbound: string[] = [];

function installFetch() {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return saved.fetch(input, init);
    }
    outbound.push(`${url.origin}${url.pathname}`);
    throw new Error('blocked outbound');
  };
}

function app() {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: JN_API_KEY_DUMMY,
    resave: false,
    saveUninitialized: false,
  }));
  app.post('/login', (req, res) => {
    (req.session as { userId?: number }).userId = 7;
    res.json({ ok: true });
  });
  app.use('/api/lead', leadRouter);
  return app;
}

let base = '';
let server: ReturnType<express.Express['listen']>;

before(async () => {
  delete process.env.RESEND_API_KEY;
  delete process.env.JN_API_KEY;
  delete process.env.JOBNIMBUS_API_KEY;
  process.env.ROOF_API_KEY = JN_API_KEY_DUMMY;
  installFetch();
  server = app().listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  globalThis.fetch = saved.fetch;
  if (saved.resend === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = saved.resend;
  if (saved.jn === undefined) delete process.env.JN_API_KEY;
  else process.env.JN_API_KEY = saved.jn;
  if (saved.alias === undefined) delete process.env.JOBNIMBUS_API_KEY;
  else process.env.JOBNIMBUS_API_KEY = saved.alias;
  if (saved.roof === undefined) delete process.env.ROOF_API_KEY;
  else process.env.ROOF_API_KEY = saved.roof;
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('lead list auth', { concurrency: false }, () => {
  it('hides the lead list from anonymous visitors and from an API key', async () => {
    const anon = await fetch(`${base}/api/lead/list`);
    const anonText = await anon.text();
    assert.equal(anon.status, 401);
    assert.deepEqual(JSON.parse(anonText), { error: 'Not authenticated' });
    assert.equal(anonText.includes('leads'), false);

    const keyed = await fetch(`${base}/api/lead/list`, {
      headers: { 'x-api-key': JN_API_KEY_DUMMY },
    });
    assert.equal(keyed.status, 401);
    assert.deepEqual(await keyed.json(), { error: 'Not authenticated' });
    assert.deepEqual(outbound, []);
  });

  it('returns the list to a logged-in session', async () => {
    const login = await fetch(`${base}/login`, { method: 'POST' });
    const setCookie = login.headers.getSetCookie?.()[0] ?? login.headers.get('set-cookie');
    assert.ok(setCookie);
    const res = await fetch(`${base}/api/lead/list`, {
      headers: { cookie: setCookie.split(';')[0] },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { count: 0, leads: [] });
    assert.deepEqual(outbound, []);
  });

  it('still accepts a public quote submission check without storing a lead', async () => {
    // Empty body fails validation, so nothing is stored and nothing is sent upstream.
    const res = await fetch(`${base}/api/lead/capture`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 400);
    assert.notEqual(res.status, 401);
    assert.deepEqual(outbound, []);
  });
});
