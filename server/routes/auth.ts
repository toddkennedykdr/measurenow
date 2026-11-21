import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { asyncRoute, loadSessionUser, perIpLimit, requireAuth } from '../middleware/security';
import { destroySessionsForUser } from '../sessionStore';
import {
  CONTROL_CHAR_ERROR,
  controlCharProblem,
  decideInviteAccept,
  decidePasswordReset,
  hashInviteToken,
  hashResetToken,
  inviteTokenProblem,
  normalizeUserEmail,
  passwordProblem,
  passwordResetError,
  RESET_LINK_ERROR,
  resetTokenProblem,
} from '../authz';
import {
  forgotAccountKey,
  forgotLimited,
  forgotWaitMs,
  issuePasswordReset,
  passwordResetUrl,
  RESET_EMAIL_HOURS,
  resetEmailConfigured,
  sendPasswordResetEmail,
  waitForForgot,
} from '../passwordReset';

export const authRouter = Router();

authRouter.post('/login', asyncRoute(async (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (controlCharProblem(username) || controlCharProblem(password)) {
    return res.status(400).json({ error: CONTROL_CHAR_ERROR });
  }
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const rows = await db.select().from(schema.users).where(eq(schema.users.username, username)).limit(1);
  const user = rows[0];
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (user.disabled) {
    return res.status(403).json({ error: 'This account is disabled' });
  }

  await db.update(schema.users).set({ lastLoginAt: new Date() }).where(eq(schema.users.id, user.id));
  (req.session as any).userId = user.id;
  (req.session as any).userName = user.name;
  return res.json({ id: user.id, name: user.name, username: user.username, role: user.role === 'admin' ? 'admin' : 'user' });
}));

authRouter.post('/logout', asyncRoute((req: Request, res: Response, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    return res.json({ ok: true });
  });
}));

authRouter.get('/me', asyncRoute(async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = await loadSessionUser(userId);
  if (!user || user.disabled) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.json({ id: user.id, name: user.name, username: user.username, role: user.role === 'admin' ? 'admin' : 'user' });
}));

// Invitee sets their own password. Does not change an existing account.
authRouter.post('/accept-invite', perIpLimit('invite-accept', 15 * 60_000, 20), asyncRoute(async (req: Request, res: Response) => {
  const tokenError = inviteTokenProblem(req.body?.token);
  if (tokenError) return res.status(400).json({ error: tokenError });
  const pwError = passwordProblem(req.body?.password);
  if (pwError) return res.status(400).json({ error: pwError });
  const token = req.body.token as string;
  const password = req.body.password as string;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, name, username, email, used_at, revoked_at, expires_at FROM invites WHERE token_hash = $1 FOR UPDATE`,
      [hashInviteToken(token)],
    );
    const row = found.rows[0];
    const taken = row
      ? await client.query(`SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1`, [row.username])
      : { rows: [] };
    const decision = decideInviteAccept({
      invite: row ? { usedAt: row.used_at, revokedAt: row.revoked_at, expiresAt: row.expires_at } : null,
      usernameTaken: taken.rows.length > 0,
    });
    if (decision === 'invalid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invite link is invalid' });
    }
    if (decision === 'used') {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This invite has already been used' });
    }
    if (decision === 'revoked') {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This invite has been revoked' });
    }
    if (decision === 'expired') {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This invite has expired' });
    }
    if (decision === 'username-taken') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'An account with that username already exists. This invite cannot change an existing password.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const normalizedEmail = normalizeUserEmail(row.email);
    const email = normalizedEmail.ok ? normalizedEmail.email : null;
    await client.query(
      `INSERT INTO users (username, password_hash, name, role, disabled, email) VALUES ($1, $2, $3, 'user', false, $4)`,
      [row.username, passwordHash, row.name, email],
    );
    const marked = await client.query(
      `UPDATE invites SET used_at = NOW() WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
      [row.id],
    );
    if (!marked.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(410).json({ error: 'This invite has already been used' });
    }
    await client.query('COMMIT');
    return res.json({ ok: true, username: row.username });
  } catch (err: any) {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    if (err?.code === '23505') {
      return res.status(409).json({ error: 'An account with that username already exists. This invite cannot change an existing password.' });
    }
    console.error('accept-invite failed');
    return res.status(500).json({ error: 'Could not create the account' });
  } finally {
    client.release();
  }
}));

