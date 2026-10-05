// Smoke test for the lockdown patch. Boots the BUILT server (dist-server) locally with
// SKIP_DB_INIT=1 and a fetch stub (no real Google/Claude/Resend/JobNimbus calls).
// Usage: npm run build && node scripts/smoke-lockdown.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3999;
const BASE = `http://127.0.0.1:${PORT}`;
const PROD = 'https://measurenow-production.up.railway.app';
const env = {
  ...process.env,
  NODE_ENV: 'production', PORT: String(PORT), SKIP_DB_INIT: '1',
  GOOGLE_SOLAR_API_KEY: 'test-not-a-key', ANTHROPIC_API_KEY: '', RESEND_API_KEY: '', JN_API_KEY: '',
  SESSION_SECRET: 'smoke-test-only', CAP_GEOCODE_PUBLIC: '3', CAP_QUOTE_PUBLIC: '1000',
};
const srv = spawn(process.execPath, ['-r', path.join(root, 'scripts/fetch-stub.cjs'), path.join(root, 'dist-server/index.js')], { env, cwd: root });
let log = '';
srv.stdout.on('data', d => { log += d; });
srv.stderr.on('data', d => { log += d; });

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
const req = (p, o = {}) => fetch(BASE + p, o);
const jpost = (p, body, headers = {}) => req(p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

try {
  for (let i = 0; i < 50; i++) { try { await req('/api/auth/me'); break; } catch { await new Promise(r => setTimeout(r, 200)); } }

  // 1. Gated routes -> 401 when anonymous
  for (const [m, p] of [['GET', '/api/lead/list'], ['POST', '/api/roof/analyze-photos'], ['POST', '/api/roof/send-report'], ['GET', '/api/reports'], ['GET', '/api/reports/1'], ['GET', '/api/jn/jobs']]) {
    const r = m === 'GET' ? await req(p) : await jpost(p, { address: '1 Test St', repEmail: 'x@evil.example' });
    check(`${m} ${p} anonymous -> 401`, r.status === 401, `got ${r.status}`);
  }

  // 2. Unknown /api -> JSON 404; non-API path -> SPA 200
  let r = await req('/api/reports/admin/all/x'); // nonexistent
  check('GET /api/does-not-exist -> JSON 404', r.status === 404 && (r.headers.get('content-type') || '').includes('json'), `got ${r.status} ${r.headers.get('content-type')}`);
  r = await req('/api/nope'); check('GET /api/nope -> 404', r.status === 404, `got ${r.status}`);
  r = await req('/some/client/route'); check('GET /some/client/route -> SPA 200 html', r.status === 200 && (r.headers.get('content-type') || '').includes('html'), `got ${r.status}`);
  r = await req('/.env'); const t = await r.text(); check('GET /.env -> SPA shell, not a file', t.startsWith('<!DOCTYPE html>'), `got ${r.status}`);

  // 3. CORS
  r = await req('/api/roof/quote', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  check('preflight from foreign origin: no ACAO header', !r.headers.get('access-control-allow-origin'), `ACAO=${r.headers.get('access-control-allow-origin')}`);
  r = await jpost('/api/roof/geocode', { address: '1 Test St Raleigh' }, { Origin: 'https://evil.example' });
  check('POST from foreign origin -> 403', r.status === 403, `got ${r.status}`);
  r = await req('/api/roof/maps-key', { headers: { Origin: PROD } });
  check('prod origin allowed (ACAO echoed + credentials)', r.headers.get('access-control-allow-origin') === PROD && r.headers.get('access-control-allow-credentials') === 'true', `ACAO=${r.headers.get('access-control-allow-origin')}`);

  // 4. Public quote path still works (stubbed upstream), non-401
  r = await jpost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, { Origin: PROD, 'X-Forwarded-For': '203.0.113.50' });
  const q = await r.json().catch(() => ({}));
  check('POST /api/roof/quote public -> 200', r.status === 200 && q?.quote?.roofSquares > 0, `got ${r.status} squares=${q?.quote?.roofSquares}`);
  r = await req('/api/roof/maps-key'); check('GET /api/roof/maps-key stays public -> 200', r.status === 200, `got ${r.status}`);

  // 5. Daily cap (CAP_GEOCODE_PUBLIC=3): 4th call from different IPs -> 429
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await jpost('/api/roof/geocode', { address: '1 Test St Raleigh' }, { 'X-Forwarded-For': `198.51.100.${i + 1}` })).status);
  check('geocode daily cap: 3 x 200 then 429', codes.join(',') === '200,200,200,429', codes.join(','));

  // 6. Per-IP limit on quote (20/h), keyed on real client IP via trust proxy 1
  const ipCodes = [];
  for (let i = 0; i < 21; i++) ipCodes.push((await jpost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, { 'X-Forwarded-For': '192.0.2.7' })).status);
  const other = (await jpost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, { 'X-Forwarded-For': '192.0.2.8' })).status;
  check('quote per-IP limit: 21st from same IP -> 429', ipCodes[19] === 200 && ipCodes[20] === 429, `20th=${ipCodes[19]} 21st=${ipCodes[20]}`);
  check('quote per-IP limit: other IP unaffected -> 200', other === 200, `got ${other}`);
  check('spoofed extra XFF hop ignored (trust proxy=1 uses last hop)', (await jpost('/api/roof/quote', { lat: 1, lng: 1 }, { 'X-Forwarded-For': '10.9.9.9, 192.0.2.7' })).status === 429);

  // 7. No real outbound calls
  check('no non-stubbed outbound calls', !/ECONNREFUSED|ENOTFOUND/.test(log));
} catch (e) {
  fail++; console.error('ERROR', e);
} finally {
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('--- server log ---\n' + log); }
  process.exit(fail ? 1 : 0);
}
