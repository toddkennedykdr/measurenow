import { desc } from 'drizzle-orm';
import { db, schema } from './index';

export type NewWebsiteLead = {
  name: string;
  email: string;
  phone: string;
  address: string;
  quoteLow: number;
  quoteHigh: number;
  roofSqFt: number;
  roofSquares: number;
  avgPitchDegrees?: number;
  pitchOver12?: number;
};

export type StoredWebsiteLead = {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  quoteLow: number;
  quoteHigh: number;
  roofSqFt: number;
  roofSquares: number;
  avgPitchDegrees: number | null;
  pitchOver12: number | null;
  createdAt: string;
};

export type WebsiteLeadStore = {
  insert(lead: NewWebsiteLead): Promise<{ id: number }>;
  list(): Promise<StoredWebsiteLead[]>;
};

const dbStore: WebsiteLeadStore = {
  async insert(lead) {
    const rows = await db.insert(schema.websiteLeads).values({
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      address: lead.address,
      quoteLow: lead.quoteLow,
      quoteHigh: lead.quoteHigh,
      roofSqFt: lead.roofSqFt,
      roofSquares: lead.roofSquares,
      avgPitchDegrees: lead.avgPitchDegrees ?? null,
      pitchOver12: lead.pitchOver12 ?? null,
    }).returning({ id: schema.websiteLeads.id });
    return { id: rows[0].id };
  },
  async list() {
    const rows = await db.select().from(schema.websiteLeads)
      .orderBy(desc(schema.websiteLeads.createdAt));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      address: row.address,
      quoteLow: row.quoteLow,
      quoteHigh: row.quoteHigh,
      roofSqFt: row.roofSqFt,
      roofSquares: row.roofSquares,
      avgPitchDegrees: row.avgPitchDegrees,
      pitchOver12: row.pitchOver12,
      createdAt: row.createdAt.toISOString(),
    }));
  },
};

let current: WebsiteLeadStore = dbStore;

export function websiteLeadStore(): WebsiteLeadStore {
  return current;
}

export function setWebsiteLeadStoreForTests(store: WebsiteLeadStore): void {
  current = store;
}

export function resetWebsiteLeadStoreForTests(): void {
  current = dbStore;
}