const resetLimit = perIpLimit('reset-password', 15 * 60_000, 20);

function resetRowGate(row: { used: boolean; expired: boolean; user_disabled: boolean } | undefined) {
  return decidePasswordReset({
    reset: row
      ? { used: row.used, expired: row.expired, userDisabled: Boolean(row.user_disabled) }
      : null,
  });
}

authRouter.get('/reset-password/:token', resetLimit, asyncRoute(async (req: Request, res: Response) => {
  const tokenError = resetTokenProblem(req.params.token);
  if (tokenError) return res.status(400).json({ error: tokenError });
  try {
    const found = await pool.query(
      `SELECT u.disabled AS user_disabled,
              (r.used_at IS NOT NULL) AS used,
              (r.expires_at <= (NOW() AT TIME ZONE 'UTC')) AS expired
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = $1`,
      [hashResetToken(req.params.token)],
    );
    const problem = passwordResetError(resetRowGate(found.rows[0]));
    if (problem) return res.status(400).json({ error: problem });
    return res.json({ ok: true });
  } catch {
    console.error('reset-password check failed');
    return res.status(500).json({ error: 'Could not check the reset link' });
  }
}));

// One-time link. Refusals stay generic so a caller cannot tell unknown, used, expired, and disabled apart.
authRouter.post('/reset-password', resetLimit, asyncRoute(async (req: Request, res: Response) => {
  const tokenError = resetTokenProblem(req.body?.token);
  if (tokenError) return res.status(400).json({ error: tokenError });
  const pwError = passwordProblem(req.body?.password);
  if (pwError) return res.status(400).json({ error: pwError });
  const token = req.body.token as string;
  const password = req.body.password as string;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT r.id, r.user_id,
              u.disabled AS user_disabled,
              (r.used_at IS NOT NULL) AS used,
              (r.expires_at <= (NOW() AT TIME ZONE 'UTC')) AS expired
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
       WHERE r.token_hash = $1
       FOR UPDATE OF r`,
      [hashResetToken(token)],
    );
    const row = found.rows[0];
    const problem = passwordResetError(resetRowGate(row));
    if (problem || !row) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: problem || RESET_LINK_ERROR });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const updated = await client.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
      [passwordHash, row.user_id],
    );
    if (!updated.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: RESET_LINK_ERROR });
    }
    const marked = await client.query(
      `UPDATE password_resets
       SET used_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1 AND used_at IS NULL
       RETURNING id`,
      [row.id],
    );
    if (!marked.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: RESET_LINK_ERROR });
    }
    await client.query('COMMIT');
    try {
      await destroySessionsForUser(Number(row.user_id));
    } catch {
      console.error('session revoke failed');
    }
    return res.json({ ok: true });
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    console.error('reset-password failed');
    return res.status(500).json({ error: 'Could not reset the password' });
  } finally {
    client.release();
  }
}));

const FORGOT_OK = { ok: true };
const FORGOT_LIMIT = { error: 'Too many reset requests. Please wait and try again.' };

async function findForgotUser(lookup: ReturnType<typeof forgotAccountKey>['lookup']) {
  if (!lookup) return null;
  const found = lookup.kind === 'email'
    ? await pool.query(
      `SELECT id, disabled, email FROM users WHERE lower(email) = $1`,
      [lookup.email],
    )
    : await pool.query(
      `SELECT id, disabled, email FROM users WHERE lower(username) = lower($1)`,
      [lookup.username],
    );
  if (found.rows.length !== 1) return null;
  return found.rows[0] as { id: number; disabled: boolean; email: string | null };
}

/** Mint after the response clock has started. The Resend call runs only after commit and is not awaited. */
async function queueForgotSend(user: { id: number; disabled: boolean; email: string | null }) {
  const address = typeof user.email === 'string' ? user.email.trim() : '';
  if (user.disabled || !address || !resetEmailConfigured()) return;
  const client = await pool.connect();
  let token = '';
  try {
    await client.query('BEGIN');
    const issued = await issuePasswordReset(client, Number(user.id), RESET_EMAIL_HOURS);
    if (!issued.ok) {
      await client.query('ROLLBACK');
      return;
    }
    const fresh = await client.query(`SELECT email, disabled FROM users WHERE id = $1`, [user.id]);
    const currentEmail = typeof fresh.rows[0]?.email === 'string' ? fresh.rows[0].email.trim() : '';
    if (!currentEmail || fresh.rows[0]?.disabled) {
      await client.query('ROLLBACK');
      return;
    }
    token = issued.token;
    await client.query('COMMIT');
    const link = passwordResetUrl(token);
    void sendPasswordResetEmail(currentEmail, link, RESET_EMAIL_HOURS).catch(() => {
      console.error('reset email failed');
    });
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    console.error('forgot-password failed');
  } finally {
    client.release();
  }
}

// Always the same 200. A logged-in cookie does not skip the limiter.
authRouter.post('/forgot-password', asyncRoute(async (req: Request, res: Response) => {
  const started = Date.now();
  const waitMs = forgotWaitMs();
  const parsed = forgotAccountKey(req.body?.identifier);
  let accountKey = parsed.key;
  let user: { id: number; disabled: boolean; email: string | null } | null = null;
  try {
    user = await findForgotUser(parsed.lookup);
    if (user) accountKey = `id:${Number(user.id)}`;
  } catch {
    console.error('forgot-password failed');
  }
  if (forgotLimited(String(req.ip || ''), accountKey)) {
    return res.status(429).json(FORGOT_LIMIT);
  }
  try {
    if (user) await queueForgotSend(user);
  } catch {
    console.error('forgot-password failed');
  }
  await waitForForgot(started, waitMs);
  return res.json(FORGOT_OK);
}));

authRouter.post('/change-password', requireAuth, asyncRoute(async (req: Request, res: Response) => {
  const pwError = passwordProblem(req.body?.password);
  if (pwError) return res.status(400).json({ error: pwError });
  const currentPassword = req.body?.currentPassword;
  if (controlCharProblem(currentPassword)) return res.status(400).json({ error: CONTROL_CHAR_ERROR });
  if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
    return res.status(400).json({ error: 'Current password is required' });
  }
  const userId = (req as any).currentUser.id as number;
  try {
    const found = await pool.query(
      `SELECT password_hash, disabled FROM users WHERE id = $1`,
      [userId],
    );
    const row = found.rows[0];
    if (!row || row.disabled) return res.status(401).json({ error: 'Not authenticated' });
    let matches = false;
    try {
      matches = bcrypt.compareSync(currentPassword, row.password_hash);
    } catch {
      matches = false;
    }
    if (!matches) return res.status(400).json({ error: 'Current password is incorrect' });

    const passwordHash = await bcrypt.hash(req.body.password as string, 10);
    const updated = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
      [passwordHash, userId],
    );
    if (!updated.rows[0] || Number(updated.rows[0].id) !== Number(userId)) {
      return res.status(500).json({ error: 'Could not change the password' });
    }
    return res.json({ ok: true });
  } catch {
    console.error('change-password failed');
    return res.status(500).json({ error: 'Could not change the password' });
  }
}));

if (process.env.ROUTE_FAULT === '1') {
  authRouter.get('/__fault', asyncRoute(async () => {
    const err = new Error('forced');
    (err as NodeJS.ErrnoException).code = 'EFAULT';
    throw err;
  }));
  authRouter.get('/__pool-fault', asyncRoute(async (_req: Request, res: Response) => {
    const err = new Error('poolprobe9f3a');
    (err as NodeJS.ErrnoException).code = 'ECONNRESET';
    pool.emit('error', err);
    return res.json({ ok: true });
  }));
}
