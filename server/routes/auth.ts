import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db';

export const authRouter = Router();

authRouter.post('/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  (req.session as any).userId = user.id;
  (req.session as any).userName = user.name;
  return res.json({ id: user.id, name: user.name, username: user.username });
});

authRouter.post('/logout', (req: Request, res: Response) => {
  req.session.destroy(() => {});
  return res.json({ ok: true });
});

authRouter.get('/me', (req: Request, res: Response) => {
  const userId = (req.session as any)?.userId;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  return res.json({ id: user.id, name: user.name, username: user.username });
});
