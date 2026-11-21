import session from 'express-session';

/** Explicit MemoryStore so an admin disable can revoke every session for that user. */
export const sessionStore = new session.MemoryStore();

function sameUser(raw: unknown, userId: number): boolean {
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  return id === userId;
}

/** Drop every in-memory session whose userId is this account. */
export function destroySessionsForUser(userId: number): Promise<void> {
  const target = Number(userId);
  return new Promise((resolve, reject) => {
    sessionStore.all((err, sessions) => {
      if (err) return reject(err);
      const sids: string[] = [];
      if (sessions && !Array.isArray(sessions)) {
        for (const [sid, data] of Object.entries(sessions)) {
          if (sameUser((data as { userId?: unknown } | undefined)?.userId, target)) sids.push(sid);
        }
      }
      if (sids.length === 0) return resolve();
      let left = sids.length;
      for (const sid of sids) {
        sessionStore.destroy(sid, (destroyErr) => {
          if (destroyErr) return reject(destroyErr);
          left -= 1;
          if (left === 0) resolve();
        });
      }
    });
  });
}
