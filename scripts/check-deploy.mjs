#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA_RE = /^[0-9a-f]{7,40}$/;
const USAGE = 'Usage: node scripts/check-deploy.mjs <baseUrl> [gitSha]';

export function normalizeCommit(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!SHA_RE.test(trimmed)) return null;
  return trimmed;
}

export function commitsMatch(live, expected) {
  const left = normalizeCommit(live);
  const right = normalizeCommit(expected);
  if (!left || !right) return false;
  return left === right;
}

/** Print a commit only when it is a sha or the literal unknown. */
export function displayCommit(value) {
  if (value === 'unknown') return 'unknown';
  return normalizeCommit(value) ?? 'unrecognized';
}

export function healthUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    throw new Error('base URL must be an http or https URL');
  }
  let url;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error('base URL must be an http or https URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('base URL must be an http or https URL');
  }
  url.username = '';
  url.password = '';
  const trimmedPath = url.pathname.replace(/\/+$/, '');
  if (trimmedPath === '/api/health' || trimmedPath.endsWith('/api/health')) {
    url.pathname = trimmedPath;
  } else {
    url.pathname = `${trimmedPath}/api/health`;
  }
  url.search = '';
  url.hash = '';
  return url.href;
}

export function parseArgs(argv) {
  const args = argv.filter((arg) => arg !== '--');
  if (args.length < 1 || args.length > 2) {
    throw new Error(USAGE);
  }
  return { baseUrl: args[0], gitSha: args[1] };
}

export function resolveMainHead(cwd = process.cwd()) {
  const refs = ['refs/heads/main', 'origin/main'];
  for (const ref of refs) {
    try {
      const output = execFileSync('git', ['rev-parse', '--verify', ref], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const sha = normalizeCommit(output);
      if (sha && sha.length === 40) return sha;
    } catch {
      // Try the next ref.
    }
  }
  throw new Error('Could not resolve main HEAD');
}

function commitFromPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
  if (typeof payload.commit !== 'string') return '';
  return payload.commit;
}

function isHealthy(payload, status) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return status === 200 && payload.ok === true && payload.database === 'up';
}

export async function checkDeploy({ baseUrl, expectedSha, fetchImpl = globalThis.fetch }) {
  const expected = normalizeCommit(expectedSha);
  if (!expected) {
    return {
      exitCode: 1,
      reason: 'expected commit is not a git sha',
      expected: null,
      liveCommit: '',
    };
  }

  let url;
  try {
    url = healthUrl(baseUrl);
  } catch {
    return {
      exitCode: 1,
      reason: 'base URL must be an http or https URL',
      expected,
      liveCommit: '',
    };
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const name = err instanceof Error && /^[A-Za-z]+$/.test(err.name) ? err.name : 'Error';
    return {
      exitCode: 1,
      reason: `health request failed (${name})`,
      expected,
      liveCommit: '',
    };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      exitCode: 1,
      reason: 'health response was not JSON',
      expected,
      liveCommit: '',
    };
  }

  const liveRaw = commitFromPayload(payload);
  const liveCommit = displayCommit(liveRaw);
  if (!normalizeCommit(liveRaw)) {
    return {
      exitCode: 1,
      reason: `commit mismatch: live ${liveCommit} expected ${expected}`,
      expected,
      liveCommit,
    };
  }
  if (!commitsMatch(liveRaw, expected)) {
    return {
      exitCode: 1,
      reason: `commit mismatch: live ${liveCommit} expected ${expected}`,
      expected,
      liveCommit,
    };
  }
  if (!isHealthy(payload, response.status)) {
    return {
      exitCode: 1,
      reason: 'health check was not ok',
      expected,
      liveCommit,
    };
  }
  return {
    exitCode: 0,
    reason: `commit ${expected} matches`,
    expected,
    liveCommit,
  };
}

export async function main(argv, deps = {}) {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const resolveHead = deps.resolveHead ?? (() => resolveMainHead(deps.cwd));
  const parsed = parseArgs(argv);
  const expectedSha = parsed.gitSha ?? resolveHead();
  const result = await checkDeploy({
    baseUrl: parsed.baseUrl,
    expectedSha,
    fetchImpl,
  });
  const write = result.exitCode === 0 ? console.log : console.error;
  write(result.reason);
  return result.exitCode;
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : 'deploy check failed';
      console.error(message);
      process.exitCode = 1;
    });
}
