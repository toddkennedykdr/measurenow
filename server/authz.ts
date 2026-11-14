import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Why a request may or may not pass. Disabled accounts are treated as logged out. */
export function accessDecision(user: { role: string; disabled: boolean } | null, adminOnly: boolean): 200 | 401 | 403 {
  if (!user || user.disabled) return 401;
  if (adminOnly && user.role !== 'admin') return 403;
  return 200;
}

export function shouldSeedAdmin(userCount: number, password: string | undefined): 'seed' | 'skip-not-empty' | 'skip-no-password' | 'skip-short-password' {
  if (userCount > 0) return 'skip-not-empty';
  if (!password) return 'skip-no-password';
  if (password.length < 12) return 'skip-short-password';
  return 'seed';
}

/** 128-bit token, hex so it is safe in a URL. */
export function newInviteToken(): string {
  return randomBytes(16).toString('hex');
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function inviteTokenProblem(token: unknown): string | null {
  if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return 'Invite link is invalid';
  return null;
}

export function tokenMatches(storedHash: string, token: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedHash)) return false;
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(hashInviteToken(token), 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 12) return 'Password must be at least 12 characters';
  if (password.length > 200) return 'Password is too long';
  return null;
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** One-time password reset links. 32 bytes, base64url, stored only as SHA-256. */
export const RESET_TOKEN_BYTES = 32;
export const RESET_MAX_HOURS = 24;
export const RESET_DEFAULT_HOURS = 24;
export const RESET_LINK_ERROR = 'This reset link is invalid or has expired';

const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newResetToken(): string {
  return randomBytes(RESET_TOKEN_BYTES).toString('base64url');
}

export function hashResetToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function resetTokenProblem(token: unknown): string | null {
  if (typeof token !== 'string' || !RESET_TOKEN_RE.test(token)) return RESET_LINK_ERROR;
  return null;
}

/** Positive hours up to 24. Anything else is refused. */
export function parseResetHours(raw: string): number | null {
  const text = raw.trim().replace(/h$/i, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const hours = Number(text);
  if (!Number.isFinite(hours) || hours <= 0 || hours > RESET_MAX_HOURS) return null;
  return hours;
}

/** Minting is limited to Todd unless the operator passes an explicit flag. */
export function mintResetUserAllowed(username: string, allowOther: boolean): boolean {
  return username === 'Todd' || allowOther === true;
}

export type ResetGate = {
  usedAt: Date | string | null;
  expiresAt: Date | string;
  userDisabled: boolean;
};

export function decidePasswordReset(input: {
  reset: ResetGate | null;
  now?: Date;
}): 'ok' | 'invalid' | 'used' | 'expired' | 'disabled' {
  if (!input.reset) return 'invalid';
  if (input.reset.usedAt) return 'used';
  const now = input.now ?? new Date();
  const expires = new Date(input.reset.expiresAt);
  if (!(expires.getTime() > now.getTime())) return 'expired';
  if (input.reset.userDisabled) return 'disabled';
  return 'ok';
}

/** Every refusal looks the same. Callers must not describe which check failed. */
export function passwordResetError(decision: ReturnType<typeof decidePasswordReset>): string | null {
  return decision === 'ok' ? null : RESET_LINK_ERROR;
}

export type InviteGate = {
  usedAt: Date | string | null;
  revokedAt: Date | string | null;
  expiresAt: Date | string;
};

export function decideInviteAccept(input: {
  invite: InviteGate | null;
  usernameTaken: boolean;
  now?: Date;
}): 'ok' | 'invalid' | 'used' | 'revoked' | 'expired' | 'username-taken' {
  if (!input.invite) return 'invalid';
  if (input.invite.usedAt) return 'used';
  if (input.invite.revokedAt) return 'revoked';
  const now = input.now ?? new Date();
  const expires = new Date(input.invite.expiresAt);
  if (!(expires.getTime() > now.getTime())) return 'expired';
  if (input.usernameTaken) return 'username-taken';
  return 'ok';
}

const USERNAME_RE = /^[A-Za-z0-9._-]{2,40}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function usernameProblem(username: unknown): string | null {
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return 'Username must be 2–40 letters, numbers, dots, dashes, or underscores';
  }
  return null;
}

export function emailProblem(email: unknown): string | null {
  if (email == null || email === '') return null;
  if (typeof email !== 'string' || email.length > 120 || !EMAIL_RE.test(email.trim())) return 'Enter a valid email or leave it blank';
  return null;
}

export function nameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) return 'Name is required';
  return null;
}

/** Fields an admin is allowed to see. Password hashes never leave this function. */
export function publicUser(row: {
  id: number;
  name: string;
  username: string;
  role: string;
  createdAt: Date | string;
  lastLoginAt?: Date | string | null;
  disabled?: boolean | null;
  passwordHash?: string;
  password_hash?: string;
}) {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role === 'admin' ? 'admin' as const : 'user' as const,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    lastLoginAt: row.lastLoginAt == null ? null : (row.lastLoginAt instanceof Date ? row.lastLoginAt.toISOString() : row.lastLoginAt),
    disabled: Boolean(row.disabled),
  };
}

function asObj(v: unknown): Record<string, any> {
  if (!v) return {};
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return p && typeof p === 'object' ? p : {}; } catch { return {}; }
  }
  if (typeof v === 'object') return v as Record<string, any>;
  return {};
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * A saved inspection report is the app's order: who measured it, the address,
 * and the roof totals stored on that report. Raw analysis and photos are dropped.
 */
export function summarizeOrder(input: {
  id: number;
  userId: number;
  userName: string;
  username: string;
  address: string;
  createdAt: Date | string;
  roofData: unknown;
  quote: unknown;
  analysis: unknown;
}) {
  const roof = asObj(input.roofData);
  const quote = asObj(input.quote);
  const analysis = asObj(input.analysis);
  const area = num(roof.totalAreaSqFt);
  const squaresRaw = num(quote.roofSquares);
  const squares = squaresRaw != null ? squaresRaw : (area != null ? Math.round((area / 100) * 10) / 10 : null);
  const rating = typeof analysis?.overallCondition?.rating === 'string' ? analysis.overallCondition.rating : '';
  const hasAnalysis = Object.keys(analysis).length > 0;
  const status = rating || (hasAnalysis ? 'inspected' : 'measured');
  return {
    id: input.id,
    userId: input.userId,
    userName: input.userName,
    username: input.username,
    address: input.address,
    createdAt: input.createdAt instanceof Date ? input.createdAt.toISOString() : input.createdAt,
    status,
    areaSqFt: area,
    squares,
    quoteLow: num(quote.lowEstimate),
    quoteHigh: num(quote.highEstimate),
  };
}
