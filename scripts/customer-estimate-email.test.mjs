// Customer estimate email. Boots the built server with the fetch stub.
// No live Resend, JobNimbus, or Google calls.
// Usage: npm run build && node scripts/customer-estimate-email.test.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const email = require(path.join(root, 'dist-server/services/customerEstimateEmail.js'));
const { calculateQuote } = require(path.join(root, 'dist-server/services/pricing.js'));
const { QUOTE_WARRANTY, quoteCardWarrantyLines } = require(path.join(root, 'dist-server/services/quoteCardCopy.js'));

const RATE_COPY = ['/sq', 'per square', '$430', '$470'];
const ELITE_LINE = 'K&D Roofing is a 2026 GAF Master Elite® Roofing Contractor';
const LICENSE = 'NC General Contractor License L.101285 (Limited, Residential)';
const POSTAL_STREET = '8601 Six Forks Rd., Suite 400';
const POSTAL_CITY = 'Raleigh, NC 27615';
const RECEIPT_LINE = "You're receiving this because you requested an instant roof quote at kanddroofingnc.com.";
const CALENDLY = 'https://calendly.com/admin-kanddroofingnc/30min';
const FROM = 'K&D Roofing <noreply@kanddroofingnc.com>';
const REPLY_TO = 'todd@kanddroofingnc.com';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function rateHits(value) {
  const text = String(value || '').toLowerCase();
  return RATE_COPY.filter((needle) => text.includes(needle.toLowerCase()));
}

function bareBrand(value) {
  const text = String(value || '').replace(/&amp;/g, '&');
  return [...text.matchAll(/K&D(?! Roofing)/g)].length;
}

const building = {
  segments: [],
  avgPitch: 22,
  imageryQuality: 'HIGH',
  footprintSqFt: 0,
  estimatedPerimeterFt: 0,
  estimatedLength: 0,
  estimatedWidth: 0,
  boundingBox: null,
};
const cardQuote = calculateQuote({ ...building, totalAreaSqFt: 2000 });
const measuredArea = 100 * 10.764 * 2;
const measured = calculateQuote({ ...building, totalAreaSqFt: measuredArea });
const measuredSqFt = Math.round(measuredArea);
function money(amount) {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

const sample = {
  to: 'jane@example.com',
  name: 'Jane <Homeowner>',
  address: '1 Test St, Raleigh, NC',
  roofSqFt: 2000,
  hdzEstimate: cardQuote.hdzEstimate,
  uhdzEstimate: cardQuote.uhdzEstimate,
  lat: 35.78,
  lng: -78.64,
};

const savedEnv = { ...process.env };
function setEnv(values) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('CUSTOMER_') || key.startsWith('ESTIMATE_') || key === 'RESEND_API_KEY' || key === 'GOOGLE_SOLAR_API_KEY') {
      delete process.env[key];
    }
  }
  Object.assign(process.env, values);
}
function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
}

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

setEnv({});
check('email flag defaults off', email.customerEstimateEmailEnabled() === false);
check('snapshot flag defaults off', email.estimateSnapshotEnabled() === false);
for (const value of ['TRUE', '1', 'yes', ' true', 'true ', '']) {
  process.env.CUSTOMER_ESTIMATE_EMAIL_ENABLED = value;
  process.env.ESTIMATE_EMAIL_SNAPSHOT_ENABLED = value;
  check(`flag ${JSON.stringify(value)} stays off`, email.customerEstimateEmailEnabled() === false && email.estimateSnapshotEnabled() === false);
}
process.env.CUSTOMER_ESTIMATE_EMAIL_ENABLED = 'true';
process.env.ESTIMATE_EMAIL_SNAPSHOT_ENABLED = 'true';
check('exact true turns both flags on', email.customerEstimateEmailEnabled() === true && email.estimateSnapshotEnabled() === true);

