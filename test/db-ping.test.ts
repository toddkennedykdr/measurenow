import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Socket } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import express from 'express';
import { Pool, type ClientConfig } from 'pg';
import { buildHealthBody, registerHealthRoute } from '../server/health';
import {
  HEALTH_PING_TIMEOUT_MS,
  attachPoolErrorHandler,
  openHealthSession,
  pingDatabase,
  pool,
  selectOneWithTimeout,
  type HealthCheckClient,
} from '../server/db';

const SHA = 'c'.repeat(40);
const MARKER_HOST = '203.0.113.10';
const MARKER_PORT = '59991';
const MARKER_USER = 'healthcheckuser';

function timeoutCount(): number {
  return process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;
}

function flatten(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name} ${value.message} ${value.stack ?? ''}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function captureConsole(fn: () => Promise<void> | void): Promise<string[]> {
  const lines: string[] = [];
  const previous = {
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const record = (...args: unknown[]) => {
    lines.push(args.map(flatten).join(' '));
  };
  console.error = record;
  console.log = record;
  console.warn = record;
  try {
    await fn();
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    console.error = previous.error;
    console.log = previous.log;
    console.warn = previous.warn;
  }
  return lines;
}

function assertNoMarker(text: string): void {
  assert.equal(text.includes(MARKER_HOST), false);
  assert.equal(text.includes(MARKER_PORT), false);
  assert.equal(text.includes(MARKER_USER), false);
  assert.equal(text.includes('ECONNRESET'), false);
  assert.equal(text.includes('timeout'), false);
}

class HungSocket extends Socket {
  override connect(): this {
    return this;
  }
}

function hungStream(): { sockets: HungSocket[]; stream: ClientConfig['stream'] } {
  const sockets: HungSocket[] = [];
  return {
    sockets,
    stream: () => {
      const socket = new HungSocket();
      sockets.push(socket);
      return socket;
    },
  };
}

async function withServer(
  ping: () => Promise<boolean>,
  env: NodeJS.ProcessEnv,
  fn: (base: string) => Promise<void>,
): Promise<void> {
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

describe('database ping timeout', { concurrency: 1 }, () => {
  const crashes: unknown[] = [];
  const onCrash = (err: unknown) => {
    crashes.push(err);
  };

  afterEach(() => {
    assert.equal(crashes.length, 0);
    crashes.length = 0;
  });

  it('keeps the health deadline between 2 and 3 seconds', () => {
    assert.ok(HEALTH_PING_TIMEOUT_MS >= 2_000);
    assert.ok(HEALTH_PING_TIMEOUT_MS <= 3_000);
  });

  it('returns the database up body for a fast check and clears the timer', async () => {
    const seen: string[] = [];
    let closes = 0;
    const timersBefore = timeoutCount();
    const started = Date.now();
    const result = await buildHealthBody(() => pingDatabase(async () => ({
      query: async (sql: string) => {
        seen.push(sql);
        return { rows: [{}] };
      },
      close: () => {
        closes += 1;
      },
    })), { RAILWAY_GIT_COMMIT_SHA: SHA });
    const elapsed = Date.now() - started;
    assert.deepEqual(seen, ['SELECT 1']);
    assert.equal(closes, 1);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { ok: true, commit: SHA, database: 'up' });
    assert.ok(elapsed < 500);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    assert.equal(closes, 1);
    assert.equal(timeoutCount(), timersBefore);
  });

  it('hides a failed check and still closes the client', async () => {
    let closes = 0;
    const lines = await captureConsole(async () => {
      const result = await buildHealthBody(() => selectOneWithTimeout(async () => ({
        query: async () => {
          throw new Error(`connect ECONNRESET ${MARKER_USER}@${MARKER_HOST}:${MARKER_PORT}`);
        },
        close: () => {
          closes += 1;
          throw new Error(`close ${MARKER_HOST}:${MARKER_PORT}`);
        },
      }), 1_000), {});
      assert.equal(result.status, 503);
      assert.deepEqual(result.body, { ok: false, commit: 'unknown', database: 'down' });
      assertNoMarker(JSON.stringify(result));
    });
    assert.equal(closes, 1);
    assert.equal(lines.length, 0);
  });

  it('drops hung queries in parallel and closes a client that opens late', async () => {
    let inFlight = 0;
    const started = Date.now();
    const hang = async (): Promise<HealthCheckClient> => {
      inFlight += 1;
      return {
        query: () => new Promise(() => {}),
        close: () => {
          inFlight -= 1;
        },
      };
    };
    const [first, second] = await Promise.all([
      selectOneWithTimeout(hang, 40),
      selectOneWithTimeout(hang, 40),
    ]);
    let lateClosed = false;
    const late = await selectOneWithTimeout(() => new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          query: () => new Promise(() => {}),
          close: () => {
            lateClosed = true;
          },
        });
      }, 30);
    }), 10);
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    assert.deepEqual([first, second, late], [false, false, false]);
    assert.ok(Date.now() - started < 400);
    assert.equal(inFlight, 0);
    assert.equal(lateClosed, true);
  });

  it('returns 503 within the deadline when the database socket never answers', { timeout: 7_000 }, async () => {
    process.on('uncaughtException', onCrash);
    process.on('unhandledRejection', onCrash);
    const hung = hungStream();
    const lines = await captureConsole(async () => {
      try {
        await withServer(
          () => pingDatabase(async () => openHealthSession({
            connectionString: `postgresql://${MARKER_USER}@${MARKER_HOST}:${MARKER_PORT}/measurenow`,
            stream: hung.stream,
          })),
          { GITHUB_SHA: SHA },
          async (base) => {
            const started = Date.now();
            const first = fetch(`${base}/api/health`);
            const second = fetch(`${base}/api/health`);
            await new Promise<void>((resolve) => setTimeout(resolve, 50));
            assert.equal(pool.totalCount, 0);
            assert.equal(pool.waitingCount, 0);
            const [left, right] = await Promise.all([first, second]);
            const elapsed = Date.now() - started;
            const leftBody: unknown = await left.json();
            const rightBody: unknown = await right.json();
            assert.equal(left.status, 503);
            assert.equal(right.status, 503);
            assert.deepEqual(leftBody, { ok: false, commit: SHA, database: 'down' });
            assert.deepEqual(rightBody, { ok: false, commit: SHA, database: 'down' });
            assertNoMarker(JSON.stringify(leftBody));
            assertNoMarker(JSON.stringify(rightBody));
            assert.ok(elapsed >= 2_000, `returned too fast (${elapsed}ms)`);
            assert.ok(elapsed < 4_000, `returned too slow (${elapsed}ms)`);
            assert.equal(hung.sockets.length, 2);
            assert.equal(hung.sockets.every((socket) => socket.destroyed), true);
            assert.equal(pool.totalCount, 0);
            assert.equal(pool.waitingCount, 0);
          },
        );
      } finally {
        for (const socket of hung.sockets) {
          if (!socket.destroyed) socket.destroy();
        }
        process.off('uncaughtException', onCrash);
        process.off('unhandledRejection', onCrash);
      }
    });
    assert.equal(lines.length, 0, lines.join('\n'));
    assertNoMarker(lines.join('\n'));
  });
});

