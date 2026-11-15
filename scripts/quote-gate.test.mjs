// Gate tests. Boots the built server with stubbed fetch (no live JobNimbus, Resend, or Google).
// Usage: npm run build && node scripts/quote-gate.test.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.SESSION_SECRET = 'smoke-test-only';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { calculateQuote } = require(path.join(root, 'dist-server/services/pricing.js'));
const { signQuoteToken } = require(path.join(root, 'dist-server/services/quoteAccess.js'));

const PORT = 4025;
const BASE = `http://127.0.0.1:${PORT}`;
const LOG = path.join('/tmp', 'quote-gate-outbound.jsonl');
const env = {
  ...process.env,
  NODE_ENV: 'production',
  PORT: String(PORT),
  SKIP_DB_INIT: '1',
  GOOGLE_SOLAR_API_KEY: 'test-not-a-key',
  ANTHROPIC_API_KEY: '',
  RESEND_API_KEY: 'stub-not-real',
  JN_API_KEY: 'stub-not-real',
  SESSION_SECRET: 'smoke-test-only',
  CAP_GEOCODE_PUBLIC: '1000',
  CAP_QUOTE_PUBLIC: '1000',
  CAP_LEAD_PUBLIC: '1000',
  CAP_QUOTE_GATE_PUBLIC: '1000',
  EMBED_PARENT_ORIGINS: '',
  OUTBOUND_LOG: LOG,
  LANG: 'en_US.UTF-8',
};
fs.writeFileSync(LOG, '');
const srv = spawn(process.execPath, ['-r', path.join(root, 'scripts/quote-gate-preload.cjs'), path.join(root, 'dist-server/index.js')], {
  env,
  cwd: root,
});
let serverLog = '';
srv.stdout.on('data', (d) => { serverLog += d; });
srv.stderr.on('data', (d) => { serverLog += d; });

const PRICE_KEY = /price|total|cost|amount/i;
const PACKAGE_KEYS = new Set([
  'hdzEstimate', 'uhdzEstimate', 'hdzPricePerSquare', 'uhdzUpgradePerSquare',
  'uhdzPricePerSquare', 'lowEstimate', 'highEstimate', 'quoteLow', 'quoteHigh',
]);

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function priceKeys(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => priceKeys(item, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (PRICE_KEY.test(key) || PACKAGE_KEYS.has(key)) found.push(key);
      priceKeys(child, found);
    }
  }
  return found;
}

function containsNumber(value, target) {
  if (typeof value === 'number') return value === target;
  if (Array.isArray(value)) return value.some((item) => containsNumber(item, target));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsNumber(item, target));
  return false;
}

const MEASURE_KEY = /square|pitch|sqft|sqFt|price|total|cost|amount|estimate|waste/i;

function measureKeys(value, found = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => measureKeys(item, found));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (MEASURE_KEY.test(key)) found.push(key);
      measureKeys(child, found);
    }
  }
  return found;
}

