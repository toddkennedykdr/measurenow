import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import {
  COMMIT_ENV_NAMES,
  buildHealthBody,
  commitIdFromEnv,
  registerHealthRoute,
} from '../server/health';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

describe('commit id', () => {
  it('reads only the public git sha env names', () => {
    assert.deepEqual([...COMMIT_ENV_NAMES], [
      'RAILWAY_GIT_COMMIT_SHA',
      'GITHUB_SHA',
      'SOURCE_VERSION',
      'VERCEL_GIT_COMMIT_SHA',
    ]);
  });

  it('uses the first hex sha and ignores other values', () => {
    const ignored = 'not-a-commit';
    assert.equal(commitIdFromEnv({ RAILWAY_GIT_COMMIT_SHA: `  ${SHA.toUpperCase()}  ` }), SHA);
    assert.equal(commitIdFromEnv({
      RAILWAY_GIT_COMMIT_SHA: ignored,
      GITHUB_SHA: OTHER,
    }), OTHER);
    assert.equal(commitIdFromEnv({ SOURCE_VERSION: 'abc' }), 'unknown');
    assert.equal(commitIdFromEnv({}), 'unknown');
    assert.equal(commitIdFromEnv({ RAILWAY_GIT_COMMIT_SHA: ignored }).includes(ignored), false);
  });
});

describe('health body', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports the database up without calling fetch', async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      throw new Error('fetch should not run');
    };
    const result = await buildHealthBody(async () => true, { RAILWAY_GIT_COMMIT_SHA: SHA });
    assert.equal(called, false);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, commit: SHA, database: 'up' });
  });

  it('reports the database down and hides the failure text', async () => {
    const marker = 'should-not-appear-in-body';
    const result = await buildHealthBody(async () => {
      throw new Error(marker);
    }, {});
    const encoded = JSON.stringify(result);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { ok: false, commit: 'unknown', database: 'down' });
    assert.equal(encoded.includes(marker), false);
  });

  it('treats a false ping as down', async () => {
    const result = await buildHealthBody(async () => false, { GITHUB_SHA: SHA });
    assert.equal(result.status, 503);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.database, 'down');
    assert.equal(result.body.commit, SHA);
  });
});

describe('GET /api/health', () => {
  async function withServer(ping: () => Promise<boolean>, env: NodeJS.ProcessEnv, fn: (base: string) => Promise<void>) {
    const app = express();
    registerHealthRoute(app, ping, env);
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

  it('returns json with no login', async () => {
    await withServer(async () => true, { RAILWAY_GIT_COMMIT_SHA: SHA }, async (base) => {
      const res = await fetch(`${base}/api/health`);
      const body = await res.json();
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /application\/json/);
      assert.equal(res.headers.get('cache-control'), 'no-store');
      assert.deepEqual(body, { ok: true, commit: SHA, database: 'up' });
    });
  });

  it('is mounted before the shared api rate limit', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'server/index.ts'), 'utf8');
    const healthAt = source.indexOf('registerHealthRoute(');
    const limitAt = source.indexOf("app.use('/api', rateLimit");
    assert.ok(healthAt > 0);
    assert.ok(limitAt > healthAt);
  });
});
