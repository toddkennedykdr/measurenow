import { pgTable, serial, text, integer, real, jsonb, timestamp } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
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
