import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { loadSessionUser, perIpLimit, requireAuth } from '../middleware/security';
import {
  decideInviteAccept,
  decidePasswordReset,
  hashInviteToken,
  hashResetToken,
  inviteTokenProblem,
  passwordProblem,
  passwordResetError,
  RESET_LINK_ERROR,
  resetTokenProblem,
} from '../authz';

export const authRouter = Router();

authRouter.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;
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
});

authRouter.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {});
  return res.json({ ok: true });
});

authRouter.get('/me', async (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = await loadSessionUser(userId);
  if (!user || user.disabled) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Not authenticated' });
  }
  return res.json({ id: user.id, name: user.name, username: user.username, role: user.role === 'admin' ? 'admin' : 'user' });
});

// Invitee sets their own password. Does not change an existing account.
authRouter.post('/accept-invite', perIpLimit('invite-accept', 15 * 60_000, 20), async (req: Request, res: Response) => {
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
      `SELECT id, name, username, used_at, revoked_at, expires_at FROM invites WHERE token_hash = $1 FOR UPDATE`,
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
    await client.query(
      `INSERT INTO users (username, password_hash, name, role, disabled) VALUES ($1, $2, $3, 'user', false)`,
      [row.username, passwordHash, row.name],
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
});

const resetLimit = perIpLimit('reset-password', 15 * 60_000, 20);

function resetRowGate(row: { used_at: Date | string | null; expires_at: Date | string; disabled: boolean } | undefined) {
  return decidePasswordReset({
    reset: row
      ? { usedAt: row.used_at, expiresAt: row.expires_at, userDisabled: Boolean(row.disabled) }
      : null,
  });
}

authRouter.get('/reset-password/:token', resetLimit, async (req: Request, res: Response) => {
  const tokenError = resetTokenProblem(req.params.token);
  if (tokenError) return res.status(400).json({ error: tokenError });
  try {
    const found = await pool.query(
      `SELECT r.used_at, r.expires_at, u.disabled
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
});

// One-time link. Refusals stay generic so a caller cannot tell unknown, used, expired, and disabled apart.
authRouter.post('/reset-password', resetLimit, async (req: Request, res: Response) => {
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
      `SELECT r.id, r.user_id, r.used_at, r.expires_at, u.disabled
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
      `UPDATE password_resets SET used_at = NOW() WHERE id = $1 AND used_at IS NULL RETURNING id`,
      [row.id],
    );
    if (!marked.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: RESET_LINK_ERROR });
    }
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    console.error('reset-password failed');
    return res.status(500).json({ error: 'Could not reset the password' });
  } finally {
    client.release();
  }
});

authRouter.post('/change-password', requireAuth, async (req: Request, res: Response) => {
  const pwError = passwordProblem(req.body?.password);
  if (pwError) return res.status(400).json({ error: pwError });
  const currentPassword = req.body?.currentPassword;
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
});