describe('pool error handler', { concurrency: 1 }, () => {
  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;

    constructor() {
      super();
      clients.push(this);
    }

    connect(callback: (err?: Error) => void): void {
      process.nextTick(() => callback());
    }

    query(
      _text: string,
      values: unknown,
      callback?: (err: Error | null, result?: { rows: unknown[] }) => void,
    ): void {
      const done = typeof values === 'function'
        ? values as (err: Error | null, result?: { rows: unknown[] }) => void
        : callback;
      process.nextTick(() => done?.(null, { rows: [{}] }));
    }

    end(callback?: () => void): void {
      this._ending = true;
      if (callback) process.nextTick(callback);
    }

    ref(): void {}

    unref(): void {}
  }

  const clients: FakeClient[] = [];

  it('logs one generic line for an idle client error and checks out a new client', async () => {
    clients.length = 0;
    const local = new Pool({
      Client: FakeClient as unknown as new () => FakeClient,
      idleTimeoutMillis: 0,
      max: 1,
    });
    attachPoolErrorHandler(local);
    const failure = new Error(`connect ECONNRESET ${MARKER_USER}@${MARKER_HOST}:${MARKER_PORT}`);
    Object.assign(failure, { address: MARKER_HOST, port: Number(MARKER_PORT) });

    try {
      const lines = await captureConsole(async () => {
        const first = await local.query('SELECT 1');
        assert.equal(first.rows.length, 1);
        assert.equal(local.idleCount, 1);
        assert.equal(clients.length, 1);
        assert.doesNotThrow(() => {
          clients[0].emit('error', failure);
        });
        assert.equal(local.idleCount, 0);
        assert.equal(local.totalCount, 0);
        const secondQuery = local.query('SELECT 1');
        secondQuery.catch(() => {});
        const second = await Promise.race([
          secondQuery,
          new Promise<never>((_resolve, reject) => {
            setTimeout(() => reject(new Error('pool did not recover')), 500);
          }),
        ]);
        assert.equal(second.rows.length, 1);
        assert.equal(clients.length, 2);
      });
      assert.deepEqual(lines, ['Database pool error']);
      assertNoMarker(lines.join('\n'));
    } finally {
      await local.end();
    }
  });

  it('does not throw or log connection details for the shared pool', async () => {
    assert.equal(pool.listenerCount('error'), 1);
    const failure = new Error(`connect ECONNRESET ${MARKER_USER}@${MARKER_HOST}:${MARKER_PORT}/measurenow`);
    Object.assign(failure, { address: MARKER_HOST, port: Number(MARKER_PORT) });
    const lines = await captureConsole(() => {
      assert.doesNotThrow(() => {
        pool.emit('error', failure);
      });
    });
    assert.deepEqual(lines, ['Database pool error']);
    assertNoMarker(lines.join('\n'));
    const configured = process.env.DATABASE_URL;
    if (typeof configured === 'string' && configured !== '') {
      assert.equal(lines.join('\n').includes(configured), false);
    }
  });
});
