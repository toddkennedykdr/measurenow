import type { NextFunction, Request, Response } from 'express';

function isMalformedJson(err: unknown): boolean {
  if (!(err instanceof SyntaxError)) return false;
  const parsed = err as SyntaxError & { status?: number; type?: string };
  return parsed.status === 400 || parsed.type === 'entity.parse.failed';
}

/** JSON 400 for a body express.json() could not parse. Other errors pass through. */
export function malformedJsonHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (!isMalformedJson(err) || res.headersSent) {
    next(err);
    return;
  }
  res.status(400).json({ error: 'Invalid JSON' });
}
