import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  checkDeploy,
  commitsMatch,
  healthUrl,
  main,
  parseArgs,
  resolveMainHead,
} from '../scripts/check-deploy.mjs';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const BASE = 'https://example.com/app/';

type Call = { url: string; method: string | undefined; hasSignal: boolean };

function jsonFetch(status: number, payload: unknown, calls: Call[]): typeof fetch {
  return async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method,
      hasSignal: Boolean(init?.signal),
    });
    return Response.json(payload, { status });
  };
}

describe('health URL', () => {
  it('appends /api/health and drops userinfo and query', () => {
    const url = healthUrl('https://user:not-real@example.com/app/?q=1#x');
    assert.equal(url, 'https://example.com/app/api/health');
    assert.equal(url.includes('not-real'), false);
  });

  it('keeps an existing /api/health path', () => {
    assert.equal(healthUrl('http://127.0.0.1:3001/api/health/'), 'http://127.0.0.1:3001/api/health');
  });

  it('rejects a non-http base', () => {
    assert.throws(() => healthUrl('file:///tmp/health'), /http or https/);
    assert.throws(() => healthUrl('not a url'), /http or https/);
  });
});

describe('commit compare', () => {
  it('matches the full sha ignoring case and surrounding space', () => {
    assert.equal(commitsMatch(` ${SHA.toUpperCase()} `, SHA), true);
    assert.equal(commitsMatch(SHA, OTHER), false);
    assert.equal(commitsMatch('unknown', SHA), false);
    assert.equal(commitsMatch(SHA.slice(0, 7), SHA), false);
  });
});

describe('checkDeploy', () => {
  it('exits 0 when the live commit matches and ok is true', async () => {
    const calls: Call[] = [];
    const result = await checkDeploy({
      baseUrl: 'https://user:not-real@example.com/app/',
      expectedSha: SHA.toUpperCase(),
      fetchImpl: jsonFetch(200, { ok: true, commit: SHA, database: 'up' }, calls),
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.reason, `commit ${SHA} matches`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://example.com/app/api/health');
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[0].hasSignal, true);
    assert.equal(calls[0].url.includes('not-real'), false);
    assert.equal(calls[0].url.includes('googleapis.com'), false);
  });

  it('exits non-zero on a commit mismatch', async () => {
    const calls: Call[] = [];
    const result = await checkDeploy({
      baseUrl: BASE,
      expectedSha: SHA,
      fetchImpl: jsonFetch(200, { ok: true, commit: OTHER, database: 'up' }, calls),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.reason, `commit mismatch: live ${OTHER} expected ${SHA}`);
    assert.equal(calls.length, 1);
  });

  it('exits non-zero when the commit matches but the check is not ok', async () => {
    const result = await checkDeploy({
      baseUrl: BASE,
      expectedSha: SHA,
      fetchImpl: jsonFetch(503, { ok: false, commit: SHA, database: 'down' }, []),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.reason, 'health check was not ok');
  });

  it('does not echo an unrecognized commit value', async () => {
    const marker = 'should-not-leak-value';
    const result = await checkDeploy({
      baseUrl: BASE,
      expectedSha: SHA,
      fetchImpl: jsonFetch(200, { ok: true, commit: marker, database: 'up' }, []),
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.reason.includes(marker), false);
    assert.equal(result.reason, `commit mismatch: live unrecognized expected ${SHA}`);
  });

  it('exits non-zero when fetch fails or the body is not json', async () => {
    const failed = await checkDeploy({
      baseUrl: BASE,
      expectedSha: SHA,
      fetchImpl: async () => {
        throw new TypeError('network down');
      },
    });
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.reason, 'health request failed (TypeError)');
    assert.equal(failed.reason.includes('network down'), false);

    const notJson = await checkDeploy({
      baseUrl: BASE,
      expectedSha: SHA,
      fetchImpl: async () => new Response('nope', { status: 200 }),
    });
    assert.equal(notJson.exitCode, 1);
    assert.equal(notJson.reason, 'health response was not JSON');
  });

  it('does not fetch when the sha or base URL is unusable', async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      throw new Error('fetch should not run');
    };
    const badSha = await checkDeploy({ baseUrl: BASE, expectedSha: 'HEAD', fetchImpl });
    const badUrl = await checkDeploy({ baseUrl: 'ftp://example.com', expectedSha: SHA, fetchImpl });
    assert.equal(badSha.exitCode, 1);
    assert.equal(badUrl.exitCode, 1);
    assert.equal(called, false);
  });
});

describe('cli', () => {
  it('parses a base URL and an optional sha', () => {
    assert.deepEqual(parseArgs(['https://example.com', SHA]), {
      baseUrl: 'https://example.com',
      gitSha: SHA,
    });
    assert.deepEqual(parseArgs(['--', 'https://example.com']), {
      baseUrl: 'https://example.com',
      gitSha: undefined,
    });
    assert.throws(() => parseArgs([]), /Usage/);
  });

  it('uses the provided sha and does not need git', async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    try {
      const code = await main([BASE, SHA], {
        fetchImpl: jsonFetch(200, { ok: true, commit: SHA, database: 'up' }, []),
        resolveHead: () => {
          throw new Error('resolve should not run');
        },
      });
      assert.equal(code, 0);
      assert.deepEqual(logs, [`commit ${SHA} matches`]);
      assert.deepEqual(errors, []);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it('resolveMainHead matches local main', () => {
    const expected = execFileSync('git', ['rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim();
    assert.equal(resolveMainHead(), expected.toLowerCase());
  });
});
