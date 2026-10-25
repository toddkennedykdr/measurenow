import { pgTable, serial, text, integer, real, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const websiteLeads = pgTable('website_leads', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  address: text('address').notNull(),
  quoteLow: real('quote_low').notNull(),
  quoteHigh: real('quote_high').notNull(),
  roofSqFt: real('roof_sq_ft').notNull(),
  roofSquares: real('roof_squares').notNull(),
  avgPitchDegrees: real('avg_pitch_degrees'),
  pitchOver12: real('pitch_over_12'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  address: text('address').notNull(),
  lat: real('lat'),
  lng: real('lng'),
  roofData: jsonb('roof_data'),
  analysis: jsonb('analysis'),
  quote: jsonb('quote'),
  photos: jsonb('photos'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
