// Policy checks for the admin area. Imports the compiled authz module (no database).
// Also scans the seed source so plaintext passwords cannot sneak back in.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const authz = require(path.join(root, 'dist-server/authz.js'));

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const {
  accessDecision, shouldSeedAdmin, newInviteToken, hashInviteToken, inviteTokenProblem,
  tokenMatches, passwordProblem, INVITE_TTL_MS, decideInviteAccept, usernameProblem,
  emailProblem, nameProblem, publicUser, summarizeOrder,
} = authz;

check('logged out is 401', accessDecision(null, true) === 401);
check('disabled is 401 even for admin', accessDecision({ role: 'admin', disabled: true }, true) === 401);
check('user on admin route is 403', accessDecision({ role: 'user', disabled: false }, true) === 403);
check('admin on admin route is 200', accessDecision({ role: 'admin', disabled: false }, true) === 200);
check('user on normal route is 200', accessDecision({ role: 'user', disabled: false }, false) === 200);

check('seed skips a populated table', shouldSeedAdmin(2, 'long-enough-password') === 'skip-not-empty');
check('seed skips a missing password', shouldSeedAdmin(0, undefined) === 'skip-no-password');
check('seed skips a short password', shouldSeedAdmin(0, 'short') === 'skip-short-password');
check('seed runs only for an empty table and a long password', shouldSeedAdmin(0, 'twelve-chars!') === 'seed');

const token = newInviteToken();
check('invite token is 128-bit hex', /^[a-f0-9]{32}$/.test(token));
const hash = hashInviteToken(token);
check('stored form is a sha256 hex digest', /^[a-f0-9]{64}$/.test(hash) && hash !== token);
check('token match is exact', tokenMatches(hash, token) && !tokenMatches(hash, token.replace(/.$/, '0')));
check('malformed token rejected before a lookup', inviteTokenProblem('nope') === 'Invite link is invalid' && inviteTokenProblem(token) === null);
check('password under 12 rejected', passwordProblem('short') != null && passwordProblem('long-enough-pw') === null);
check('invite lives 7 days', INVITE_TTL_MS === 7 * 24 * 60 * 60 * 1000);

const future = new Date(Date.now() + 60_000);
const past = new Date(Date.now() - 60_000);
const open = { usedAt: null, revokedAt: null, expiresAt: future };
check('fresh invite accepted', decideInviteAccept({ invite: open, usernameTaken: false }) === 'ok');
check('missing invite invalid', decideInviteAccept({ invite: null, usernameTaken: false }) === 'invalid');
check('used invite refused', decideInviteAccept({ invite: { ...open, usedAt: new Date() }, usernameTaken: false }) === 'used');
check('revoked invite refused', decideInviteAccept({ invite: { ...open, revokedAt: new Date() }, usernameTaken: false }) === 'revoked');
check('expired invite refused', decideInviteAccept({ invite: { ...open, expiresAt: past }, usernameTaken: false }) === 'expired');
check('taken username refused', decideInviteAccept({ invite: open, usernameTaken: true }) === 'username-taken');

check('username rules', usernameProblem('Todd') === null && usernameProblem('a') != null && usernameProblem('has space') != null);
check('email optional', emailProblem('') === null && emailProblem('not-an-email') != null && emailProblem('a@b.co') === null);
check('name required', nameProblem('  ') != null && nameProblem('Ada') === null);

const pub = publicUser({
  id: 1, name: 'Todd Kennedy', username: 'Todd', role: 'admin',
  createdAt: new Date('2026-01-02T00:00:00Z'), lastLoginAt: null, disabled: false,
  passwordHash: 'should-not-leak', password_hash: 'also-not',
});
check('public user drops password hashes', !('passwordHash' in pub) && !('password_hash' in pub) && !JSON.stringify(pub).includes('should-not-leak'));
check('public user keeps role and login', pub.role === 'admin' && pub.lastLoginAt === null && pub.disabled === false);
check('unknown role becomes user', publicUser({ id: 2, name: 'A', username: 'a', role: 'owner', createdAt: '2026-01-01' }).role === 'user');

const order = summarizeOrder({
  id: 9, userId: 2, userName: 'Isaac', username: 'Isaac', address: '1 Main St',
  createdAt: new Date('2026-03-01T15:00:00Z'),
  roofData: { totalAreaSqFt: 2450 },
  quote: { lowEstimate: 8000, highEstimate: 12000 },
  analysis: { overallCondition: { rating: 'fair' }, photos: ['secret'] },
});
check('order summary uses area, squares, and rating', order.areaSqFt === 2450 && order.squares === 24.5 && order.status === 'fair' && order.quoteLow === 8000);
check('order summary drops raw analysis', !('analysis' in order) && !JSON.stringify(order).includes('secret'));
const measured = summarizeOrder({
  id: 1, userId: 1, userName: 'T', username: 'T', address: 'x', createdAt: '2026-01-01',
  roofData: {}, quote: { roofSquares: 18 }, analysis: null,
});
check('measured when there is no analysis', measured.status === 'measured' && measured.squares === 18 && measured.areaSqFt === null);

const seedSrc = fs.readFileSync(path.join(root, 'server/db/index.ts'), 'utf8');
check('seed reads the password from the environment', seedSrc.includes('SEED_ADMIN_PASSWORD') && seedSrc.includes('shouldSeedAdmin'));
check('seed source has no password literal', !/password\s*:\s*['"]/.test(seedSrc));
check('migration does not rewrite password hashes', !/SET\s+password_hash/i.test(seedSrc) && /SET role = 'admin'/.test(seedSrc));
check('seed only inserts when the table is empty', seedSrc.includes("skip-not-empty") || seedSrc.includes('shouldSeedAdmin'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