const rendered = email.renderCustomerEstimateEmail(sample, { contentType: 'image/png', bytes: png });
const hdzLines = quoteCardWarrantyLines('hdz');
const uhdzLines = quoteCardWarrantyLines('uhdz');
const combined = `${rendered.subject}\n${rendered.html}\n${rendered.text}`;
check('email uses the configured from, reply-to, and customer address', rendered.from === FROM && rendered.replyTo === REPLY_TO && rendered.to === sample.to);
check('email shows both card totals', rendered.html.includes('$9,900') && rendered.html.includes('$10,800') && rendered.text.includes('$9,900') && rendered.text.includes('$10,800') && cardQuote.hdzEstimate === 9900 && cardQuote.uhdzEstimate === 10800);
check('email warranty lines match the quote cards', hdzLines.every((line) => rendered.text.includes(line)) && uhdzLines.every((line) => rendered.text.includes(line)) && rendered.text.includes(QUOTE_WARRANTY.goldenPledge.hdz) && rendered.text.includes(QUOTE_WARRANTY.goldenPledge.uhdz) && rendered.text.includes(QUOTE_WARRANTY.algae.hdz) && rendered.text.includes(QUOTE_WARRANTY.algae.uhdz));
check('email has no per-square price', rateHits(combined).length === 0, rateHits(combined).join(','));
check('email keeps the company name and phone', bareBrand(combined) === 0 && combined.includes('(919) 977-4074') && combined.includes('K&D Roofing') && !/no pressure/i.test(combined) && !/solar/i.test(combined));
check('email includes the confirmed license, badge line, calendly, and GAF ID', rendered.text.includes(LICENSE) && rendered.text.includes(ELITE_LINE) && rendered.text.includes('Book your free inspection') && rendered.text.includes(CALENDLY) && rendered.text.includes('GAF ID 1115371'));
check('email escapes a first name and does not print the rest', rendered.text.includes('Hi Jane,') && !rendered.text.includes('Homeowner') && !rendered.text.includes('<'));
function greet(name) {
  return email.renderCustomerEstimateEmail({ ...sample, name, address: '' }, null);
}
function greetingDropped(name) {
  const message = greet(name);
  const blob = `${message.html}\n${message.text}`;
  return message.text.includes('Hi there,') && !blob.includes(name);
}
check('normal first name is the greeting', greet('Jane Homeowner').text.includes('Hi Jane,') && !greet('Jane Homeowner').text.includes('Homeowner'));
check('Mary is allowed', greet('Mary').text.includes('Hi Mary,'));
check("O'Brien is allowed", greet("O'Brien").text.includes("Hi O'Brien,"));
check('Anne-Marie is allowed', greet('Anne-Marie').text.includes('Hi Anne-Marie,'));
check('José is allowed', greet('José').text.includes('Hi José,'));
for (const name of ['evil.com/pay', 'bit.ly/x9', 'EVIL.COM!', 'evil.com,', 'evil\uFF0Ecom', 'evil[.]com', 'javascript:alert(1)', '12345', '😀', '<script>', 'A'.repeat(41)]) {
  check(`greeting drops ${name}`, greetingDropped(name));
}
check('email uses the license line without an expiry date', rendered.text.includes(LICENSE) && !rendered.text.includes('active through') && !rendered.html.includes('active through'));
check('footer has the postal address, phone, and receipt line', rendered.html.includes(POSTAL_STREET) && rendered.html.includes(POSTAL_CITY) && rendered.html.includes('href="tel:+19199774074"') && rendered.html.includes('You&#39;re receiving this because you requested an instant roof quote at kanddroofingnc.com.') && rendered.text.includes(POSTAL_STREET) && rendered.text.includes(POSTAL_CITY) && rendered.text.includes(RECEIPT_LINE) && !/unsubscribe/i.test(`${rendered.html}\n${rendered.text}`));
check('snapshot is a CID attachment and the html has no map URL or key', rendered.html.includes('cid:house-snapshot') && rendered.attachments.length === 1 && rendered.attachments[0].content_id === 'house-snapshot' && !rendered.html.includes('googleapis') && !rendered.html.includes('staticmap') && !rendered.html.includes('test-not-a-key') && !rendered.html.includes('key='));
check('logo and badge are absolute urls with alt text', rendered.html.includes('https://measurenow-production.up.railway.app/static/kd-logo.png') && rendered.html.includes('alt="K&amp;D Roofing"') && rendered.html.includes('/static/master-elite-240.png') && rendered.html.includes('width="120"') && rendered.html.includes('width="140"'));

