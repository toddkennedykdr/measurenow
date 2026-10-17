import type { Express } from 'express';
import { requireRoofAccessUnlessPublic, roofRateLimit } from './middleware/roofAccess';
import { inspectRouter } from './routes/inspect';
import { roofRouter } from './routes/roof';

/**
 * Public quote widget (no login, still per-IP limited):
 *   GET  /api/roof/maps-key
 *   POST /api/roof/geocode
 *   POST /api/roof/quote
 * Staff routes on this prefix (analyze-photos, send-report, and anything
 * added later) stay behind a logged-in session or ROOF_API_KEY.
 */
export function mountRoofRoutes(app: Express): void {
  app.use('/api/roof', roofRateLimit, requireRoofAccessUnlessPublic);
  app.use('/api/roof', roofRouter);
  app.use('/api/roof', inspectRouter);
}
