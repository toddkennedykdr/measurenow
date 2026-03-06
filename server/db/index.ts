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

  // Seed user if not exists
  const existing = await db.select().from(schema.users).where(eq(schema.users.username, 'Todd')).limit(1);
  if (!existing[0]) {
    const hash = bcrypt.hashSync('demo123', 10);
    await db.insert(schema.users).values({ username: 'Todd', passwordHash: hash, name: 'Todd Kennedy' });
    console.log('Seeded user: Todd');
  }
}

export { schema };
