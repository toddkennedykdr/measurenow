import type { PoolClient } from 'pg';
import { hashResetToken, newResetToken } from './authz';

/** Same public origin the reset CLI already uses. Never taken from a request Host header. */
export const RESET_BASE_URL = 'https://measurenow-production.up.railway.app';
export const RESET_EMAIL_HOURS = 1;
export const RESET_COPY_HOURS = 24;
export const RESET_FROM = 'K&D Roofing <noreply@kanddroofingnc.com>';

export const FORGOT_FLOOR_MS = 800;
export const FORGOT_JITTER_MS = 200;
export const FORGOT_WINDOW_MS = 15 * 60_000;
export const FORGOT_MAX = 5;

export function passwordResetUrl(token: string, baseUrl: string = RESET_BASE_URL): string {
  return `${baseUrl}/reset/${token}`;
}

export function resetEmailConfigured(): boolean {
  const key = process.env.RESEND_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

export function resetLinkFallbackReason(hasEmail: boolean): 'No email on file' | 'Email not configured' {
  return hasEmail ? 'Email not configured' : 'No email on file';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function expiryPhrase(hours: number): string {
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export type ResetIssue =
  | { ok: true; token: string; expiresUtc: string; expiresEt: string }
  | { ok: false; reason: 'missing' | 'disabled' };

/**
 * Invalidate unused links for this user and insert one new hash.
 * The caller owns the transaction. Disabled users get no row and no hash.
 */
export async function issuePasswordReset(client: PoolClient, userId: number, hours: number): Promise<ResetIssue> {
  const found = await client.query(
    `SELECT id, disabled FROM users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  const user = found.rows[0];
  if (!user) return { ok: false, reason: 'missing' };
  if (user.disabled) return { ok: false, reason: 'disabled' };

  await client.query(
    `UPDATE password_resets SET used_at = (NOW() AT TIME ZONE 'UTC') WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  const token = newResetToken();
  const inserted = await client.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at)
     VALUES ($1, $2, (NOW() AT TIME ZONE 'UTC') + make_interval(hours => trunc($3::numeric)::int, secs => (($3::numeric - trunc($3::numeric)) * 3600)::double precision))
     RETURNING
       to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_utc,
       to_char((expires_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI:SS') AS expires_et`,
    [userId, hashResetToken(token), hours],
  );
  const expiresUtc = inserted.rows[0]?.expires_utc;
  const expiresEt = inserted.rows[0]?.expires_et;
  if (typeof expiresUtc !== 'string' || typeof expiresEt !== 'string') {
    throw new Error('reset-expiry-missing');
  }
  return { ok: true, token, expiresUtc, expiresEt };
}

/** Plain reset mail. The link is the body, not a log line. */
export async function sendPasswordResetEmail(to: string, link: string, hours: number): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !apiKey.trim()) throw new Error('reset-email-not-configured');
  const expires = expiryPhrase(hours);
  const text = [
    'K&D Roofing',
    '',
    `Use this link to reset your MeasureNow password. It expires in ${expires}.`,
    '',
    link,
    '',
    'If you did not ask for this, you can ignore this email.',
    '',
    'K&D Roofing',
    '(919) 977-4074',
  ].join('\n');
  const safeExpires = escapeHtml(expires);
  const safeLink = escapeHtml(link);
  const html = [
    '<p><strong>K&amp;D Roofing</strong></p>',
    `<p>Use this link to reset your MeasureNow password. It expires in ${safeExpires}.</p>`,
    `<p><a href="${safeLink}">${safeLink}</a></p>`,
    '<p>If you did not ask for this, you can ignore this email.</p>',
    '<p>K&amp;D Roofing<br>(919) 977-4074</p>',
  ].join('');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: RESET_FROM,
      to: [to],
      subject: 'Reset your K&D Roofing password',
      text,
      html,
    }),
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error('reset-email-failed');
}

export const FORGOT_CAP = 1000;
const forgotHits = new Map<string, number[]>();

function isLiveAccountBucket(key: string): boolean {
  return key.startsWith('acct:id:');
}

function pruneExpired(now: number) {
  for (const [key, stamps] of forgotHits) {
    const kept = stamps.filter((at) => now - at < FORGOT_WINDOW_MS);
    if (kept.length === 0) forgotHits.delete(key);
    else forgotHits.set(key, kept);
  }
}

