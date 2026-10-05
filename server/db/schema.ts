import { pgTable, serial, text, integer, real, jsonb, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role').notNull().default('user'),
  disabled: boolean('disabled').notNull().default(false),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const invites = pgTable('invites', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  username: text('username').notNull(),
  email: text('email'),
  tokenHash: text('token_hash').notNull().unique(),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
  usedAt: timestamp('used_at'),
  revokedAt: timestamp('revoked_at'),
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
