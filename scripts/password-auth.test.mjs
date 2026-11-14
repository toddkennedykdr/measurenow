// Password reset, change-password, and mint-reset checks against a local database.
// Fake passwords only. Tokens and links are redacted from the output.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const { Client } = require('pg');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = 'measurenow_pwtest';
const PORT = 3188;
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = `postgresql://${process.env.USER || 'ubuntu'}@/${DB}?host=/var/run/postgresql`;
const GENERIC = 'This reset link is invalid or has expired';
const APP_BASE = `http://127.0.0.1:${PORT}`;

if (!DATABASE_URL.includes('/var/run/postgresql') || !DATABASE_URL.includes(`/${DB}?`)) {
  console.error('Refusing to run against a non-local database');
  process.exit(1);
}

let pass = 0;
let fail = 0;
const secrets = [];
function track(secret) {
  if (secret) secrets.push(String(secret));
  return secret;
}
function redact(text) {
  let out = String(text ?? '');
  for (const secret of secrets) {
    if (secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out;
}
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + redact(detail) : ''}`);
}

const PW = {
  todd: track('FakeToddPassword1'),
  ada: track('FakeAdaPassword12'),
  pat: track('FakePatPassword12'),
  reset: track('FakeResetPassword1'),
  third: track('FakeThirdPassword1'),
  adaNext: track('FakeAdaChanged123'),
  invite: track('FakeInvitePassword1'),
  wrong: track('FakeWrongPassword1'),
};

function sha(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
function newToken() {
  return track(randomBytes(32).toString('base64url'));
}
let ipN = 20;
function nextIp() {
  ipN += 1;
  return `203.0.113.${ipN}`;
}

function childEnv(extra = {}) {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'C.UTF-8',
    TMPDIR: process.env.TMPDIR || '/tmp',
    DATABASE_URL,
    PORT: String(PORT),
    NODE_ENV: 'development',
    SESSION_SECRET: 'password-test-only',
    SEED_ADMIN_PASSWORD: '',
    TZ: 'UTC',
    ...extra,
  };
}

async function jpost(pathname, body, { ip, cookie } = {}) {
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': ip || nextIp() };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + pathname, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  const setCookie = (typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [])
    .map(part => part.split(';')[0])
    .join('; ');
  return { status: res.status, data, cookie: setCookie || cookie || '' };
}
async function jget(pathname, { ip } = {}) {
  const res = await fetch(BASE + pathname, { headers: { 'x-forwarded-for': ip || nextIp() } });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function hashes(client) {
  const result = await client.query(`SELECT id, username, password_hash FROM users ORDER BY id`);
  return result.rows.map(row => ({ id: Number(row.id), username: row.username, password_hash: row.password_hash }));
}
function diffHashes(before, after, changedUsername) {
  const afterById = new Map(after.map(row => [row.id, row.password_hash]));
  let targetChanged = false;
  let othersSame = true;
  for (const row of before) {
    const next = afterById.get(row.id);
    if (next == null) return { targetChanged: false, othersSame: false };
    if (changedUsername && row.username === changedUsername) targetChanged = next !== row.password_hash;
    else if (next !== row.password_hash) othersSame = false;
  }
  return { targetChanged, othersSame };
}

function utcClock(value) {
  if (!value) return null;
  return value.toISOString().slice(0, 19).replace('T', ' ');
}
async function insertReset(client, userId, token, { expiresAt, usedAt = null }) {
  await client.query(
    `INSERT INTO password_resets (user_id, token_hash, expires_at, used_at) VALUES ($1, $2, $3::timestamp, $4::timestamp)`,
    [userId, sha(token), utcClock(expiresAt), utcClock(usedAt)],
  );
}

function runMint(args, extraEnv = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/mint-reset.ts'), ...args], {
    cwd: root,
    env: childEnv(extraEnv),
    encoding: 'utf8',
  });
}
function expiryShape(stdout) {
  const lines = (stdout || '').trim().split('\n');
  return lines.length === 2 && /^Expires at \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} ET \(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z\)$/.test(lines[1] || '');
}
function expiryUtcMs(stdout) {
  const line = (stdout || '').trim().split('\n')[1] || '';
  const match = line.match(/\((\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\)/);
  return match ? Date.parse(match[1]) : NaN;
}
function outputHides(text, hidden) {
  if (/https?:\/\//.test(text) || text.includes('/reset/')) return false;
  return hidden.every(secret => secret && !text.includes(secret));
}

async function main() {
  try {
    execFileSync('createdb', [DB], { stdio: 'ignore' });
  } catch { /* already exists */ }
  execFileSync('psql', ['-q', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-c', 'SET client_min_messages TO warning; DROP SCHEMA public CASCADE; CREATE SCHEMA public;']);

  const entry = process.env.PASSWORD_TEST_SRC === '1'
    ? ['--import', 'tsx', path.join(root, 'server/index.ts')]
    : [path.join(root, 'dist-server/index.js')];
  let log = '';
  const srv = spawn(process.execPath, entry, { cwd: root, env: childEnv() });
  srv.stdout.on('data', d => { log += d; });
  srv.stderr.on('data', d => { log += d; });

  const client = new Client({ connectionString: DATABASE_URL });
  try {
    for (let i = 0; i < 50; i++) {
      try {
        const res = await fetch(BASE + '/api/auth/me');
        if (res.status === 401 || res.status === 200) break;
      } catch { /* still booting */ }
      if (i === 49) throw new Error('server did not start');
      await new Promise(r => setTimeout(r, 200));
    }
    await client.connect();

    const todd = await client.query(
      `INSERT INTO users (username, password_hash, name, role, disabled) VALUES ($1,$2,$3,'admin',false) RETURNING id`,
      ['Todd', bcrypt.hashSync(PW.todd, 10), 'Todd Kennedy'],
    );
    const ada = await client.query(
      `INSERT INTO users (username, password_hash, name, role, disabled) VALUES ($1,$2,$3,'user',false) RETURNING id`,
      ['Ada', bcrypt.hashSync(PW.ada, 10), 'Ada Lovelace'],
    );
    const pat = await client.query(
      `INSERT INTO users (username, password_hash, name, role, disabled) VALUES ($1,$2,$3,'user',true) RETURNING id`,
      ['Pat', bcrypt.hashSync(PW.pat, 10), 'Pat Disabled'],
    );
    const toddId = Number(todd.rows[0].id);
    const adaId = Number(ada.rows[0].id);
    const patId = Number(pat.rows[0].id);

    const toddLogin = await jpost('/api/auth/login', { username: 'Todd', password: PW.todd });
    check('existing login succeeds', toddLogin.status === 200 && toddLogin.data.username === 'Todd' && toddLogin.data.role === 'admin');
    check('login shape unchanged', Object.keys(toddLogin.data).sort().join(',') === 'id,name,role,username');
    const badLogin = await jpost('/api/auth/login', { username: 'Todd', password: PW.wrong });
    check('wrong password still rejected', badLogin.status === 401 && badLogin.data.error === 'Invalid credentials');
    const missing = await jpost('/api/auth/login', { username: 'Todd' });
    check('login still requires both fields', missing.status === 400 && missing.data.error === 'Username and password required');
    const disabledLogin = await jpost('/api/auth/login', { username: 'Pat', password: PW.pat });
    check('disabled login still rejected', disabledLogin.status === 403 && disabledLogin.data.error === 'This account is disabled');

    const future = new Date(Date.now() + 60 * 60 * 1000);
    const past = new Date(Date.now() - 60 * 1000);
    const expired = newToken();
    const used = newToken();
    const unknown = newToken();
    const disabledTok = newToken();
    const good = newToken();
    await insertReset(client, toddId, expired, { expiresAt: past });
    await insertReset(client, toddId, used, { expiresAt: future, usedAt: new Date() });
    await insertReset(client, patId, disabledTok, { expiresAt: future });
    await insertReset(client, toddId, good, { expiresAt: future });

    const beforeRefusal = await hashes(client);
    const cases = [
      ['expired', expired],
      ['used', used],
      ['unknown', unknown],
      ['disabled', disabledTok],
    ];
    const messages = [];
    for (const [label, token] of cases) {
      const looked = await jget(`/api/auth/reset-password/${encodeURIComponent(token)}`);
      const posted = await jpost('/api/auth/reset-password', { token, password: PW.reset });
      const generic = status => status === 400;
      check(`GET ${label} token refused`, generic(looked.status) && looked.data.error === GENERIC && !JSON.stringify(looked.data).includes('disabled'));
      check(`POST ${label} token refused`, generic(posted.status) && posted.data.error === GENERIC);
      messages.push(looked.data.error, posted.data.error);
    }
    check('refusal message is identical', new Set(messages).size === 1 && messages[0] === GENERIC);
    const afterRefusal = await hashes(client);
    const refusalDiff = diffHashes(beforeRefusal, afterRefusal, null);
    check('refused tokens change no password hash', refusalDiff.othersSame && !refusalDiff.targetChanged);

    const preview = await jget(`/api/auth/reset-password/${encodeURIComponent(good)}`);
    check('valid token check returns ok', preview.status === 200 && JSON.stringify(preview.data) === '{"ok":true}');
    const tooShort = await jpost('/api/auth/reset-password', { token: good, password: 'short' });
    check('reset enforces the 12 character rule', tooShort.status === 400 && tooShort.data.error === 'Password must be at least 12 characters');
    const stillOpen = await client.query(`SELECT used_at FROM password_resets WHERE token_hash = $1`, [sha(good)]);
    check('rejected password does not consume the token', stillOpen.rows[0] && stillOpen.rows[0].used_at == null);

    const beforeReset = await hashes(client);
    const reset = await jpost('/api/auth/reset-password', { token: good, password: PW.reset });
    check('reset succeeds once', reset.status === 200 && JSON.stringify(reset.data) === '{"ok":true}');
    const afterReset = await hashes(client);
    const resetDiff = diffHashes(beforeReset, afterReset, 'Todd');
    check('reset changes only the target password hash', resetDiff.targetChanged && resetDiff.othersSame);
    const oldTodd = await jpost('/api/auth/login', { username: 'Todd', password: PW.todd });
    check('old password fails after reset', oldTodd.status === 401);
    const newTodd = await jpost('/api/auth/login', { username: 'Todd', password: PW.reset });
    check('new password works after reset', newTodd.status === 200 && newTodd.data.username === 'Todd');
    const adaStill = await jpost('/api/auth/login', { username: 'Ada', password: PW.ada });
    check('other account login unchanged', adaStill.status === 200 && adaStill.data.role === 'user');

    const beforeReuse = await hashes(client);
    const reuse = await jpost('/api/auth/reset-password', { token: good, password: PW.third });
    check('second use of the same token is refused', reuse.status === 400 && reuse.data.error === GENERIC);
    const afterReuse = await hashes(client);
    const reuseDiff = diffHashes(beforeReuse, afterReuse, 'Todd');
    check('second use does not change any hash', reuseDiff.othersSame && !reuseDiff.targetChanged);
    const thirdLogin = await jpost('/api/auth/login', { username: 'Todd', password: PW.third });
    check('unused second password does not log in', thirdLogin.status === 401);
    const stillNew = await jpost('/api/auth/login', { username: 'Todd', password: PW.reset });
    check('reset password still works', stillNew.status === 200);

    const anon = await jpost('/api/auth/change-password', { currentPassword: PW.ada, password: PW.adaNext });
    check('change-password requires a session', anon.status === 401 && anon.data.error === 'Not authenticated');
    const adaLogin = await jpost('/api/auth/login', { username: 'Ada', password: PW.ada });
    check('ada session for change-password', adaLogin.status === 200 && adaLogin.cookie.includes('connect.sid'));
    const beforeWrong = await hashes(client);
    const wrong = await jpost('/api/auth/change-password', {
      currentPassword: PW.wrong,
      password: PW.adaNext,
      userId: toddId,
    }, { cookie: adaLogin.cookie });
    check('wrong current password refused', wrong.status === 400 && wrong.data.error === 'Current password is incorrect');
    const afterWrong = await hashes(client);
    const wrongDiff = diffHashes(beforeWrong, afterWrong, null);
    check('wrong current password changes no hash', wrongDiff.othersSame && !wrongDiff.targetChanged);

    const beforeChange = await hashes(client);
    const changed = await jpost('/api/auth/change-password', {
      currentPassword: PW.ada,
      password: PW.adaNext,
      userId: toddId,
    }, { cookie: adaLogin.cookie });
    check('change-password succeeds', changed.status === 200 && changed.data.ok === true);
    const afterChange = await hashes(client);
    const changeDiff = diffHashes(beforeChange, afterChange, 'Ada');
    check('change-password updates only the session user', changeDiff.targetChanged && changeDiff.othersSame);
    const adaOld = await jpost('/api/auth/login', { username: 'Ada', password: PW.ada });
    check('previous password fails after change', adaOld.status === 401);
    const adaNew = await jpost('/api/auth/login', { username: 'Ada', password: PW.adaNext });
    check('changed password logs in', adaNew.status === 200);
    const toddUntouched = await jpost('/api/auth/login', { username: 'Todd', password: PW.reset });
    check('body userId cannot retarget the update', toddUntouched.status === 200);

    const beforeInvite = await hashes(client);
    const inviteToken = track(randomBytes(16).toString('hex'));
    await client.query(
      `INSERT INTO invites (name, username, token_hash, expires_at)
       VALUES ($1, $2, $3, (NOW() AT TIME ZONE 'UTC') + interval '1 hour')`,
      ['New Person', 'newperson', sha(inviteToken)],
    );
    const shortInvite = await jpost('/api/auth/accept-invite', { token: 'ab'.repeat(16), password: 'short' });
    check('invite password rule unchanged', shortInvite.status === 400 && shortInvite.data.error === 'Password must be at least 12 characters');
    const accepted = await jpost('/api/auth/accept-invite', { token: inviteToken, password: PW.invite });
    check('invite accept still creates a user', accepted.status === 200 && accepted.data.ok === true && accepted.data.username === 'newperson');
    const invited = await jpost('/api/auth/login', { username: 'newperson', password: PW.invite });
    check('accepted invite can log in', invited.status === 200 && invited.data.role === 'user');
    const afterInvite = await hashes(client);
    const inviteDiff = diffHashes(beforeInvite, afterInvite, null);
    check('invite accept does not change existing hashes', inviteDiff.othersSame && !inviteDiff.targetChanged);
    const reusedInvite = await jpost('/api/auth/accept-invite', { token: inviteToken, password: PW.invite });
    check('used invite still refused', reusedInvite.status === 410 && reusedInvite.data.error === 'This invite has already been used');

    const toddHashBefore = (await hashes(client)).find(row => row.username === 'Todd').password_hash;
    const existingInvite = track(randomBytes(16).toString('hex'));
    await client.query(
      `INSERT INTO invites (name, username, token_hash, expires_at)
       VALUES ($1, $2, $3, (NOW() AT TIME ZONE 'UTC') + interval '1 hour')`,
      ['Todd Kennedy', 'Todd', sha(existingInvite)],
    );
    const taken = await jpost('/api/auth/accept-invite', { token: existingInvite, password: PW.third });
    check('invite still cannot change an existing password', taken.status === 409 && taken.data.error === 'An account with that username already exists. This invite cannot change an existing password.');
    const toddHashAfter = (await hashes(client)).find(row => row.username === 'Todd').password_hash;
    check('existing user hash unchanged by invite', toddHashBefore === toddHashAfter);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mn-reset-'));
    const oldUnused = newToken();
    const oldUsed = newToken();
    const oldUsedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await insertReset(client, toddId, oldUnused, { expiresAt: future });
    await insertReset(client, toddId, oldUsed, { expiresAt: future, usedAt: oldUsedAt });
    const toddOut = path.join(dir, 'nested', 'todd-link.txt');
    const minted = runMint(['Todd', '--expires-hours', '24', '--out', toddOut, '--base-url', APP_BASE]);
    const stdout = minted.stdout || '';
    const stderr = minted.stderr || '';
    check('mint exits 0 for Todd', minted.status === 0, `status=${minted.status}`);
    const link = fs.existsSync(toddOut) ? fs.readFileSync(toddOut, 'utf8').trim() : '';
    const mintedToken = link.includes('/') ? link.slice(link.lastIndexOf('/') + 1) : '';
    track(link);
    track(mintedToken);
    const hidden = [mintedToken, link, oldUnused, oldUsed];
    check('mint stdout and stderr contain no token and no link', minted.status === 0 && outputHides(stdout + stderr, hidden));
    check('mint stdout is only the path and expiry', stdout.trim().split('\n')[0] === path.resolve(toddOut) && expiryShape(stdout));
    check('mint stderr is empty', stderr === '');
    const mode = fs.existsSync(toddOut) ? fs.statSync(toddOut).mode & 0o777 : 0;
    check('mint file mode is 0600', mode === 0o600, `mode=${mode.toString(8)}`);
    check('mint file contains the link', link === `${APP_BASE}/reset/${mintedToken}` && mintedToken.length === 43);
    const exp = expiryUtcMs(stdout) - Date.now();
    check('mint default expiry is 24h', exp > 23.5 * 60 * 60 * 1000 && exp < 24.05 * 60 * 60 * 1000);
    const ages = await client.query(
      `SELECT token_hash,
              EXTRACT(EPOCH FROM ((NOW() AT TIME ZONE 'UTC') - used_at)) AS age
       FROM password_resets WHERE user_id = $1`,
      [toddId],
    );
    const ageByHash = new Map(ages.rows.map(row => [row.token_hash, row.age == null ? null : Number(row.age)]));
    const unusedAge = ageByHash.get(sha(oldUnused));
    const usedAge = ageByHash.get(sha(oldUsed));
    check('older unused token is revoked', unusedAge != null && unusedAge >= 0 && unusedAge < 5 * 60);
    check('already used token was not rewritten', usedAge != null && usedAge > 60 * 60);
    check('mint stores only the new hash', ageByHash.has(sha(mintedToken)) && ageByHash.get(sha(mintedToken)) == null);

    const adaBefore = await client.query(`SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1`, [adaId]);
    const refused = runMint(['Ada', '--expires-hours', '1', '--out', path.join(dir, 'ada-forbidden.txt'), '--base-url', APP_BASE]);
    check('non-Todd user refused without flag', refused.status === 1 && (refused.stderr || '').includes('--allow-other-user'));
    check('non-Todd refusal has no link', outputHides(`${refused.stdout || ''}\n${refused.stderr || ''}`, []));
    const adaAfter = await client.query(`SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id = $1`, [adaId]);
    check('refused user got no token', adaBefore.rows[0].n === adaAfter.rows[0].n && !fs.existsSync(path.join(dir, 'ada-forbidden.txt')));

    const beforeLong = Number((await client.query(`SELECT COUNT(*)::int AS n FROM password_resets`)).rows[0].n);
    const tooLong = runMint(['--expires-hours', '25', '--out', path.join(dir, 'too-long.txt'), '--base-url', APP_BASE]);
    const afterLong = Number((await client.query(`SELECT COUNT(*)::int AS n FROM password_resets`)).rows[0].n);
    check('expiry over 24h refused', tooLong.status === 1 && /24/.test(tooLong.stderr || ''));
    check('over-24h refusal has no link', outputHides(`${tooLong.stdout || ''}\n${tooLong.stderr || ''}`, []) && afterLong === beforeLong && !fs.existsSync(path.join(dir, 'too-long.txt')));

    const adaOut = path.join(dir, 'ada-link.txt');
    const adaMint = runMint(['Ada', '--allow-other-user', '--expires-hours', '1', '--out', adaOut, '--base-url', APP_BASE]);
    const adaLink = fs.existsSync(adaOut) ? fs.readFileSync(adaOut, 'utf8').trim() : '';
    const adaToken = adaLink.includes('/') ? adaLink.slice(adaLink.lastIndexOf('/') + 1) : '';
    track(adaLink);
    track(adaToken);
    check('flag allows another user', adaMint.status === 0 && outputHides(`${adaMint.stdout || ''}${adaMint.stderr || ''}`, [adaLink, adaToken]));
    const adaExp = expiryUtcMs(adaMint.stdout || '') - Date.now();
    check('expiry flag of 1h is honored', adaExp > 0.9 * 60 * 60 * 1000 && adaExp < 1.05 * 60 * 60 * 1000);
    const adaMode = fs.existsSync(adaOut) ? fs.statSync(adaOut).mode & 0o777 : 0;
    check('other user file is also 0600', adaMode === 0o600);
    const adaRow = await client.query(`SELECT used_at FROM password_resets WHERE token_hash = $1`, [sha(adaToken)]);
    check('other user hash stored unused', adaRow.rows[0] && adaRow.rows[0].used_at == null);

    const zoneOut = path.join(dir, 'zone', 'nested', 'link.txt');
    const zoneMint = runMint(
      ['Todd', '--expires-hours', '24', '--out', zoneOut, '--base-url', APP_BASE],
      { TZ: 'America/New_York' },
    );
    const zoneStdout = zoneMint.stdout || '';
    const zoneStderr = zoneMint.stderr || '';
    const zoneLink = fs.existsSync(zoneOut) ? fs.readFileSync(zoneOut, 'utf8').trim() : '';
    const zoneToken = zoneLink.includes('/') ? zoneLink.slice(zoneLink.lastIndexOf('/') + 1) : '';
    track(zoneLink);
    track(zoneToken);
    check('mint in Eastern time exits 0', zoneMint.status === 0 && expiryShape(zoneStdout));
    check('Eastern mint hides the token and link', outputHides(zoneStdout + zoneStderr, [zoneToken, zoneLink]) && zoneStderr === '');
    const zoneMode = fs.existsSync(path.join(dir, 'zone')) ? fs.statSync(path.join(dir, 'zone')).mode & 0o777 : 0;
    const nestedMode = fs.existsSync(path.join(dir, 'zone', 'nested')) ? fs.statSync(path.join(dir, 'zone', 'nested')).mode & 0o777 : 0;
    check('new output folders are mode 0700', zoneMode === 0o700 && nestedMode === 0o700, `zone=${zoneMode.toString(8)} nested=${nestedMode.toString(8)}`);
    const span = await client.query(
      `SELECT EXTRACT(EPOCH FROM (expires_at - (NOW() AT TIME ZONE 'UTC'))) AS seconds,
              to_char(expires_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_utc
       FROM password_resets WHERE token_hash = $1`,
      [sha(zoneToken)],
    );
    const seconds = Number(span.rows[0]?.seconds);
    check('expiry lasts 24h plus or minus 1 minute from DB now', Number.isFinite(seconds) && Math.abs(seconds - 24 * 60 * 60) <= 60, `seconds=${seconds}`);
    const printedUtc = (zoneStdout.trim().split('\n')[1] || '').match(/\(([^)]+)\)$/);
    check('printed expiry is the database value in ET and UTC', typeof span.rows[0]?.expires_utc === 'string' && printedUtc?.[1] === span.rows[0].expires_utc);
    const zoneCheck = await jget(`/api/auth/reset-password/${encodeURIComponent(zoneToken)}`);
    check('token is accepted before expiry', zoneCheck.status === 200 && zoneCheck.data.ok === true);
    await client.query(
      `UPDATE password_resets SET expires_at = (NOW() AT TIME ZONE 'UTC') - interval '1 minute' WHERE token_hash = $1`,
      [sha(zoneToken)],
    );
    const zoneLate = await jpost('/api/auth/reset-password', { token: zoneToken, password: PW.reset });
    check('token is refused once past expiry', zoneLate.status === 400 && zoneLate.data.error === GENERIC);

    const keeper = newToken();
    await insertReset(client, toddId, keeper, { expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) });
    const beforeBlocked = Number((await client.query(`SELECT COUNT(*)::int AS n FROM password_resets`)).rows[0].n);
    const keeperOk = await jget(`/api/auth/reset-password/${encodeURIComponent(keeper)}`);
    check('keeper token works before blocked mint', keeperOk.status === 200 && keeperOk.data.ok === true);

    const existingFile = path.join(dir, 'already-there.txt');
    fs.writeFileSync(existingFile, 'leave-this-file\n', { mode: 0o600 });
    const existsRun = runMint(['Todd', '--expires-hours', '1', '--out', existingFile, '--base-url', APP_BASE]);
    const afterExists = Number((await client.query(`SELECT COUNT(*)::int AS n FROM password_resets`)).rows[0].n);
    const keeperAfterExists = await jget(`/api/auth/reset-password/${encodeURIComponent(keeper)}`);
    check('existing output file is refused', existsRun.status === 1 && (existsRun.stderr || '').includes('Output file already exists; choose another path or remove it first'));
    check('existing file refusal leaves the database unchanged', outputHides(`${existsRun.stdout || ''}\n${existsRun.stderr || ''}`, [keeper]) && afterExists === beforeBlocked && keeperAfterExists.status === 200 && fs.readFileSync(existingFile, 'utf8') === 'leave-this-file\n');

    const sentinel = path.join(dir, 'sentinel.txt');
    const symlink = path.join(dir, 'out-symlink');
    fs.writeFileSync(sentinel, 'sentinel-keep\n', { mode: 0o600 });
    fs.symlinkSync(sentinel, symlink);
    const sym = runMint(['Todd', '--expires-hours', '1', '--out', symlink, '--base-url', APP_BASE]);
    const afterSym = Number((await client.query(`SELECT COUNT(*)::int AS n FROM password_resets`)).rows[0].n);
    const keeperAfterSym = await jget(`/api/auth/reset-password/${encodeURIComponent(keeper)}`);
    check('symlink output is refused', sym.status === 1 && (sym.stderr || '').includes('Could not write the reset link file.'));
    check('symlink refusal leaves the database unchanged', outputHides(`${sym.stdout || ''}\n${sym.stderr || ''}`, [keeper]) && afterSym === beforeBlocked && keeperAfterSym.status === 200 && fs.lstatSync(symlink).isSymbolicLink() && fs.readFileSync(sentinel, 'utf8') === 'sentinel-keep\n');
  } catch (err) {
    fail++;
    console.error('ERROR', redact(err && err.stack ? err.stack : err));
  } finally {
    try { await client.end(); } catch { /* not connected */ }
    if (srv && srv.pid) srv.kill();
    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail && log) console.log('--- server log ---\n' + redact(log));
    process.exit(fail ? 1 : 0);
  }
}

main();
