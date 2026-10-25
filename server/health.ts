import type { Express, Request, Response } from 'express';

/**
 * Public git sha env vars only. Values that are not a 7 to 40 character
 * hex sha are ignored so a misplaced value is never echoed.
 */
export const COMMIT_ENV_NAMES = [
  'RAILWAY_GIT_COMMIT_SHA',
  'GITHUB_SHA',
  'SOURCE_VERSION',
  'VERCEL_GIT_COMMIT_SHA',
] as const;

const SHA_RE = /^[0-9a-f]{7,40}$/;

export type HealthBody = {
  ok: boolean;
  commit: string;
  database: 'up' | 'down';
};

export function commitIdFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  for (const name of COMMIT_ENV_NAMES) {
    const raw = env[name];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (SHA_RE.test(trimmed)) return trimmed;
  }
  return 'unknown';
}

export async function buildHealthBody(
  ping: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ status: number; body: HealthBody }> {
  let up = false;
  try {
    up = (await ping()) === true;
  } catch {
    up = false;
  }
  const body: HealthBody = {
    ok: up,
    commit: commitIdFromEnv(env),
    database: up ? 'up' : 'down',
  };
  return { status: up ? 200 : 503, body };
}

/** Login is not required. Caller should mount this before the shared /api limiter. */
export function registerHealthRoute(
  app: Express,
  ping: () => Promise<boolean>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  app.get('/api/health', async (_req: Request, res: Response) => {
    const { status, body } = await buildHealthBody(ping, env);
    res.set('Cache-Control', 'no-store');
    res.status(status).json(body);
  });
}
