import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import bcrypt from 'bcryptjs';
import * as schema from './schema';
import { shouldSeedAdmin } from '../authz';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/measurenow';

export const pool = new Pool({ connectionString: DATABASE_URL });

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
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

  // Safe for databases that already have users. Does not rewrite password hashes.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
  `);
  await pool.query(`
    DO $$ BEGIN
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await pool.query(`UPDATE users SET role = 'admin' WHERE username = 'Todd' AND role IS DISTINCT FROM 'admin'`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invites (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      email TEXT,
      token_hash TEXT NOT NULL UNIQUE,
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      revoked_at TIMESTAMP
    );
  `);

  const count = await pool.query(`SELECT COUNT(*)::int AS n FROM users`);
  const userCount = count.rows[0]?.n ?? 0;
  const seed = shouldSeedAdmin(userCount, process.env.SEED_ADMIN_PASSWORD);
  if (seed === 'skip-not-empty') return;
  if (seed === 'skip-no-password') {
    console.warn('Users table is empty and SEED_ADMIN_PASSWORD is not set; skipping admin seed.');
    return;
  }
  if (seed === 'skip-short-password') {
    console.warn('SEED_ADMIN_PASSWORD must be at least 12 characters; skipping admin seed.');
    return;
  }
  const hash = bcrypt.hashSync(process.env.SEED_ADMIN_PASSWORD as string, 10);
  await db.insert(schema.users).values({
    username: 'Todd',
    passwordHash: hash,
    name: 'Todd Kennedy',
    role: 'admin',
    disabled: false,
  });
  console.log('Seeded admin user Todd from SEED_ADMIN_PASSWORD.');
}

export { schema };
