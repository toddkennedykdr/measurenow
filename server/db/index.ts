import { Pool } from 'pg';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import * as schema from './schema';

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/measurenow';

const pool = new Pool({ connectionString: DATABASE_URL });

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

export async function initDb() {
  // Create tables
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

  // Add is_admin column if missing (migration)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;`);
  // Ensure Todd is admin
  await pool.query(`UPDATE users SET is_admin = true WHERE username = 'Todd';`);

  // Seed users if not exists
  const seedUsers = [
    { username: 'Todd', password: 'demo123', name: 'Todd Kennedy', isAdmin: true },
    { username: 'Isaac', password: 'kd2026!', name: 'Isaac Klick', isAdmin: false },
    { username: 'Rob', password: 'kd2026!', name: 'Robert Copp', isAdmin: false },
  ];
  for (const u of seedUsers) {
    const existing = await db.select().from(schema.users).where(eq(schema.users.username, u.username)).limit(1);
    if (!existing[0]) {
      const hash = bcrypt.hashSync(u.password, 10);
      await db.insert(schema.users).values({ username: u.username, passwordHash: hash, name: u.name, isAdmin: u.isAdmin });
      console.log(`Seeded user: ${u.username}`);
    }
  }
}

export { schema };
