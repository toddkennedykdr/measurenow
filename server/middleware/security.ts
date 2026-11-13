import { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';
import { accessDecision } from '../authz';

export type SessionUser = {
  id: number;
  name: string;
  username: string;
  role: string;
  disabled: boolean;
};

/** True when the request carries a logged-in staff session. */
export function isStaff(req: Request): boolean {
  return Boolean((req.session as any)?.userId);
}

export async function loadSessionUser(userId: number): Promise<SessionUser | null> {
  const rows = await db.select({
    id: schema.users.id,
    name: schema.users.name,
    username: schema.users.username,
    role: schema.users.role,
    disabled: schema.users.disabled,
  }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return rows[0] ?? null;
}

function sessionUserId(req: Request): number | null {
  const id = (req.session as any)?.userId;
  return typeof id === 'number' && Number.isFinite(id) ? id : null;
}

/** 401 unless the request has a logged-in, enabled account. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = await loadSessionUser(userId);
    if (accessDecision(user, false) !== 200) return res.status(401).json({ error: 'Not authenticated' });
    (req as any).currentUser = user;
    next();
  } catch (err) {
    console.error('auth check failed');
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

/** 401 when logged out or disabled, 403 when the account is not an admin. */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userId = sessionUserId(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const user = await loadSessionUser(userId);
    const code = accessDecision(user, true);
    if (code === 401) return res.status(401).json({ error: 'Not authenticated' });
    if (code === 403) return res.status(403).json({ error: 'Admin only' });
    (req as any).currentUser = user;
    next();
  } catch (err) {
    console.error('admin check failed');
    return res.status(500).json({ error: 'Something went wrong' });
  }
}

/** Same window as the global /api limiter that already covers /api/auth. */
export const adminRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in a minute.' },
});

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// CORS / origin allowlist
// ---------------------------------------------------------------------------
const PROD_ORIGIN = 'https://measurenow-production.up.railway.app';
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3001', 'http://127.0.0.1:5173', 'http://127.0.0.1:3001'];

export function allowedOrigins(): string[] {
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const list = [PROD_ORIGIN, ...extra];
  if (process.env.NODE_ENV !== 'production') list.push(...DEV_ORIGINS);
  return list;
}

function isAllowedOrigin(origin: string, req?: Request): boolean {
  if (allowedOrigins().includes(origin)) return true;
  // Same-origin requests from whatever host actually served the app (e.g. a future custom domain).
  if (req) {
    try {
      return new URL(origin).host === req.get('host');
    } catch {
      return false;
    }
  }
  return false;
}

/** cors() options delegate: reflect + credentials only for allowed origins; foreign origins get no CORS headers. */
export function corsOptionsDelegate(req: Request, cb: (err: Error | null, opts?: any) => void) {
  const origin = req.header('Origin');
  const ok = !origin || isAllowedOrigin(origin, req);
  cb(null, { origin: ok ? origin || false : false, credentials: ok });
}

/** Reject /api requests that carry a foreign Origin header (browser cross-site calls). */
export function blockForeignOrigins(req: Request, res: Response, next: NextFunction) {
  const origin = req.header('Origin');
  if (origin && !isAllowedOrigin(origin, req)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Per-IP limiter (keyed on req.ip; requires app.set('trust proxy', 1) behind Railway)
// Logged-in staff are exempt.
// ---------------------------------------------------------------------------
export function perIpLimit(name: string, windowMs: number, max: number): RequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: req => isStaff(req),
    keyGenerator: req => `${name}:${req.ip}`,
    message: { error: 'Too many requests from your connection. Please try again later or call us at (919) 977-4074.' },
  });
}

// ---------------------------------------------------------------------------
// Daily global cap per endpoint, in memory, resets at midnight America/New_York
// (and on process restart). Fails closed with 429. Staff have a separate, higher cap.
// ---------------------------------------------------------------------------
function etDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const counters = new Map<string, { day: string; count: number }>();

export function dailyCapCount(name: string): number {
  const c = counters.get(name);
  return c && c.day === etDateKey() ? c.count : 0;
}

/** For tests only. */
export function _resetDailyCaps() {
  counters.clear();
}

function bump(name: string, limit: number): boolean {
  const day = etDateKey();
  let c = counters.get(name);
  if (!c || c.day !== day) {
    c = { day, count: 0 };
    counters.set(name, c);
  }
  if (c.count >= limit) return false;
  c.count += 1;
  return true;
}

/**
 * name: endpoint id; publicMax / staffMax: default caps, overridable via env
 * CAP_<NAME>_PUBLIC / CAP_<NAME>_STAFF (e.g. CAP_QUOTE_PUBLIC=200).
 */
export function dailyCap(name: string, publicMax: number, staffMax: number): RequestHandler {
  const envName = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return (req, res, next) => {
    const staff = isStaff(req);
    const limit = staff
      ? envInt(`CAP_${envName}_STAFF`, staffMax)
      : envInt(`CAP_${envName}_PUBLIC`, publicMax);
    const key = `${name}:${staff ? 'staff' : 'public'}`;
    if (!bump(key, limit)) {
      console.warn(`[daily-cap] ${key} reached ${limit} for ${etDateKey()}`);
      return res.status(429).json({
        error: "We've hit today's limit for instant quotes. Please call us at (919) 977-4074 for a free estimate, or try again tomorrow.",
      });
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// HTML escaping for values interpolated into outgoing emails
// ---------------------------------------------------------------------------
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Recursively HTML-escape every string in a JSON-like value (numbers/booleans untouched). */
export function deepEscape<T>(v: T): T {
  if (typeof v === 'string') return escapeHtml(v) as unknown as T;
  if (Array.isArray(v)) return v.map(deepEscape) as unknown as T;
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const [k, val] of Object.entries(v as any)) out[k] = deepEscape(val);
    return out;
  }
  return v;
}
