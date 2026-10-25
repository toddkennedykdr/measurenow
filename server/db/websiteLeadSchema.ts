/**
 * Additive website-lead schema. Every statement is safe to run twice.
 * Existing users and reports rows are not updated or deleted.
 */
export const WEBSITE_LEAD_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS website_leads (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      quote_low REAL NOT NULL,
      quote_high REAL NOT NULL,
      roof_sq_ft REAL NOT NULL,
      roof_squares REAL NOT NULL,
      avg_pitch_degrees REAL,
      pitch_over_12 REAL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS quote_low REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS quote_high REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS roof_sq_ft REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS roof_squares REAL NOT NULL DEFAULT 0`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS avg_pitch_degrees REAL`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS pitch_over_12 REAL`,
  `ALTER TABLE website_leads ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()`,
];

export async function applyWebsiteLeadSchema(
  query: (sql: string) => Promise<unknown>,
): Promise<void> {
  for (const statement of WEBSITE_LEAD_DDL) {
    await query(statement);
  }
}
