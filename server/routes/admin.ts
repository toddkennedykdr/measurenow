import { Router, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, pool, schema } from '../db';
import { adminRateLimit, requireAdmin, SessionUser } from '../middleware/security';
import {
  INVITE_TTL_MS,
  emailProblem,
  hashInviteToken,
  nameProblem,
  newInviteToken,
  publicUser,
  summarizeOrder,
  usernameProblem,
} from '../authz';

export const adminRouter = Router();

adminRouter.use(adminRateLimit);
adminRouter.use(requireAdmin);

function current(req: Request): SessionUser {
  return (req as any).currentUser as SessionUser;
}

adminRouter.get('/users', async (_req: Request, res: Response) => {
  const rows = await db.select({
    id: schema.users.id,
    name: schema.users.name,
    username: schema.users.username,
    role: schema.users.role,
    createdAt: schema.users.createdAt,
    lastLoginAt: schema.users.lastLoginAt,
    disabled: schema.users.disabled,
  }).from(schema.users).orderBy(schema.users.name);
  return res.json({ users: rows.map(publicUser) });
});

adminRouter.patch('/users/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).json({ error: 'User not found' });
  if (typeof req.body?.disabled !== 'boolean') return res.status(400).json({ error: 'disabled must be true or false' });
  const disabled = req.body.disabled as boolean;
  const me = current(req);
  if (disabled && id === me.id) return res.status(400).json({ error: 'You cannot disable your own account' });

  const rows = await db.select({
    id: schema.users.id,
    name: schema.users.name,
    username: schema.users.username,
    role: schema.users.role,
    createdAt: schema.users.createdAt,
    lastLoginAt: schema.users.lastLoginAt,
    disabled: schema.users.disabled,
  }).from(schema.users).where(eq(schema.users.id, id)).limit(1);
  const target = rows[0];
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (disabled && target.role === 'admin') {
    const others = await pool.query(
      `SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND disabled = false AND id <> $1`,
      [id],
    );
    if ((others.rows[0]?.n ?? 0) < 1) return res.status(400).json({ error: 'Cannot disable the last admin' });
  }

  await db.update(schema.users).set({ disabled }).where(eq(schema.users.id, id));
  return res.json({ user: publicUser({ ...target, disabled }) });
});

adminRouter.get('/invites', async (_req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT id, name, username, email, created_at, expires_at
     FROM invites
     WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC`,
  );
  return res.json({
    invites: result.rows.map(r => ({
      id: r.id,
      name: r.name,
      username: r.username,
      email: r.email,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
    })),
  });
});

adminRouter.post('/invites', async (req: Request, res: Response) => {
  const nameErr = nameProblem(req.body?.name);
  if (nameErr) return res.status(400).json({ error: nameErr });
  const userErr = usernameProblem(req.body?.username);
  if (userErr) return res.status(400).json({ error: userErr });
  const emailErr = emailProblem(req.body?.email);
  if (emailErr) return res.status(400).json({ error: emailErr });

  const name = String(req.body.name).trim();
  const username = String(req.body.username).trim();
  const email = req.body?.email ? String(req.body.email).trim() : null;

  const existing = await pool.query(`SELECT id FROM users WHERE lower(username) = lower($1) LIMIT 1`, [username]);
  if (existing.rows[0]) {
    return res.status(409).json({ error: 'That username already has an account. Invites cannot reset a password.' });
  }
  const pending = await pool.query(
    `SELECT id FROM invites
     WHERE lower(username) = lower($1) AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
     LIMIT 1`,
    [username],
  );
  if (pending.rows[0]) return res.status(409).json({ error: 'A pending invite already exists for that username' });

  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const inserted = await db.insert(schema.invites).values({
    name,
    username,
    email,
    tokenHash: hashInviteToken(token),
    createdBy: current(req).id,
    expiresAt,
  }).returning({ id: schema.invites.id });

  const inviteUrl = `${req.protocol}://${req.get('host')}/invite/${token}`;
  return res.json({
    invite: { id: inserted[0].id, name, username, email, expiresAt: expiresAt.toISOString() },
    inviteUrl,
  });
});

adminRouter.post('/invites/:id/revoke', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(404).json({ error: 'Invite not found' });
  const result = await pool.query(
    `UPDATE invites SET revoked_at = NOW()
     WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL
     RETURNING id`,
    [id],
  );
  if (!result.rows[0]) {
    const exists = await pool.query(`SELECT used_at FROM invites WHERE id = $1`, [id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'Invite not found' });
    if (exists.rows[0].used_at) return res.status(409).json({ error: 'This invite was already used' });
    return res.status(409).json({ error: 'This invite is already revoked' });
  }
  return res.json({ ok: true });
});

adminRouter.get('/orders', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const userIdRaw = typeof req.query.userId === 'string' ? req.query.userId : '';
  let userId: number | null = null;
  if (userIdRaw) {
    userId = parseInt(userIdRaw, 10);
    if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user' });
  }
  const from = typeof req.query.from === 'string' ? req.query.from : '';
  const to = typeof req.query.to === 'string' ? req.query.to : '';
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return res.status(400).json({ error: 'Invalid from date' });
  if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) return res.status(400).json({ error: 'Invalid to date' });

  const like = q ? `%${q.replace(/[\\%_]/g, ch => '\\' + ch)}%` : null;
  const result = await pool.query(
    `SELECT r.id, r.user_id, r.address, r.created_at, r.roof_data, r.quote, r.analysis,
            u.name AS user_name, u.username
     FROM reports r
     JOIN users u ON u.id = r.user_id
     WHERE ($1::int IS NULL OR r.user_id = $1)
       AND ($2::date IS NULL OR (r.created_at AT TIME ZONE 'America/New_York')::date >= $2::date)
       AND ($3::date IS NULL OR (r.created_at AT TIME ZONE 'America/New_York')::date <= $3::date)
       AND (
         $4::text IS NULL
         OR r.address ILIKE $4 ESCAPE '\\'
         OR u.name ILIKE $4 ESCAPE '\\'
         OR u.username ILIKE $4 ESCAPE '\\'
       )
     ORDER BY r.created_at DESC
     LIMIT 500`,
    [userId, from || null, to || null, like],
  );

  return res.json({
    orders: result.rows.map(r => summarizeOrder({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      username: r.username,
      address: r.address,
      createdAt: r.created_at,
      roofData: r.roof_data,
      quote: r.quote,
      analysis: r.analysis,
    })),
  });
});