const req = (p, options = {}) => fetch(BASE + p, options);
const jpost = (p, body, headers = {}) => req(p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

function readLog() {
  const text = fs.readFileSync(LOG, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function leadLogCount() {
  return readLog().filter((line) => LEAD_HOSTS.includes(new URL(line.url).host)).length;
}

const LEAD_HOSTS = ['app.jobnimbus.com', 'api.resend.com'];

async function waitLeadOutbound(timeout = 3000) {
  const start = Date.now();
  let lines = [];
  while (Date.now() - start < timeout) {
    lines = readLog().filter((line) => LEAD_HOSTS.includes(new URL(line.url).host));
    if (lines.length >= 2) return lines;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return lines;
}

function byHost(lines) {
  const out = {};
  for (const line of lines) {
    if (!line.body) continue;
    out[new URL(line.url).host] = JSON.parse(line.body);
  }
  return out;
}

const SQ_M_TO_SQ_FT = 10.764;
const segmentArea = 100 * SQ_M_TO_SQ_FT;
const totalAreaSqFt = segmentArea * 2;
const expectedQuote = calculateQuote({
  totalAreaSqFt,
  segments: [],
  avgPitch: 22,
  imageryQuality: 'HIGH',
  footprintSqFt: 0,
  estimatedPerimeterFt: 0,
  estimatedLength: 0,
  estimatedWidth: 0,
  boundingBox: null,
});
const roofSqFt = Math.round(totalAreaSqFt);
const contact = {
  name: 'Jane Homeowner',
  email: 'jane@example.com',
  phone: '(919) 555-0134',
  address: '1 Test St, Raleigh, NC',
};
// Today's QuoteResult submit. The gate must deliver this same payload through /api/lead/capture.
const todayPayload = {
  name: contact.name,
  email: contact.email,
  phone: contact.phone,
  address: contact.address,
  quoteLow: expectedQuote.hdzEstimate,
  quoteHigh: expectedQuote.uhdzEstimate,
  roofSqFt,
  roofSquares: expectedQuote.roofSquares,
  avgPitchDegrees: expectedQuote.avgPitchDegrees,
  pitchOver12: expectedQuote.pitchOver12,
};

const BANNED_NUMBERS = [
  expectedQuote.hdzEstimate,
  expectedQuote.uhdzEstimate,
  expectedQuote.lowEstimate,
  expectedQuote.highEstimate,
  430,
  470,
];

try {
  for (let i = 0; i < 50; i++) {
    try { await req('/api/auth/me'); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }

  const direct = await jpost('/api/lead/capture', todayPayload, { 'X-Forwarded-For': '198.51.100.21' });
  const directBody = await direct.json();
  check('direct lead capture still returns success and no prices', direct.status === 200 && directBody.success === true && priceKeys(directBody).length === 0, `status=${direct.status}`);
  const directOutbound = byHost(await waitLeadOutbound());
  check('direct capture calls JobNimbus and Resend stubs', Boolean(directOutbound['app.jobnimbus.com']) && Boolean(directOutbound['api.resend.com']));
  fs.writeFileSync(LOG, '');

  const quoted = await jpost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, { 'X-Forwarded-For': '198.51.100.22' });
  const progress = await quoted.json();
  const preGateNumbers = [
    ...BANNED_NUMBERS,
    expectedQuote.roofSquares,
    expectedQuote.pitchOver12,
    expectedQuote.avgPitchDegrees,
    roofSqFt,
  ];
  check('pre-gate quote is 200 with only a quote id', quoted.status === 200 && typeof progress.quoteId === 'string' && Object.keys(progress).join(',') === 'quoteId', `status=${quoted.status} keys=${Object.keys(progress).join(',')}`);
  check('pre-gate quote has no price keys', priceKeys(progress).length === 0, priceKeys(progress).join(','));
  check('pre-gate quote has no squares, pitch, or area', measureKeys(progress).length === 0, measureKeys(progress).join(','));
  const leaked = preGateNumbers.filter((n) => containsNumber(progress, n));
  check('pre-gate quote has no price, square, pitch, or area amounts', leaked.length === 0, leaked.join(','));
  check('pre-gate quote does not include a token', progress.token == null && progress.leadCreated == null);

  const earlyToken = signQuoteToken(progress.quoteId, Date.now() + 60_000);
  const early = await jpost('/api/roof/quote-reveal', { token: earlyToken }, { 'X-Forwarded-For': '198.51.100.23' });
  const earlyBody = await early.json();
  check('token for an ungated quote returns no prices', early.status === 401 && priceKeys(earlyBody).length === 0, `status=${early.status} keys=${priceKeys(earlyBody).join(',')}`);

  const gated = await jpost('/api/roof/quote-lead', { quoteId: progress.quoteId, ...contact }, { 'X-Forwarded-For': '198.51.100.24' });
  const gatedBody = await gated.json();
  check('gate submit returns prices', gated.status === 200 && gatedBody.leadCreated === true && gatedBody.quote?.hdzEstimate === expectedQuote.hdzEstimate && gatedBody.quote?.uhdzEstimate === expectedQuote.uhdzEstimate, `status=${gated.status} hdz=${gatedBody.quote?.hdzEstimate}`);
  check('gate prices match the package fields', gatedBody.quote?.hdzPricePerSquare === 430 && gatedBody.quote?.uhdzPricePerSquare === 470 && gatedBody.quote?.uhdzUpgradePerSquare === 40 && gatedBody.quote?.lowEstimate === expectedQuote.lowEstimate && gatedBody.quote?.highEstimate === expectedQuote.highEstimate);
  check('gate keeps the address that was submitted', gatedBody.address === contact.address);
  const gateOutbound = byHost(await waitLeadOutbound());
  check(
    'gate submit sends the same JobNimbus contact as today\'s lead payload',
    JSON.stringify(gateOutbound['app.jobnimbus.com']) === JSON.stringify(directOutbound['app.jobnimbus.com']),
    JSON.stringify(gateOutbound['app.jobnimbus.com']),
  );
  check(
    'gate submit sends the same Resend alert as today\'s lead payload',
    JSON.stringify(gateOutbound['api.resend.com']) === JSON.stringify(directOutbound['api.resend.com']),
  );
  check('stubbed lead calls are not live', !/ENOTFOUND|ECONNREFUSED/.test(serverLog));
  const afterFirst = readLog().filter((line) => LEAD_HOSTS.includes(new URL(line.url).host)).length;
  fs.writeFileSync(LOG, '');

  const again = await jpost('/api/roof/quote-lead', { quoteId: progress.quoteId, ...contact }, { 'X-Forwarded-For': '198.51.100.24' });
  const againBody = await again.json();
  await new Promise((r) => setTimeout(r, 250));
  check('resubmit returns prices without another lead', again.status === 200 && againBody.leadCreated === false && againBody.quote?.hdzEstimate === expectedQuote.hdzEstimate && leadLogCount() === 0, `status=${again.status} outbound=${leadLogCount()}`);

  const secondQuote = await jpost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, { 'X-Forwarded-For': '198.51.100.25' });
  const secondProgress = await secondQuote.json();
  const secondGate = await jpost('/api/roof/quote-lead', { quoteId: secondProgress.quoteId, ...contact }, { 'X-Forwarded-For': '198.51.100.25' });
  const secondBody = await secondGate.json();
  await new Promise((r) => setTimeout(r, 250));
  check('same contact and roof does not send a second lead', secondGate.status === 200 && secondBody.leadCreated === false && secondBody.quote?.uhdzEstimate === expectedQuote.uhdzEstimate && leadLogCount() === 0, `outbound=${leadLogCount()}`);

  const revealed = await jpost('/api/roof/quote-reveal', { token: gatedBody.token }, { 'X-Forwarded-For': '198.51.100.26' });
  const revealedBody = await revealed.json();
  await new Promise((r) => setTimeout(r, 200));
  check(
    'valid token returns the same prices and does not send a lead',
    revealed.status === 200
      && revealedBody.leadCreated === false
      && revealedBody.quote?.hdzEstimate === gatedBody.quote.hdzEstimate
      && revealedBody.quote?.uhdzEstimate === gatedBody.quote.uhdzEstimate
      && revealedBody.address === contact.address
      && leadLogCount() === 0,
    `status=${revealed.status} outbound=${leadLogCount()}`,
  );

  const missing = await jpost('/api/roof/quote-reveal', {}, { 'X-Forwarded-For': '198.51.100.27' });
  const missingBody = await missing.json();
  const bad = await jpost('/api/roof/quote-reveal', { token: 'not-a-token' }, { 'X-Forwarded-For': '198.51.100.28' });
  const badBody = await bad.json();
  const expired = signQuoteToken(progress.quoteId, Date.now() - 5_000);
  const expiredRes = await jpost('/api/roof/quote-reveal', { token: expired }, { 'X-Forwarded-For': '198.51.100.29' });
  const expiredBody = await expiredRes.json();
  const flipped = gatedBody.token.slice(0, -1) + (gatedBody.token.endsWith('a') ? 'b' : 'a');
  const tampered = await jpost('/api/roof/quote-reveal', { token: flipped }, { 'X-Forwarded-For': '198.51.100.30' });
  const tamperedBody = await tampered.json();
  check('missing token returns no prices', missing.status === 401 && priceKeys(missingBody).length === 0, `status=${missing.status}`);
  check('invalid token returns no prices', bad.status === 401 && priceKeys(badBody).length === 0, `status=${bad.status}`);
  check('expired token returns no prices', expiredRes.status === 401 && priceKeys(expiredBody).length === 0, `status=${expiredRes.status}`);
  check('tampered token returns no prices', tampered.status === 401 && priceKeys(tamperedBody).length === 0, `status=${tampered.status}`);

  const badPhone = await jpost('/api/roof/quote-lead', { quoteId: progress.quoteId, ...contact, phone: '123' }, { 'X-Forwarded-For': '198.51.100.31' });
  const badPhoneBody = await badPhone.json();
  const badEmail = await jpost('/api/roof/quote-lead', { quoteId: progress.quoteId, ...contact, email: 'not-an-email' }, { 'X-Forwarded-For': '198.51.100.32' });
  const badEmailBody = await badEmail.json();
  await new Promise((r) => setTimeout(r, 200));
  check('invalid phone is rejected with no prices and no lead', badPhone.status === 400 && priceKeys(badPhoneBody).length === 0 && leadLogCount() === 0, badPhoneBody.error || '');
  check('invalid email is rejected with no prices and no lead', badEmail.status === 400 && priceKeys(badEmailBody).length === 0, badEmailBody.error || '');

  const limitIp = '203.0.113.77';
  const limitQuote = await jpost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, { 'X-Forwarded-For': limitIp });
  const limitProgress = await limitQuote.json();
  const limitCodes = [];
  for (let i = 0; i < 6; i++) {
    const res = await jpost('/api/roof/quote-lead', {
      quoteId: limitProgress.quoteId,
      ...contact,
      email: 'limit@example.com',
    }, { 'X-Forwarded-For': limitIp });
    limitCodes.push(res.status);
    await res.json().catch(() => ({}));
  }
  check('gate keeps a 5 per hour limit', limitCodes.slice(0, 5).every((code) => code === 200) && limitCodes[5] === 429, limitCodes.join(','));

  const geocode = await jpost('/api/roof/geocode', { address: '1 Test St Raleigh' }, { 'X-Forwarded-For': '198.51.100.40' });
  const geocodeBody = await geocode.json();
  check('geocode response has no squares, pitch, area, or prices', geocode.status === 200 && measureKeys(geocodeBody).length === 0, measureKeys(geocodeBody).join(','));
  const maps = await req('/api/roof/maps-key');
  const mapsBody = await maps.json();
  check('maps key response has no squares, pitch, area, or prices', maps.status === 200 && measureKeys(mapsBody).length === 0, measureKeys(mapsBody).join(','));

  const budgetIp = '192.0.2.77';
  const budgetIds = [];
  const budgetQuotes = [];
  for (let i = 0; i < 21; i++) {
    const res = await jpost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, { 'X-Forwarded-For': budgetIp });
    budgetQuotes.push(res.status);
    const body = await res.json().catch(() => ({}));
    if (res.status === 200) budgetIds.push(body.quoteId);
  }
  const budgetGate = await jpost('/api/roof/quote-lead', {
    quoteId: budgetIds[0],
    ...contact,
    email: 'budget@example.com',
  }, { 'X-Forwarded-For': budgetIp });
  check(
    'a used quote allowance does not block the gate',
    budgetQuotes[19] === 200 && budgetQuotes[20] === 429 && budgetGate.status === 200,
    `quotes=${budgetQuotes[19]},${budgetQuotes[20]} gate=${budgetGate.status}`,
  );
  await budgetGate.json().catch(() => ({}));

  const capPort = 4026;
  const capLog = path.join('/tmp', 'quote-gate-cap-outbound.jsonl');
  fs.writeFileSync(capLog, '');
  const capSrv = spawn(process.execPath, ['-r', path.join(root, 'scripts/quote-gate-preload.cjs'), path.join(root, 'dist-server/index.js')], {
    env: { ...env, PORT: String(capPort), CAP_QUOTE_PUBLIC: '2', OUTBOUND_LOG: capLog },
    cwd: root,
  });
  const capBase = `http://127.0.0.1:${capPort}`;
  const capPost = (p, body, ip) => fetch(capBase + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
  try {
    for (let i = 0; i < 50; i++) {
      try { await fetch(capBase + '/api/auth/me'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const firstQuote = await capPost('/api/roof/quote', { lat: 35.78, lng: -78.64 }, '198.51.100.80');
    const firstBody = await firstQuote.json();
    const firstGate = await capPost('/api/roof/quote-lead', { quoteId: firstBody.quoteId, ...contact, email: 'cap-a@example.com' }, '198.51.100.80');
    const firstGateBody = await firstGate.json();
    const reveals = [];
    for (let i = 0; i < 5; i++) reveals.push((await capPost('/api/roof/quote-reveal', { token: firstGateBody.token }, '198.51.100.80')).status);
    const secondQuote = await capPost('/api/roof/quote', { lat: 35.79, lng: -78.65 }, '198.51.100.81');
    const secondBody = await secondQuote.json();
    const secondGate = await capPost('/api/roof/quote-lead', { quoteId: secondBody.quoteId, ...contact, email: 'cap-b@example.com' }, '198.51.100.81');
    const thirdQuote = await capPost('/api/roof/quote', { lat: 35.8, lng: -78.66 }, '198.51.100.82');
    const afterCap = await capPost('/api/roof/quote-lead', { quoteId: secondBody.quoteId, ...contact, email: 'cap-b@example.com' }, '198.51.100.81');
    check(
      'quote cap counts the paid lookup once',
      firstQuote.status === 200 && firstGate.status === 200 && reveals.every((code) => code === 200)
        && secondQuote.status === 200 && secondGate.status === 200 && thirdQuote.status === 429 && afterCap.status === 200,
      `q1=${firstQuote.status} g1=${firstGate.status} reveals=${reveals.join(',')} q2=${secondQuote.status} g2=${secondGate.status} q3=${thirdQuote.status} gateAfterCap=${afterCap.status}`,
    );
  } finally {
    capSrv.kill();
  }

  const html = await (await req('/quote')).text();
  const embedHtml = await (await req('/quote?embed=1')).text();
  const htmlBlob = `${html}\n${embedHtml}`;
  const htmlHits = ['hdzEstimate', 'uhdzEstimate', 'quoteLow', 'quoteHigh', 'hdzPricePerSquare', '$430', '$470', 'lowEstimate', 'highEstimate', 'roofSquares', 'pitchOver12', 'totalAreaSqFt']
    .filter((needle) => htmlBlob.includes(needle));
  check('server-rendered quote HTML has no price fields', html.startsWith('<!DOCTYPE html>') && htmlHits.length === 0, htmlHits.join(','));

  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
  let bundle = '';
  for (const src of scripts) {
    bundle += await (await req(src)).text();
  }
  check('client bundle is served', bundle.length > 0, `scripts=${scripts.join(',')}`);
  check('client bundle does not call the lead endpoint', !bundle.includes('/api/lead/capture'));
  const bundlePrices = ['$430', '$470', 'hdzPricePerSquare:430', 'HDZ_PRICE_PER_SQUARE'].filter((needle) => bundle.includes(needle));
  check('client bundle does not embed package prices', bundlePrices.length === 0, bundlePrices.join(','));

  for (const file of ['gaf-timberline-hdz.webp', 'gaf-timberline-uhdz.webp']) {
    const bytes = fs.statSync(path.join(root, 'public/images', file)).size;
    check(`${file} is under 80KB`, bytes > 0 && bytes <= 80 * 1024, `${bytes} bytes`);
  }

  check('no unexpected outbound during the run', afterFirst >= 2);
} catch (err) {
  fail++;
  console.error('ERROR', err);
} finally {
  srv.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) console.log('--- server log ---\n' + serverLog.slice(-4000));
  process.exit(fail ? 1 : 0);
}
