import type { Request } from 'express';
import rateLimit from 'express-rate-limit';

export const LEAD_RATE_LIMIT_MAX = 5;
export const LEAD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const LEAD_RATE_LIMIT_MESSAGE =
  'Too many submissions from this network. Please wait a few minutes and try again, or call K&D Roofing at 919-977-4074.';

/**
 * Client address from Express `req.ip`.
 * server/index.ts sets `trust proxy` to 1, so only the connecting proxy hop
 * is trusted. A client-supplied earlier X-Forwarded-For value is not the key.
 */
export function clientIp(req: Request): string {
  return req.ip || 'unknown';
}

/** Public lead capture only. Quote routes keep the existing roof limiter. */
export const leadCaptureRateLimit = rateLimit({
  windowMs: LEAD_RATE_LIMIT_WINDOW_MS,
  max: LEAD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: LEAD_RATE_LIMIT_MESSAGE },
  keyGenerator: (req) => clientIp(req),
});
