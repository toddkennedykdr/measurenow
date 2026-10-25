import { Client, Pool, type ClientConfig } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { SEED_USERS, seedPasswordFromEnv } from './seedUsers';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/measurenow';

/** Bound for GET /api/health. Long enough for a local round trip, short enough that a stuck check still returns. */
export const HEALTH_PING_TIMEOUT_MS = 2_500;

export const pool = new Pool({ connectionString: DATABASE_URL });

// An idle client emits 'error' when the server drops the socket. With no listener
// the process exits. The pg error object can carry the client, so the log stays generic.
export function attachPoolErrorHandler(target: Pool): void {
  target.on('error', () => {
    console.error('Database pool error');
  });
}

attachPoolErrorHandler(pool);

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

type QueryRows = { rows: unknown[] };

export type HealthCheckClient = {
  query: (sql: string) => Promise<QueryRows>;
  close: () => void;
};

/**
 * One-shot client for the health check. Resolves before the database answers so
 * the caller can destroy the socket if the deadline passes. A shared pool slot
 * is never checked out, so probes cannot queue behind the pool limit.
 */
export function openHealthSession(overrides?: ClientConfig): HealthCheckClient {
  const client = new Client({
    connectionString: DATABASE_URL,
    connectionTimeoutMillis: HEALTH_PING_TIMEOUT_MS,
    query_timeout: HEALTH_PING_TIMEOUT_MS,
    ...overrides,
  });
  client.on('error', () => {
    // Connection failures are reported as database down. Do not log the error.
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      const stream = client.connection.stream;
      if (!stream.destroyed) stream.destroy();
    } catch {
      // ignore
    }
    try {
      client.end(() => {});
    } catch {
      // ignore
    }
  };

  const pending = client.connect();
  pending.catch(() => {
    // query() awaits this same promise. The extra catch covers a close that happens first.
  });

  return {
    query: async (sql: string) => {
      await pending;
      return client.query(sql);
    },
    close,
  };
}

/**
 * Run SELECT 1 and give up after timeoutMs. The timer is cleared when the check
 * finishes. close() always runs, including when the query never settles.
 */
export async function selectOneWithTimeout(
  open: () => Promise<HealthCheckClient>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let client: HealthCheckClient | undefined;
  let settled = false;

  const closeClient = () => {
    const current = client;
    client = undefined;
    if (!current) return;
    try {
      current.close();
    } catch {
      // ignore
    }
  };

  try {
    const result = await new Promise<QueryRows>((resolve, reject) => {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        closeClient();
        reject(new Error('timeout'));
      }, timeoutMs);

      Promise.resolve()
        .then(open)
        .then((opened) => {
          if (settled) {
            try {
              opened.close();
            } catch {
              // ignore
            }
            return undefined;
          }
          client = opened;
          return opened.query('SELECT 1');
        })
        .then((queryResult) => {
          if (!settled && queryResult) resolve(queryResult);
        })
        .catch((err: unknown) => {
          if (!settled) reject(err instanceof Error ? err : new Error('query failed'));
        });
    });
    return result.rows.length === 1;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
    if (!settled) {
      settled = true;
      closeClient();
    }
  }
}

/** Read-only check for GET /api/health. Does not create tables or write rows. */
export async function pingDatabase(
  open: () => Promise<HealthCheckClient> = () => Promise.resolve(openHealthSession()),
): Promise<boolean> {
  return selectOneWithTimeout(open, HEALTH_PING_TIMEOUT_MS);
}

export async function initDb() {
  // Create tables
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      is_admin BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      address TEXT NOT NULL,
      lat REAL,
      lng REAL,
      roof_data JSONB,
      analysis JSONB,
      quote JSONB,
      photos JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Add is_admin column if missing (migration)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;`);
  // Ensure Todd is admin
  await pool.query(`UPDATE users SET is_admin = true WHERE username = 'Todd';`);

  // Insert missing staff users only. Never update or delete an existing row.
  for (const user of SEED_USERS) {
    const password = seedPasswordFromEnv(process.env, user.passwordEnv);
    if (!password) {
      console.log(`Skipping seed for ${user.username}: ${user.passwordEnv} is not set`);
      continue;
    }
    const existing = await db.select().from(schema.users).where(eq(schema.users.username, user.username)).limit(1);
    if (!existing[0]) {
      const hash = bcrypt.hashSync(password, 10);
      await db.insert(schema.users).values({
        username: user.username,
        passwordHash: hash,
        name: user.name,
        isAdmin: user.isAdmin,
      });
      console.log(`Seeded user: ${user.username}`);
    }
  }
}

export { schema };
