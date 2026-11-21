import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** Why a request may or may not pass. Disabled accounts are treated as logged out. */
export function accessDecision(user: { role: string; disabled: boolean } | null, adminOnly: boolean): 200 | 401 | 403 {
  if (!user || user.disabled) return 401;
  if (adminOnly && user.role !== 'admin') return 403;
  return 200;
}

/** A live session counts as staff only while that account exists and is enabled. */
export function sessionIsStaff(user: { disabled: boolean } | null): boolean {
  return user != null && user.disabled === false;
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
  const typed = nonStringProblem(token);
  if (typed) return typed;
  const controls = controlCharProblem(token);
  if (controls) return controls;
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

/** C0 and C1 controls, including NUL. None of these belong in credentials or invite fields. */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/;
export const CONTROL_CHAR_ERROR = 'Invalid characters';

export function controlCharProblem(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (CONTROL_CHARS.test(value)) return CONTROL_CHAR_ERROR;
  return null;
}

/**
 * Arrays, numbers, objects, and null are not strings. An omitted field is
 * undefined and stays with the required-field check. Optional email may be null.
 */
export function nonStringProblem(value: unknown, optional = false): string | null {
  if (value === undefined) return null;
  if (optional && value === null) return null;
  if (typeof value !== 'string') return CONTROL_CHAR_ERROR;
  return null;
}

/** True when any string in a JSON value contains a C0 or C1 control character. */
export function controlCharIn(value: unknown): boolean {
  if (typeof value === 'string') return CONTROL_CHARS.test(value);
  if (Array.isArray(value)) return value.some(controlCharIn);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(controlCharIn);
  return false;
}

/** C0 controls other than TAB, LF, and CR. Report prose may keep those three and any other Unicode. */
const REPORT_C0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** True when report text contains NUL or another forbidden C0 control. */
export function nulCharIn(value: unknown): boolean {
  if (typeof value === 'string') return REPORT_C0.test(value);
  if (Array.isArray(value)) return value.some(nulCharIn);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).some(nulCharIn);
  return false;
}

/** Serial ids are positive 32-bit integers. `14abc`, `1e3`, and oversized values are not. */
export function strictRowId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id > 2147483647) return null;
  return id;
}

export function passwordProblem(password: unknown): string | null {
  const typed = nonStringProblem(password);
  if (typed) return typed;
  const controls = controlCharProblem(password);
  if (controls) return controls;
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
  const typed = nonStringProblem(token);
  if (typed) return typed;
  const controls = controlCharProblem(token);
  if (controls) return controls;
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

/** Flags already decided in SQL against NOW(). This function does not read clock values. */
export type ResetGate = {
  used: boolean;
  expired: boolean;
  userDisabled: boolean;
};

export function decidePasswordReset(input: {
  reset: ResetGate | null;
}): 'ok' | 'invalid' | 'used' | 'expired' | 'disabled' {
  if (!input.reset) return 'invalid';
  if (input.reset.used) return 'used';
  if (input.reset.expired) return 'expired';
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
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$/;;

/** Path ids are decimal integers only. `14abc` and `1e3` are not ids. */
export function strictUserId(raw: unknown): number | null {
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) return null;
  return id;
}

export function usernameProblem(username: unknown): string | null {
  const typed = nonStringProblem(username);
  if (typed) return typed;
  const controls = controlCharProblem(username);
  if (controls) return controls;
  if (typeof username !== 'string' || !USERNAME_RE.test(username.trim())) {
    return 'Username must be 2–40 letters, numbers, dots, dashes, or underscores';
  }
  return null;
}

export function emailProblem(email: unknown): string | null {
  const typed = nonStringProblem(email, true);
  if (typed) return typed;
  const controls = controlCharProblem(email);
  if (controls) return controls;
  if (email == null || email === '') return null;
  if (typeof email !== 'string') return 'Enter a valid email or leave it blank';
  const trimmed = email.trim();
  if (!trimmed) return null;
  if (trimmed.length > 120 || /[\s,<>]/.test(trimmed) || !EMAIL_RE.test(trimmed)) return 'Enter a valid email or leave it blank';
  return null;
}

/** Empty clears the address. Anything kept is trimmed and lowercased. */
export function normalizeUserEmail(email: unknown): { ok: true; email: string | null } | { ok: false; error: string } {
  if (email == null) return { ok: true, email: null };
  if (typeof email !== 'string') return { ok: false, error: 'Enter a valid email or leave it blank' };
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) return { ok: true, email: null };
  const problem = emailProblem(trimmed);
  if (problem) return { ok: false, error: problem };
  return { ok: true, email: trimmed };
}

export function nameProblem(name: unknown): string | null {
  const typed = nonStringProblem(name);
  if (typed) return typed;
  const controls = controlCharProblem(name);
  if (controls) return controls;
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
  email?: string | null;
  passwordHash?: string;
  password_hash?: string;
}, options?: { includeEmail?: boolean }) {
  const user = {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role === 'admin' ? 'admin' as const : 'user' as const,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    lastLoginAt: row.lastLoginAt == null ? null : (row.lastLoginAt instanceof Date ? row.lastLoginAt.toISOString() : row.lastLoginAt),
    disabled: Boolean(row.disabled),
  };
  if (!options?.includeEmail) return user;
  const email = normalizeUserEmail(row.email ?? null);
  return { ...user, email: email.ok ? email.email : null };
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