/** Drop expired rows, then IP and unknown-identifier buckets. Live id: buckets stay. */
function evictDisposable(preserve: string[] = []) {
  if (forgotHits.size <= FORGOT_CAP) return;
  for (const key of [...forgotHits.keys()]) {
    if (forgotHits.size <= FORGOT_CAP) break;
    if (isLiveAccountBucket(key) || preserve.includes(key)) continue;
    forgotHits.delete(key);
  }
}

function roomFor(extra: number, preserve: string[]): boolean {
  if (extra <= 0 || forgotHits.size + extra <= FORGOT_CAP) return true;
  for (const key of [...forgotHits.keys()]) {
    if (forgotHits.size + extra <= FORGOT_CAP) break;
    if (isLiveAccountBucket(key) || preserve.includes(key)) continue;
    forgotHits.delete(key);
  }
  return forgotHits.size + extra <= FORGOT_CAP;
}

const forgotPruneTimer = setInterval(() => {
  const now = Date.now();
  pruneExpired(now);
  evictDisposable();
}, 60_000);
if (typeof forgotPruneTimer.unref === 'function') forgotPruneTimer.unref();

function hitsWithin(key: string, now: number): number[] {
  const kept = (forgotHits.get(key) || []).filter((at) => now - at < FORGOT_WINDOW_MS);
  if (kept.length === 0) forgotHits.delete(key);
  else forgotHits.set(key, kept);
  return kept;
}

export type ForgotDecision = 'allow' | 'limited' | 'closed';

/**
 * 'limited' is the 5-hit window. 'closed' means a new bucket would not fit
 * without dropping a live per-account bucket, so the caller sends nothing.
 */
export function forgotDecision(ip: string, accountKey: string | null, now: number): ForgotDecision {
  pruneExpired(now);
  evictDisposable();
  const ipKey = `ip:${ip}`;
  const acctKey = accountKey ? `acct:${accountKey}` : null;
  const preserve = acctKey ? [ipKey, acctKey] : [ipKey];
  const ipHits = hitsWithin(ipKey, now);
  const accountHits = acctKey ? hitsWithin(acctKey, now) : null;
  if (ipHits.length >= FORGOT_MAX) return 'limited';
  if (accountHits && accountHits.length >= FORGOT_MAX) return 'limited';
  const extra = preserve.filter(key => !forgotHits.has(key)).length;
  if (!roomFor(extra, preserve)) return 'closed';
  ipHits.push(now);
  forgotHits.set(ipKey, ipHits);
  if (accountHits && acctKey) {
    accountHits.push(now);
    forgotHits.set(acctKey, accountHits);
  }
  evictDisposable(preserve);
  return 'allow';
}

/** True when this IP or this account key is over the window. A session cookie is not consulted. */
export function forgotLimitedAt(ip: string, accountKey: string | null, now: number): boolean {
  return forgotDecision(ip, accountKey, now) !== 'allow';
}

export function forgotLimited(ip: string, accountKey: string | null): boolean {
  return forgotDecision(ip, accountKey, Date.now()) === 'limited';
}

export function forgotBucketCount(): number {
  return forgotHits.size;
}

export function forgotWaitMs(): number {
  return FORGOT_FLOOR_MS + Math.floor(Math.random() * (FORGOT_JITTER_MS + 1));
}

export function waitForForgot(started: number, waitMs: number): Promise<void> {
  const remain = waitMs - (Date.now() - started);
  if (remain <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, remain));
}

export type ForgotLookup =
  | { kind: 'email'; email: string }
  | { kind: 'username'; username: string }
  | null;

/** Login stays case-sensitive. Forgot-password matches either field without regard to case. */
export function forgotAccountKey(raw: unknown): { key: string | null; lookup: ForgotLookup } {
  if (typeof raw !== 'string') return { key: null, lookup: null };
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 200) return { key: null, lookup: null };
  if (trimmed.includes('@')) {
    const email = trimmed.toLowerCase();
    return { key: `email:${email}`, lookup: { kind: 'email', email } };
  }
  return { key: `user:${trimmed.toLowerCase()}`, lookup: { kind: 'username', username: trimmed } };
}
