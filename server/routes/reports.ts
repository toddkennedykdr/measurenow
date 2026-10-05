import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db';
import { requireAuth, SessionUser } from '../middleware/security';

export const reportsRouter = Router();

// Save report
reportsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = ((req as any).currentUser as SessionUser).id;
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
  const userId = ((req as any).currentUser as SessionUser).id;
  const rows = await db.select().from(schema.reports)
    .where(eq(schema.reports.userId, userId))
    .orderBy(desc(schema.reports.createdAt));
  return res.json(rows);
});

// Get single report
reportsRouter.get('/:id', requireAuth, async (req: Request, res: Response) => {
  const current = (req as any).currentUser as SessionUser;
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).json({ error: 'Report not found' });
  const rows = await db.select().from(schema.reports)
    .where(eq(schema.reports.id, id))
    .limit(1);
  const report = rows[0];
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (report.userId !== current.id && current.role !== 'admin') return res.status(404).json({ error: 'Report not found' });
  return res.json(report);
});