setEnv({
  CUSTOMER_EMAIL_CALENDLY_URL: '',
  CUSTOMER_EMAIL_CALENDLY_LABEL: '',
  CUSTOMER_EMAIL_GC_LICENSE: '   ',
  CUSTOMER_EMAIL_MASTER_ELITE_TEXT: '',
  CUSTOMER_EMAIL_GAF_ID: '',
  CUSTOMER_EMAIL_ASSET_BASE_URL: '',
  CUSTOMER_EMAIL_LOGO_PATH: '',
  CUSTOMER_EMAIL_MASTER_ELITE_IMAGE_PATH: '',
  CUSTOMER_EMAIL_REPLY_TO: '',
});
const dropped = email.renderCustomerEstimateEmail(sample, null);
const droppedBlob = `${dropped.html}\n${dropped.text}`;
check('empty config drops license, badge claim, calendly, id, and images', dropped.replyTo === null && !droppedBlob.includes('Book your free inspection') && !droppedBlob.includes('calendly.com') && !droppedBlob.includes('L.101285') && !droppedBlob.includes('Master Elite') && !droppedBlob.includes('1115371') && !droppedBlob.includes('<img') && !droppedBlob.includes('cid:') && dropped.html.includes('$9,900') && dropped.html.includes('$10,800'));

const originalFetch = global.fetch;
let fetchCalls = 0;
global.fetch = async () => {
  fetchCalls += 1;
  throw new Error('should not fetch');
};
setEnv({ ESTIMATE_EMAIL_SNAPSHOT_ENABLED: '' });
const skipped = await email.fetchSatelliteSnapshot(35.78, -78.64);
check('snapshot flag off does not call Google', skipped === null && fetchCalls === 0);

let seenUrl = '';
global.fetch = async (url) => {
  seenUrl = String(url);
  return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
};
setEnv({ ESTIMATE_EMAIL_SNAPSHOT_ENABLED: 'true', GOOGLE_SOLAR_API_KEY: 'test-not-a-key' });
const shot = await email.fetchSatelliteSnapshot(35.78, -78.64);
const shotUrl = new URL(seenUrl);
check('snapshot request is server-side satellite static maps', shot && shot.bytes.length === png.length && shotUrl.hostname === 'maps.googleapis.com' && shotUrl.pathname === '/maps/api/staticmap' && shotUrl.searchParams.get('maptype') === 'satellite' && shotUrl.searchParams.get('center') === '35.78,-78.64' && shotUrl.searchParams.get('key') === 'test-not-a-key');
const withShot = email.renderCustomerEstimateEmail(sample, shot);
check('rendered snapshot does not contain the request or the key', !withShot.html.includes(seenUrl) && !withShot.html.includes('test-not-a-key') && !withShot.text.includes('test-not-a-key') && !withShot.html.includes('googleapis'));

global.fetch = async () => {
  throw new Error('network down jane@example.com Jane Homeowner 1 Test St test-not-a-key');
};
setEnv({
  CUSTOMER_ESTIMATE_EMAIL_ENABLED: 'true',
  ESTIMATE_EMAIL_SNAPSHOT_ENABLED: 'true',
  RESEND_API_KEY: 'stub-not-real',
  GOOGLE_SOLAR_API_KEY: 'test-not-a-key',
});
const logs = [];
const originalError = console.error;
console.error = (...args) => { logs.push(args.map((item) => String(item)).join(' ')); };
let threw = false;
try {
  await email.deliverCustomerEstimateEmail(sample);
} catch {
  threw = true;
}
console.error = originalError;
const logBlob = logs.join('\n');
check('send failure does not break the caller or log PII', threw === false && logBlob.includes('customer estimate email failed') && !logBlob.includes('jane@example.com') && !logBlob.includes('Jane') && !logBlob.includes('Test St') && !logBlob.includes('test-not-a-key'));
global.fetch = originalFetch;
restoreEnv();

function startServer(port, extra) {
  const log = path.join('/tmp', `customer-estimate-${port}.jsonl`);
  fs.writeFileSync(log, '');
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
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
    OUTBOUND_LOG: log,
    CUSTOMER_ESTIMATE_EMAIL_ENABLED: '',
    ESTIMATE_EMAIL_SNAPSHOT_ENABLED: '',
    STUB_STATICMAP_DELAY_MS: '',
    ...extra,
  };
  const child = spawn(process.execPath, ['-r', path.join(root, 'scripts/quote-gate-preload.cjs'), path.join(root, 'dist-server/index.js')], {
    env,
    cwd: root,
  });
  let serverLog = '';
  child.stdout.on('data', (d) => { serverLog += d; });
  child.stderr.on('data', (d) => { serverLog += d; });
  return { child, log, port, serverLog: () => serverLog };
}

