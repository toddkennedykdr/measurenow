import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { Pool } from 'pg';
import {
  hashResetToken,
  mintResetUserAllowed,
  newResetToken,
  parseResetHours,
  RESET_DEFAULT_HOURS,
} from '../server/authz';

const DEFAULT_OUT = '/workspace/private/mn-reset-link.txt';
// Same public origin already used by the app. Do not add a deployment env var.
const DEFAULT_BASE_URL = 'https://measurenow-production.up.railway.app';

type OkArgs = {
  ok: true;
  username: string;
  hours: number;
  outPath: string;
  baseUrl: string;
};
type Args = OkArgs | { ok: false; message: string };

function normalizeBaseUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const suffix = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${suffix}`;
}

function parseArgs(argv: string[]): Args {
  let username: string | undefined;
  let allowOther = false;
  let hours = RESET_DEFAULT_HOURS;
  let outPath = DEFAULT_OUT;
  let baseUrl = DEFAULT_BASE_URL;

  const take = (i: number): string | null => {
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) return null;
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-other-user') {
      allowOther = true;
      continue;
    }
    if (arg === '--expires-hours' || arg === '--expiry') {
      const value = take(i);
      if (value == null) return { ok: false, message: 'Expiry must be a positive number of hours up to 24.' };
      i += 1;
      const parsed = parseResetHours(value);
      if (parsed == null) return { ok: false, message: 'Expiry must be a positive number of hours up to 24.' };
      hours = parsed;
      continue;
    }
    if (arg.startsWith('--expires-hours=')) {
      const parsed = parseResetHours(arg.slice('--expires-hours='.length));
      if (parsed == null) return { ok: false, message: 'Expiry must be a positive number of hours up to 24.' };
      hours = parsed;
      continue;
    }
    if (arg === '--out') {
      const value = take(i);
      if (value == null) return { ok: false, message: 'A file path is required with --out.' };
      i += 1;
      outPath = value;
      continue;
    }
    if (arg.startsWith('--out=')) {
      const value = arg.slice('--out='.length);
      if (!value) return { ok: false, message: 'A file path is required with --out.' };
      outPath = value;
      continue;
    }
    if (arg === '--base-url') {
      const value = take(i);
      if (value == null) return { ok: false, message: 'Base URL must be an http(s) address.' };
      i += 1;
      const normalized = normalizeBaseUrl(value);
      if (!normalized) return { ok: false, message: 'Base URL must be an http(s) address.' };
      baseUrl = normalized;
      continue;
    }
    if (arg.startsWith('--base-url=')) {
      const normalized = normalizeBaseUrl(arg.slice('--base-url='.length));
      if (!normalized) return { ok: false, message: 'Base URL must be an http(s) address.' };
      baseUrl = normalized;
      continue;
    }
    if (arg.startsWith('--')) return { ok: false, message: 'Unknown argument.' };
    if (username !== undefined) return { ok: false, message: 'Unexpected extra argument.' };
    username = arg;
  }

  if (!outPath || /[\r\n\0]/.test(outPath)) return { ok: false, message: 'File path is not valid.' };
  if (!username) username = 'Todd';
  if (!mintResetUserAllowed(username, allowOther)) {
    return { ok: false, message: `Refusing to mint a reset link for ${username} without --allow-other-user.` };
  }
  return { ok: true, username, hours, outPath, baseUrl };
}

function ensurePrivateDir(dir: string) {
  const absolute = path.resolve(dir);
  if (absolute === path.parse(absolute).root) return;
  try {
    fs.lstatSync(absolute);
    return;
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  ensurePrivateDir(path.dirname(absolute));
  fs.mkdirSync(absolute, { mode: 0o700 });
  fs.chmodSync(absolute, 0o700);
}

const EXISTS_MESSAGE = 'Output file already exists; choose another path or remove it first';
const WRITE_MESSAGE = 'Could not write the reset link file.';

function prepareOutput(outPath: string): { ok: true; fd: number; resolved: string } | { ok: false; message: string } {
  const resolved = path.resolve(outPath);
  let existing: fs.Stats | null = null;
  try {
    existing = fs.lstatSync(resolved);
  } catch (err: any) {
    if (err?.code !== 'ENOENT') return { ok: false, message: WRITE_MESSAGE };
  }
  if (existing?.isSymbolicLink()) return { ok: false, message: WRITE_MESSAGE };
  if (existing?.isFile()) return { ok: false, message: EXISTS_MESSAGE };
  if (existing) return { ok: false, message: WRITE_MESSAGE };
  try {
    ensurePrivateDir(path.dirname(resolved));
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW;
    const fd = fs.openSync(resolved, flags, 0o600);
    return { ok: true, fd, resolved };
  } catch (err: any) {
    if (err?.code === 'EEXIST') {
      try {
        if (fs.lstatSync(resolved).isSymbolicLink()) return { ok: false, message: WRITE_MESSAGE };
        if (fs.lstatSync(resolved).isFile()) return { ok: false, message: EXISTS_MESSAGE };
      } catch { /* fall through */ }
    }
    return { ok: false, message: WRITE_MESSAGE };
  }
}

async function createReset(pool: Pool, args: OkArgs): Promise<{ ok: true; outPath: string; expiresEt: string; expiresUtc: string } | { ok: false; message: string }> {
  const prepared = prepareOutput(args.outPath);
  if (!prepared.ok) return prepared;

  const client = await pool.connect();
  let committed = false;
  let fd = prepared.fd;
  try {
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT id, disabled FROM users WHERE username = $1`,
      [args.username],
    );
    const user = found.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'No account found for that username.' };
    }
    if (user.disabled) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'That account is disabled.' };
    }
    await client.query(
      `UPDATE password_resets SET used_at = (NOW() AT TIME ZONE 'UTC') WHERE user_id = $1 AND used_at IS NULL`,
      [user.id],
    );
    const token = newResetToken();
    const inserted = await client.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, (NOW() AT TIME ZONE 'UTC') + make_interval(hours => trunc($3::numeric)::int, secs => (($3::numeric - trunc($3::numeric)) * 3600)::double precision))
       RETURNING
         to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_utc,
         to_char((expires_at AT TIME ZONE 'UTC') AT TIME ZONE 'America/New_York', 'YYYY-MM-DD HH24:MI:SS') AS expires_et`,
      [user.id, hashResetToken(token), args.hours],
    );
    const expiresUtc = inserted.rows[0]?.expires_utc;
    const expiresEt = inserted.rows[0]?.expires_et;
    if (typeof expiresUtc !== 'string' || typeof expiresEt !== 'string') {
      await client.query('ROLLBACK');
      return { ok: false, message: 'Could not create the reset link.' };
    }
    const link = `${args.baseUrl}/reset/${token}`;
    fs.writeFileSync(fd, `${link}\n`);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = -1;
    fs.chmodSync(prepared.resolved, 0o600);
    await client.query('COMMIT');
    committed = true;
    return { ok: true, outPath: prepared.resolved, expiresEt, expiresUtc };
  } catch {
    try { await client.query('ROLLBACK'); } catch { /* already closed */ }
    return { ok: false, message: 'Could not create the reset link.' };
  } finally {
    if (fd >= 0) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
    if (!committed) {
      try {
        if (!fs.lstatSync(prepared.resolved).isSymbolicLink()) fs.unlinkSync(prepared.resolved);
      } catch { /* file was never created */ }
    }
    client.release();
  }
}

function finish(code: number) {
  const flushed = (stream: NodeJS.WriteStream) => new Promise<void>(resolve => {
    if (!stream.writable) return resolve();
    stream.write('', () => resolve());
  });
  Promise.all([flushed(process.stdout), flushed(process.stderr)]).then(() => {
    process.exit(code);
  });
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.message);
    finish(1);
    return;
  }
  dotenv.config();
  const { pool, initDb } = await import('../server/db');
  let code = 0;
  try {
    await initDb();
    const result = await createReset(pool, parsed);
    if (!result.ok) {
      console.error(result.message);
      code = 1;
    } else {
      console.log(result.outPath);
      console.log(`Expires at ${result.expiresEt} ET (${result.expiresUtc})`);
    }
  } catch {
    console.error('Could not create the reset link.');
    code = 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
  finish(code);
}

main();
