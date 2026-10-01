import { createHash, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';

/** Hash both values so the comparison stays constant-time even when lengths differ. */
function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * True only when ROOF_API_KEY is set and `provided` matches it.
 * If ROOF_API_KEY is unset, the header path is disabled.
 */
export function roofApiKeyMatches(provided: string | undefined | null): boolean {
  const expected = process.env.ROOF_API_KEY;
  if (!expected || !provided) return false;
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/** Logged-in session, or x-api-key matching ROOF_API_KEY. */
export function requireRoofAccess(req: Request, res: Response, next: NextFunction): void {
  if ((req.session as { userId?: number } | undefined)?.userId) {
    next();
    return;
  }
  if (roofApiKeyMatches(req.header('x-api-key'))) {
    next();
    return;
  }
  res.status(401).json({ error: 'Not authenticated' });
}

/** In-memory limit: valid API key shares one bucket; everyone else is limited per IP. */
export const roofRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' },
  keyGenerator: (req) => {
    const header = req.header('x-api-key');
    if (roofApiKeyMatches(header)) {
      return `key:${sha256(process.env.ROOF_API_KEY as string).toString('hex')}`;
    }
    return req.ip || 'unknown';
  },
});
