import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db';
import { users } from '../db/schema';

export const reportsRouter = Router();

// Auth middleware
function requireAuth(req: Request, res: Response, next: any) {
  if (!(req.session as any)?.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// Save report
reportsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.session as any).userId;
  const { address, lat, lng, roofData, analysis, quote, photos } = req.body;
  if (!address) return res.status(400).json({ error: 'Address required' });

  const result = await db.insert(schema.reports).values({
    userId,
    address,
    lat: lat || null,
    lng: lng || null,
    roofData: roofData || null,
    analysis: analysis || null,
    quote: quote || null,
    photos: photos || null,
  }).returning({ id: schema.reports.id });

  return res.json({ id: result[0].id, success: true });
});

// List reports
reportsRouter.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.session as any).userId;
  const rows = await db.select().from(schema.reports)
    .where(eq(schema.reports.userId, userId))
    .orderBy(desc(schema.reports.createdAt));
  return res.json(rows);
});

// Admin: list ALL reports from all users
reportsRouter.get('/admin/all', requireAuth, async (req: Request, res: Response) => {
  if (!(req.session as any).isAdmin) return res.status(403).json({ error: 'Admin only' });
  const rows = await db.select({
    id: schema.reports.id,
    userId: schema.reports.userId,
    address: schema.reports.address,
    lat: schema.reports.lat,
    lng: schema.reports.lng,
    roofData: schema.reports.roofData,
    analysis: schema.reports.analysis,
    quote: schema.reports.quote,
    photos: schema.reports.photos,
    createdAt: schema.reports.createdAt,
    userName: users.name,
    username: users.username,
  })
    .from(schema.reports)
    .innerJoin(users, eq(schema.reports.userId, users.id))
    .orderBy(desc(schema.reports.createdAt));
  return res.json(rows);
});

// Get single report
reportsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req.session as any).userId;
  const id = parseInt(req.params.id);
  const rows = await db.select().from(schema.reports)
    .where(eq(schema.reports.id, id))
    .limit(1);
  const report = rows[0];
  const isAdmin = (req.session as any).isAdmin;
  if (!report || (!isAdmin && report.userId !== userId)) return res.status(404).json({ error: 'Report not found' });
  return res.json(report);
});
