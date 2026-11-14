// Smoke test for the lockdown patch. Boots the BUILT server (dist-server) locally with
// SKIP_DB_INIT=1 and a fetch stub (no real Google/Claude/Resend/JobNimbus calls).
// Usage: npm run build && node scripts/smoke-lockdown.mjs
import { spawn, spawnSync } from 'node:child_process';
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
  EMBED_PARENT_ORIGINS: '',
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
  for (const p of ['/api/admin/users', '/api/admin/invites', '/api/admin/orders']) {
    const r = await req(p, { headers: { 'X-Forwarded-For': '198.51.100.40' } });
    check(`GET ${p} anonymous -> 401`, r.status === 401, `got ${r.status}`);
  }
  let invite = await jpost('/api/auth/accept-invite', { token: 'not-a-token', password: 'long-enough-pw' }, { 'X-Forwarded-For': '198.51.100.41' });
  check('accept-invite bad token -> 400 without a database', invite.status === 400, `got ${invite.status}`);
  invite = await jpost('/api/auth/accept-invite', { token: 'a'.repeat(32), password: 'short' }, { 'X-Forwarded-For': '198.51.100.42' });
  check('accept-invite short password -> 400', invite.status === 400, `got ${invite.status}`);

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
  const preGateLeak = ['roofSquares', 'pitchOver12', 'pitchCategory', 'avgPitchDegrees', 'totalAreaSqFt', 'footprintSqFt', 'hdzEstimate', 'uhdzEstimate', 'hdzPricePerSquare', 'lowEstimate', 'highEstimate', 'quoteLow', 'quoteHigh'];
  const preGateBlob = JSON.stringify(q);
  check('POST /api/roof/quote public -> 200', r.status === 200 && typeof q?.quoteId === 'string' && q.quoteId.length >= 16 && preGateLeak.every((key) => !Object.prototype.hasOwnProperty.call(q, key) && !preGateBlob.includes(`"${key}"`)), `got ${r.status}`);
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

  // Rendered quote page: staff links, embed header, call link, disclaimer, lead postMessage.
  const ui = spawnSync(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/check-quote-ui.tsx')], {
    cwd: root,
    encoding: 'utf8',
  });
  const uiLines = `${ui.stdout || ''}${ui.stderr || ''}`.split('\n').map(line => line.trim()).filter(Boolean);
  let uiChecks = 0;
  for (const line of uiLines) {
    if (line.startsWith('PASS ') || line.startsWith('FAIL ')) {
      uiChecks++;
      if (line.startsWith('PASS ')) pass++;
      else fail++;
      console.log(line);
    }
  }
  if (ui.status !== 0 && uiChecks === 0) {
    check('quote ui script ran', false, (ui.stderr || ui.stdout || `exit ${ui.status}`).slice(0, 500));
  }

  // 8. Public quote document may be framed by the K&D marketing site.
  // CORP is cross-origin there so a cross-origin no-cors fetch of the document
  // succeeds. Other responses keep SAMEORIGIN, no CSP, and CORP same-origin.
  const FRAME_ANCESTORS = "frame-ancestors 'self' https://kanddroofingnc.com https://www.kanddroofingnc.com";
  const quoteHeaderPaths = ['/quote', '/quote/', '/quote?address=1%20Main', '/quote?embed=1'];
  const quoteHeaders = [];
  for (const p of quoteHeaderPaths) {
    r = await req(p);
    const csp = r.headers.get('content-security-policy');
    const xfo = r.headers.get('x-frame-options');
    const corp = r.headers.get('cross-origin-resource-policy');
    quoteHeaders.push({ csp, xfo, corp });
    check(
      `GET ${p} allows K&D framing`,
      r.status === 200 && xfo === null && csp === FRAME_ANCESTORS && corp === 'cross-origin' && (r.headers.get('x-content-type-options') || '') === 'nosniff',
      `status=${r.status} xfo=${xfo} csp=${csp} corp=${corp}`,
    );
  }
  const embedHeaders = quoteHeaders[quoteHeaders.length - 1];
  const plainHeaders = quoteHeaders[0];
  check(
    'GET /quote?embed=1 headers match /quote',
    embedHeaders.csp === plainHeaders.csp && embedHeaders.xfo === plainHeaders.xfo && embedHeaders.corp === plainHeaders.corp,
    `quote=${JSON.stringify(plainHeaders)} embed=${JSON.stringify(embedHeaders)}`,
  );
  const unsetQuoteHtml = await (await req('/quote')).text();
  check('unset EMBED_PARENT_ORIGINS does not inject a parent list', !unsetQuoteHtml.includes('measurenow-embed-origins'));

  const previewPort = 4001;
  const previewBase = `http://127.0.0.1:${previewPort}`;
  const previewEnv = {
    ...env,
    PORT: String(previewPort),
    EMBED_PARENT_ORIGINS: 'https://preview.example.com, *, http://x.com, https://x.com/path, https://*.x.com, "><script>, https://a;b.test, https://a$\'.test, https://good.test:8443, https://x.test:99999, https://GOOD.TEST',
  };
  const preview = spawn(process.execPath, ['-r', path.join(root, 'scripts/fetch-stub.cjs'), path.join(root, 'dist-server/index.js')], { env: previewEnv, cwd: root });
  let previewLog = '';
  preview.stdout.on('data', d => { previewLog += d; });
  preview.stderr.on('data', d => { previewLog += d; });
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(previewBase + '/quote'); break; } catch { await new Promise(r => setTimeout(r, 200)); }
    }
    const previewQuote = await fetch(previewBase + '/quote');
    const previewCsp = previewQuote.headers.get('content-security-policy');
    const previewBody = await previewQuote.text();
    const expectedCsp = `${FRAME_ANCESTORS} https://preview.example.com https://good.test:8443 https://good.test`;
    check('preview origin is appended to frame-ancestors', previewQuote.status === 200 && previewCsp === expectedCsp && previewQuote.headers.get('x-frame-options') === null && previewQuote.headers.get('cross-origin-resource-policy') === 'cross-origin', `csp=${previewCsp}`);
    const marker = previewBody.match(/<script type="application\/json" id="measurenow-embed-origins">([\s\S]*?)<\/script>/);
    let listed = null;
    try { listed = marker ? JSON.parse(marker[1]) : null; } catch { listed = null; }
    check(
      'quote HTML gives the client the same parent list',
      JSON.stringify(listed) === JSON.stringify(['https://kanddroofingnc.com', 'https://www.kanddroofingnc.com', 'https://preview.example.com', 'https://good.test:8443', 'https://good.test']),
      `listed=${JSON.stringify(listed)}`,
    );
    check(
      'rejected embed values do not become markup or log text',
      !previewBody.includes('"><script>') && !previewBody.includes('http://x.com') && !previewBody.includes('*.x.com')
        && !previewBody.includes('a;b.test') && !previewBody.includes("a$'")
        && (previewBody.match(/id="root"/g) || []).length === 1
        && previewLog.includes('EMBED_PARENT_ORIGINS: ignored 8 invalid entries')
        && !previewLog.includes('"><script>') && !previewLog.includes('http://x.com') && !previewLog.includes('*.x.com')
        && !previewLog.includes('a;b.test') && !previewLog.includes("a$'"),
    );
    const previewHome = await fetch(previewBase + '/');
    check('preview env leaves other pages SAMEORIGIN', previewHome.headers.get('x-frame-options') === 'SAMEORIGIN' && previewHome.headers.get('content-security-policy') === null);
  } finally {
    preview.kill();
  }

  for (const p of ['/', '/login', '/api/roof/maps-key']) {
    r = await req(p);
    const csp = r.headers.get('content-security-policy');
    const xfo = r.headers.get('x-frame-options');
    const corp = r.headers.get('cross-origin-resource-policy');
    check(
      `GET ${p} stays SAMEORIGIN with no CSP`,
      xfo === 'SAMEORIGIN' && csp === null && corp === 'same-origin',
      `status=${r.status} xfo=${xfo} csp=${csp} corp=${corp}`,
    );
  }
} catch (e) {
  fail++; console.error('ERROR', e);
} finally {
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) { console.log('--- server log ---\n' + log); }
  process.exit(fail ? 1 : 0);
}
