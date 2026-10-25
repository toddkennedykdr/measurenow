import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import * as schema from './schema';
import { SEED_USERS, seedPasswordFromEnv } from './seedUsers';
import { applyWebsiteLeadSchema } from './websiteLeadSchema';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/measurenow';

const pool = new Pool({ connectionString: DATABASE_URL });

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

/** Read-only check for GET /api/health. Does not create tables or write rows. */
export async function pingDatabase(): Promise<boolean> {
  try {
    const result = await pool.query('SELECT 1');
    return result.rows.length === 1;
  } catch {
    return false;
  }
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

  // New table and columns only. Safe to run on every boot.
  await applyWebsiteLeadSchema((sql) => pool.query(sql));

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
