import { Router, Request, Response } from 'express';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '../db';
import { asyncRoute, requireAuth, SessionUser } from '../middleware/security';
import { CONTROL_CHAR_ERROR, controlCharIn, strictRowId } from '../authz';

export const reportsRouter = Router();

function optionalCoord(value: unknown, min: number, max: number): { ok: true; value: number | null } | { ok: false } {
  if (value == null || value === '') return { ok: true, value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return { ok: false };
  return { ok: true, value };
}

// Save report
reportsRouter.post('/', requireAuth, asyncRoute(async (req: Request, res: Response) => {
  if (controlCharIn(req.body)) return res.status(400).json({ error: CONTROL_CHAR_ERROR });
  const body = req.body || {};
  const { address, lat, lng, roofData, analysis, quote, photos } = body;
  if (typeof address !== 'string' || !address.trim()) return res.status(400).json({ error: 'Address required' });
  const latValue = optionalCoord(lat, -90, 90);
  const lngValue = optionalCoord(lng, -180, 180);
  if (!latValue.ok || !lngValue.ok) return res.status(400).json({ error: 'Bad request' });

  const userId = ((req as any).currentUser as SessionUser).id;
  const result = await db.insert(schema.reports).values({
    userId,
    address,
    lat: latValue.value,
    lng: lngValue.value,
    roofData: roofData || null,
    analysis: analysis || null,
    quote: quote || null,
    photos: photos || null,
  }).returning({ id: schema.reports.id });

  return res.json({ id: result[0].id, success: true });
}));

// List reports
reportsRouter.get('/', requireAuth, asyncRoute(async (req: Request, res: Response) => {
  const userId = ((req as any).currentUser as SessionUser).id;
  const rows = await db.select().from(schema.reports)
    .where(eq(schema.reports.userId, userId))
    .orderBy(desc(schema.reports.createdAt));
  return res.json(rows);
}));

// Get single report
reportsRouter.get('/:id', requireAuth, asyncRoute(async (req: Request, res: Response) => {
  const current = (req as any).currentUser as SessionUser;
  const id = strictRowId(req.params.id);
  if (id == null) return res.status(400).json({ error: 'Invalid report' });
  const rows = await db.select().from(schema.reports)
    .where(eq(schema.reports.id, id))
    .limit(1);
  const report = rows[0];
  if (!report) return res.status(404).json({ error: 'Report not found' });
  if (report.userId !== current.id && current.role !== 'admin') return res.status(404).json({ error: 'Report not found' });
  return res.json(report);
}));