async function waitReady(port) {
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/auth/me`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`server ${port} did not start`);
}

function readLog(file) {
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return [];
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function parsed(lines, host) {
  return lines.filter((line) => line.body && new URL(line.url).host === host).map((line) => JSON.parse(line.body));
}

async function waitFor(file, predicate, timeout = 4000) {
  const start = Date.now();
  let lines = readLog(file);
  while (!predicate(lines) && Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 40));
    lines = readLog(file);
  }
  return lines;
}

const contact = {
  name: 'Jane Homeowner',
  email: 'jane@example.com',
  phone: '(919) 555-0134',
  address: '1 Test St, Raleigh, NC',
};

async function post(port, pathname, body, ip) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify(body),
  });
}

const servers = [];
try {
  const off = startServer(4041, {});
  servers.push(off);
  await waitReady(off.port);
  const leadPayload = {
    ...contact,
    quoteLow: measured.hdzEstimate,
    quoteHigh: measured.uhdzEstimate,
    roofSqFt: measuredSqFt,
    roofSquares: measured.roofSquares,
    avgPitchDegrees: measured.avgPitchDegrees,
    pitchOver12: measured.pitchOver12,
  };
  const direct = await post(off.port, '/api/lead/capture', leadPayload, '198.51.100.21');
  const directBody = await direct.json();
  const directLines = await waitFor(off.log, (lines) => parsed(lines, 'api.resend.com').length >= 1 && parsed(lines, 'app.jobnimbus.com').length >= 1);
  const directTodd = parsed(directLines, 'api.resend.com')[0];
  const directJn = parsed(directLines, 'app.jobnimbus.com')[0];
  fs.writeFileSync(off.log, '');
  const quoted = await post(off.port, '/api/roof/quote', { lat: 35.78, lng: -78.64 }, '198.51.100.22');
  const progress = await quoted.json();
  const gated = await post(off.port, '/api/roof/quote-lead', { quoteId: progress.quoteId, ...contact }, '198.51.100.22');
  const gatedBody = await gated.json();
  const offLines = await waitFor(off.log, (lines) => parsed(lines, 'api.resend.com').length >= 1 && parsed(lines, 'app.jobnimbus.com').length >= 1);
  await new Promise((r) => setTimeout(r, 200));
  const offAfter = readLog(off.log);
  const offCustomer = parsed(offAfter, 'api.resend.com').filter((body) => Array.isArray(body.to) && body.to.includes(contact.email));
  check('flag off capture still succeeds', direct.status === 200 && directBody.success === true);
  check('flag off gate matches the quote totals', gated.status === 200 && gatedBody.leadCreated === true && gatedBody.quote.hdzEstimate === measured.hdzEstimate && gatedBody.quote.uhdzEstimate === measured.uhdzEstimate);
  check('flag off sends no customer email and no static map', offCustomer.length === 0 && !offAfter.some((line) => String(line.url).includes('staticmap')));
  check('flag off todd email and JobNimbus match the direct lead', JSON.stringify(parsed(offLines, 'api.resend.com')[0]) === JSON.stringify(directTodd) && JSON.stringify(parsed(offLines, 'app.jobnimbus.com')[0]) === JSON.stringify(directJn));

  const on = startServer(4042, {
    CUSTOMER_ESTIMATE_EMAIL_ENABLED: 'true',
    ESTIMATE_EMAIL_SNAPSHOT_ENABLED: 'true',
    STUB_STATICMAP_DELAY_MS: '1500',
  });
  servers.push(on);
  await waitReady(on.port);
  const onDirect = await post(on.port, '/api/lead/capture', leadPayload, '198.51.100.31');
  await onDirect.json();
  const onDirectLines = await waitFor(on.log, (lines) => parsed(lines, 'api.resend.com').some((body) => body.to?.[0] === 'todd@kanddroofingnc.com') && parsed(lines, 'app.jobnimbus.com').length >= 1);
  const onTodd = parsed(onDirectLines, 'api.resend.com').find((body) => body.to?.[0] === 'todd@kanddroofingnc.com');
  const onJn = parsed(onDirectLines, 'app.jobnimbus.com')[0];
  fs.writeFileSync(on.log, '');
  const onQuote = await post(on.port, '/api/roof/quote', { lat: 35.78, lng: -78.64 }, '198.51.100.32');
  const onProgress = await onQuote.json();
  const started = Date.now();
  const onGate = await post(on.port, '/api/roof/quote-lead', { quoteId: onProgress.quoteId, ...contact }, '198.51.100.32');
  const elapsed = Date.now() - started;
  const onBody = await onGate.json();
  check('accepted lead responds without waiting for the snapshot', onGate.status === 200 && onBody.leadCreated === true && elapsed < 1000, `elapsed=${elapsed}`);
  const onLines = await waitFor(on.log, (lines) => parsed(lines, 'api.resend.com').some((body) => body.to?.[0] === contact.email) && lines.some((line) => String(line.url).includes('staticmap')), 4000);
  const customerMails = parsed(onLines, 'api.resend.com').filter((body) => Array.isArray(body.to) && body.to.includes(contact.email));
  const toddMails = parsed(onLines, 'api.resend.com').filter((body) => body.to?.[0] === 'todd@kanddroofingnc.com');
  const customer = customerMails[0];
  const customerHtml = String(customer?.html || '');
  const customerText = String(customer?.text || '');
  const customerBlob = `${customer?.subject || ''}\n${customerHtml}\n${customerText}`;
  check('accepted lead sends exactly one customer email', customerMails.length === 1 && customer.to.length === 1 && customer.to[0] === contact.email && customer.from === FROM && customer.reply_to === REPLY_TO);
  check('customer email failure still returns the quote', onBody.quote.hdzEstimate === measured.hdzEstimate && onBody.quote.uhdzEstimate === measured.uhdzEstimate && onBody.error == null);
  check('customer email has the card totals and no per-square text', customerHtml.includes(money(measured.hdzEstimate)) && customerHtml.includes(money(measured.uhdzEstimate)) && customerText.includes(QUOTE_WARRANTY.goldenPledge.hdz) && customerText.includes(QUOTE_WARRANTY.goldenPledge.uhdz) && rateHits(customerBlob).length === 0, rateHits(customerBlob).join(','));
  check('customer email has license, Master Elite line, and calendly button', customerText.includes(LICENSE) && customerText.includes(ELITE_LINE) && customerHtml.includes('Book your free inspection') && customerHtml.includes(CALENDLY));
  check('customer email embeds the snapshot and hides the API key', customerHtml.includes('cid:house-snapshot') && customer.attachments?.[0]?.content_id === 'house-snapshot' && !customerBlob.includes('test-not-a-key') && !customerBlob.includes('googleapis') && !customerBlob.includes('staticmap') && !customerBlob.includes('key='));
  check('gate todd email and JobNimbus match a direct lead', JSON.stringify(toddMails[0]) === JSON.stringify(onTodd) && JSON.stringify(parsed(onLines, 'app.jobnimbus.com')[0]) === JSON.stringify(onJn));
  check('stubbed calls are not live', !/ENOTFOUND|ECONNREFUSED/.test(on.serverLog()));
  fs.writeFileSync(on.log, '');
  const again = await post(on.port, '/api/roof/quote-lead', { quoteId: onProgress.quoteId, ...contact }, '198.51.100.32');
  const againBody = await again.json();
  const revealed = await post(on.port, '/api/roof/quote-reveal', { token: onBody.token }, '198.51.100.33');
  const revealedBody = await revealed.json();
  const secondQuote = await post(on.port, '/api/roof/quote', { lat: 35.78, lng: -78.64 }, '198.51.100.34');
  const secondProgress = await secondQuote.json();
  const secondGate = await post(on.port, '/api/roof/quote-lead', { quoteId: secondProgress.quoteId, ...contact }, '198.51.100.34');
  const secondBody = await secondGate.json();
  await new Promise((r) => setTimeout(r, 400));
  const later = readLog(on.log);
  const laterCustomer = parsed(later, 'api.resend.com').filter((body) => Array.isArray(body.to) && body.to.includes(contact.email));
  check('resubmit, refresh, and the same roof do not send another customer email', again.status === 200 && againBody.leadCreated === false && revealed.status === 200 && revealedBody.leadCreated === false && secondGate.status === 200 && secondBody.leadCreated === false && laterCustomer.length === 0 && !later.some((line) => String(line.url).includes('staticmap')));
  fs.writeFileSync(on.log, '');
  async function gatedEmail(ip, quoteBody, gateFields) {
    const quoted = await post(on.port, '/api/roof/quote', quoteBody, ip);
    const progress = await quoted.json();
    const gated = await post(on.port, '/api/roof/quote-lead', { quoteId: progress.quoteId, ...contact, ...gateFields }, ip);
    const body = await gated.json();
    const lines = await waitFor(on.log, (entries) => parsed(entries, 'api.resend.com').some((mail) => mail.to?.[0] === gateFields.email));
    fs.writeFileSync(on.log, '');
    const mail = parsed(lines, 'api.resend.com').find((item) => item.to?.[0] === gateFields.email);
    return { status: gated.status, body, blob: `${mail?.html || ''}\n${mail?.text || ''}` };
  }
  const unmatched = await gatedEmail('198.51.100.36', {
    lat: 40.1,
    lng: -75.2,
    address: '500 Pine Street, Seattle, WA',
  }, { email: 'none@example.com', address: '99 Typed Road, Durham, NC' });
  check(
    'with no geocode match the email has no address line',
    unmatched.status === 200
      && unmatched.body.address === '99 Typed Road, Durham, NC'
      && !unmatched.blob.includes('Seattle')
      && !unmatched.blob.includes('Pine')
      && !unmatched.blob.includes('1 Test St')
      && !unmatched.blob.includes('Typed Road'),
  );
  const located = await post(on.port, '/api/roof/geocode', { address: '1 Test St Raleigh' }, '198.51.100.37');
  const locatedBody = await located.json();
  const ignored = await gatedEmail('198.51.100.38', {
    lat: locatedBody.lat,
    lng: locatedBody.lng,
    address: '123 Fake Arbitrary Lane',
  }, { email: 'arb@example.com', address: '99 Typed Road, Durham, NC' });
  check(
    'an arbitrary body address is ignored',
    located.status === 200
      && ignored.blob.includes(locatedBody.address)
      && !ignored.blob.includes('Fake Arbitrary'),
  );
  const seattle = await gatedEmail('198.51.100.39', {
    lat: locatedBody.lat,
    lng: locatedBody.lng,
    address: '500 Pine Street, Seattle, WA',
  }, { email: 'sea@example.com', address: '99 Typed Road, Durham, NC' });
  check(
    'a Seattle body address with Raleigh lat/lng is not in the email',
    !seattle.blob.includes('Seattle') && seattle.blob.includes(locatedBody.address),
  );
  check(
    'the normal flow uses the server geocode address',
    seattle.blob.includes('1 Test St, Raleigh, NC') && !seattle.blob.includes('Typed Road'),
  );

  const empty = startServer(4043, {
    CUSTOMER_ESTIMATE_EMAIL_ENABLED: 'true',
    ESTIMATE_EMAIL_SNAPSHOT_ENABLED: '',
    CUSTOMER_EMAIL_CALENDLY_URL: '',
    CUSTOMER_EMAIL_CALENDLY_LABEL: '',
    CUSTOMER_EMAIL_GC_LICENSE: '',
    CUSTOMER_EMAIL_MASTER_ELITE_TEXT: '',
    CUSTOMER_EMAIL_GAF_ID: '',
    CUSTOMER_EMAIL_ASSET_BASE_URL: '',
    CUSTOMER_EMAIL_LOGO_PATH: '',
    CUSTOMER_EMAIL_MASTER_ELITE_IMAGE_PATH: '',
    CUSTOMER_EMAIL_REPLY_TO: '',
  });
  servers.push(empty);
  await waitReady(empty.port);
  const emptyQuote = await post(empty.port, '/api/roof/quote', { lat: 35.78, lng: -78.64 }, '198.51.100.41');
  const emptyProgress = await emptyQuote.json();
  const emptyGate = await post(empty.port, '/api/roof/quote-lead', { quoteId: emptyProgress.quoteId, ...contact, email: 'empty@example.com' }, '198.51.100.41');
  const emptyBody = await emptyGate.json();
  const emptyLines = await waitFor(empty.log, (lines) => parsed(lines, 'api.resend.com').some((body) => body.to?.[0] === 'empty@example.com'));
  const emptyMail = parsed(emptyLines, 'api.resend.com').find((body) => body.to?.[0] === 'empty@example.com');
  const emptyBlob = `${emptyMail?.html || ''}\n${emptyMail?.text || ''}`;
  check('missing config still sends one email and drops those blocks', emptyGate.status === 200 && emptyBody.leadCreated === true && emptyMail && emptyMail.reply_to == null && emptyBlob.includes(money(measured.hdzEstimate)) && emptyBlob.includes(money(measured.uhdzEstimate)) && !emptyBlob.includes('Master Elite') && !emptyBlob.includes('Book your free inspection') && !emptyBlob.includes('L.101285') && !emptyBlob.includes('1115371') && !emptyBlob.includes('<img') && !emptyLines.some((line) => String(line.url).includes('staticmap')));
} catch (err) {
  fail++;
  console.error('ERROR', err);
} finally {
  for (const server of servers) server.child.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
