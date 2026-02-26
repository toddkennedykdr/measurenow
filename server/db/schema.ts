import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});

export const reports = sqliteTable('reports', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  address: text('address').notNull(),
  lat: integer('lat', { mode: 'number' }).$type<number>(),
  lng: integer('lng', { mode: 'number' }).$type<number>(),
  roofData: text('roof_data', { mode: 'json' }),
  analysis: text('analysis', { mode: 'json' }),
  quote: text('quote', { mode: 'json' }),
  photos: text('photos', { mode: 'json' }),
  createdAt: text('created_at').notNull().$defaultFn(() => new Date().toISOString()),
});
