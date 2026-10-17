import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { after, before, beforeEach, describe, test } from 'node:test';
import express from 'express';
import {
  readJobNimbusApiKey,
  resetJobNimbusWarningForTests,
  warnIfJobNimbusUnconfigured,
  jnRouter,
} from '../server/routes/jobnimbus';
import { JN_ALIAS_API_KEY_DUMMY, JN_API_KEY_DUMMY } from './allowed-literals';
import { assertExact } from './assert-secret';

const MISSING_KEY_WARNING =
  'JobNimbus API key is not set (JN_API_KEY or JOBNIMBUS_API_KEY). JobNimbus routes will return 503.';

type CapturedCall = { url: string; authorization: string | null };

function installFetchMock(): { calls: CapturedCall[]; restore: () => void } {
  const original = globalThis.fetch;
  const calls: CapturedCall[] = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    let hostname = '';
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = '';
    }
    if (hostname === 'app.jobnimbus.com') {
      const headers = new Headers(init?.headers);
      calls.push({ url, authorization: headers.get('authorization') });
      return new Response(JSON.stringify({ results: [], id: 'test-file' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (hostname === '127.0.0.1' || hostname === 'localhost') {
      return original(input, init);
    }
    throw new Error(`blocked outbound request to ${hostname || 'an unexpected host'}`);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

describe('JobNimbus API key', { concurrency: false }, () => {
  const saved = {
    primary: process.env.JN_API_KEY,
    alias: process.env.JOBNIMBUS_API_KEY,
  };
  let baseUrl = '';
  let server: http.Server;
  let mock: ReturnType<typeof installFetchMock>;

  before(async () => {
    mock = installFetchMock();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      if (req.header('x-test-user') === '1') (req as any).session = { userId: 1 };
      next();
    });
    app.use(jnRouter);
    server = http.createServer(app);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('expected a TCP port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    mock.restore();
    restoreEnv();
    server.close();
    await once(server, 'close');
  });

  beforeEach(() => {
    mock.calls.length = 0;
    resetJobNimbusWarningForTests();
    delete process.env.JN_API_KEY;
    delete process.env.JOBNIMBUS_API_KEY;
  });

  function restoreEnv(): void {
    if (saved.primary === undefined) delete process.env.JN_API_KEY;
    else process.env.JN_API_KEY = saved.primary;
    if (saved.alias === undefined) delete process.env.JOBNIMBUS_API_KEY;
    else process.env.JOBNIMBUS_API_KEY = saved.alias;
  }

  async function request(pathname: string, init?: RequestInit & { user?: boolean }): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (init?.user) headers.set('x-test-user', '1');
    if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    const { user: _user, ...rest } = init ?? {};
    return fetch(`${baseUrl}${pathname}`, { ...rest, headers });
  }

  function captureWarnings(): { warnings: string[]; restore: () => void } {
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map((arg) => String(arg)).join(' '));
    };
    return {
      warnings,
      restore() {
        console.warn = original;
      },
    };
  }

  test('module load and missing-key warning do not throw', () => {
    const seen = captureWarnings();
    try {
      warnIfJobNimbusUnconfigured();
      warnIfJobNimbusUnconfigured();
      assert.equal(seen.warnings.length, 1);
      assert.equal(seen.warnings[0], MISSING_KEY_WARNING);
      assert.equal(readJobNimbusApiKey(), '');
    } finally {
      seen.restore();
    }
  });

  test('uses JN_API_KEY when it is the only key set', async () => {
    process.env.JN_API_KEY = JN_API_KEY_DUMMY;
    const seen = captureWarnings();
    try {
      assertExact(readJobNimbusApiKey(), JN_API_KEY_DUMMY, 'JN_API_KEY');
      warnIfJobNimbusUnconfigured();
      const response = await request('/jobs?keyword=roof', { user: true });
      assert.equal(response.status, 200);
      assert.equal(mock.calls.length, 1);
      assert.equal(mock.calls[0].url.startsWith('https://app.jobnimbus.com/api1/jobs'), true);
      assertExact(mock.calls[0].authorization, `Bearer ${JN_API_KEY_DUMMY}`, 'JN_API_KEY authorization');
      assert.equal(seen.warnings.length, 0);
    } finally {
      seen.restore();
    }
  });

  test('uses JOBNIMBUS_API_KEY when JN_API_KEY is unset', async () => {
    process.env.JOBNIMBUS_API_KEY = JN_ALIAS_API_KEY_DUMMY;
    const seen = captureWarnings();
    try {
      assertExact(readJobNimbusApiKey(), JN_ALIAS_API_KEY_DUMMY, 'JOBNIMBUS_API_KEY');
      warnIfJobNimbusUnconfigured();
      const response = await request('/jobs?keyword=roof', { user: true });
      assert.equal(response.status, 200);
      assert.equal(mock.calls.length, 1);
      assertExact(mock.calls[0].authorization, `Bearer ${JN_ALIAS_API_KEY_DUMMY}`, 'alias authorization');
      assert.equal(seen.warnings.length, 0);
    } finally {
      seen.restore();
    }
  });

  test('prefers JN_API_KEY when both variables are set', async () => {
    process.env.JN_API_KEY = JN_API_KEY_DUMMY;
    process.env.JOBNIMBUS_API_KEY = JN_ALIAS_API_KEY_DUMMY;
    const response = await request('/jobs?keyword=roof', { user: true });
    assert.equal(response.status, 200);
    assert.equal(mock.calls.length, 1);
    assertExact(mock.calls[0].authorization, `Bearer ${JN_API_KEY_DUMMY}`, 'preferred authorization');
    if (mock.calls[0].authorization === `Bearer ${JN_ALIAS_API_KEY_DUMMY}`) {
      throw new Error('JobNimbus request used the alias instead of JN_API_KEY');
    }
  });

  test('returns 503 and warns once when neither key is set', async () => {
    const seen = captureWarnings();
    try {
      const jobs = await request('/jobs?keyword=roof', { user: true });
      const upload = await request('/upload', {
        method: 'POST',
        user: true,
        body: JSON.stringify({ jobId: 'job-1', reportHtml: '<p>report</p>' }),
      });
      assert.equal(jobs.status, 503);
      assert.deepEqual(await jobs.json(), { error: 'JobNimbus is not configured' });
      assert.equal(upload.status, 503);
      assert.deepEqual(await upload.json(), { error: 'JobNimbus is not configured' });
      assert.equal(mock.calls.length, 0);
      assert.equal(seen.warnings.length, 1);
      assert.equal(seen.warnings[0], MISSING_KEY_WARNING);
    } finally {
      seen.restore();
    }
  });

  test('still requires a session when a key is configured', async () => {
    process.env.JN_API_KEY = JN_API_KEY_DUMMY;
    const response = await request('/jobs?keyword=roof');
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Not authenticated' });
    assert.equal(mock.calls.length, 0);
  });
});
