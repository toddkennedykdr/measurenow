import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { getTableColumns } from 'drizzle-orm';
import { JN_API_KEY_DUMMY } from '../test/allowed-literals';
import { websiteLeads } from './db/schema';
import {
  resetWebsiteLeadStoreForTests,
  setWebsiteLeadStoreForTests,
  type StoredWebsiteLead,
  type WebsiteLeadStore,
} from './db/websiteLeads';
import { applyWebsiteLeadSchema, WEBSITE_LEAD_DDL } from './db/websiteLeadSchema';
import { LEAD_RATE_LIMIT_MAX, LEAD_RATE_LIMIT_MESSAGE } from './leadRateLimit';
import {
  resetPublicDailyCapForTests,
  ROOF_PUBLIC_DAILY_CAP_ENV,
} from './publicDailyCap';
import { leadRouter } from './routes/lead';
import { roofRouter } from './routes/roof';
import {
  FORM_STARTED_AT_FIELD,
  HONEYPOT_FIELD,
  LEAD_SAVE_ERROR,
  MIN_SUBMIT_MS,
  resetSpamClockForTests,
  setSpamClockForTests,
  SPAM_HONEYPOT_MESSAGE,
  SPAM_RELOAD_MESSAGE,
  SPAM_TOO_FAST_MESSAGE,
} from './spamGuard';

const here = path.dirname(fileURLToPath(import.meta.url));
const NOW = 1_700_000_000_000;
const QUOTE_DETAIL = 'Please check the quote details and try again.';

const savedEnv = {
  jn: process.env.JN_API_KEY,
  alias: process.env.JOBNIMBUS_API_KEY,
  resend: process.env.RESEND_API_KEY,
  solar: process.env.GOOGLE_SOLAR_API_KEY,
  cap: process.env[ROOF_PUBLIC_DAILY_CAP_ENV],
};

type Call = { host: string; path: string; authorization: string | null; body: string };
const calls: Call[] = [];
const timeline: string[] = [];
let restoreFetch = () => {};
const consoleFns = {
  log: console.log,
  warn: console.warn,
  error: console.error,
};
let server: http.Server;
let base = '';
let octet = 20;

function nextIp(): string {
  octet += 1;
  return `203.0.113.${octet}`;
}

function memoryStore(events = timeline): { rows: StoredWebsiteLead[]; store: WebsiteLeadStore } {
  const rows: StoredWebsiteLead[] = [];
  return {
    rows,
    store: {
      async insert(lead) {
        events.push('save');
        const row: StoredWebsiteLead = {
          id: rows.length + 1,
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          address: lead.address,
          quoteLow: lead.quoteLow,
          quoteHigh: lead.quoteHigh,
          roofSqFt: lead.roofSqFt,
          roofSquares: lead.roofSquares,
          avgPitchDegrees: lead.avgPitchDegrees ?? null,
          pitchOver12: lead.pitchOver12 ?? null,
          createdAt: new Date(NOW).toISOString(),
        };
        rows.push(row);
        return { id: row.id };
      },
      async list() {
        return [...rows].reverse();
      },
    },
  };
}

function leadBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Pat Example',
    email: 'pat@example.com',
    phone: '919-555-0100',
    address: '123 Main St, Raleigh, NC 27601',
    quoteLow: 8000,
    quoteHigh: 12000,
    roofSqFt: 2400,
    roofSquares: 24,
    avgPitchDegrees: 20,
    pitchOver12: 4,
    [HONEYPOT_FIELD]: '',
    [FORM_STARTED_AT_FIELD]: NOW - 60_000,
    ...overrides,
  };
}

function installFetchMock() {
  const original = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return original(input, init);
    }
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({
      host: url.hostname,
      path: url.pathname,
      authorization: headers.get('authorization'),
      body,
    });
    timeline.push(url.hostname);
    if (url.hostname === 'app.jobnimbus.com') return Response.json({ id: 'test-contact' });
    if (url.hostname === 'api.resend.com') return Response.json({ id: 'test-email' });
    if (url.hostname === 'maps.googleapis.com' && url.pathname === '/maps/api/geocode/json') {
      return Response.json({
        status: 'OK',
        results: [{
          formatted_address: '123 Main St, Raleigh, NC 27601',
          geometry: { location: { lat: 35.78, lng: -78.64 } },
        }],
      });
    }
    if (url.hostname === 'solar.googleapis.com' && url.pathname === '/v1/buildingInsights:findClosest') {
      return Response.json({
        imageryQuality: 'HIGH',
        solarPotential: {
          roofSegmentStats: [{
            pitchDegrees: 20,
            azimuthDegrees: 180,
            stats: { areaMeters2: 100 },
          }],
        },
      });
    }
    throw new Error(`blocked outbound ${url.hostname}`);
  };
  return () => {
    globalThis.fetch = original;
  };
}

async function listen(app: express.Express): Promise<{ server: http.Server; base: string }> {
  const started = http.createServer(app);
  started.listen(0, '127.0.0.1');
  await once(started, 'listening');
  const address = started.address() as AddressInfo;
  return { server: started, base: `http://127.0.0.1:${address.port}` };
}

async function postLead(body: unknown, ip = nextIp()) {
  const res = await fetch(`${base}/api/lead/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) as { error?: string; success?: boolean } : {} };
}

describe('website leads and public spam checks', { concurrency: false }, () => {
  before(async () => {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    setSpamClockForTests(() => NOW);
    restoreFetch = installFetchMock();
    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    const app = express();
    app.set('trust proxy', 1);
    app.use(express.json());
    app.use('/api/lead', leadRouter);
    const started = await listen(app);
    server = started.server;
    base = started.base;
  });

  beforeEach(() => {
    calls.length = 0;
    timeline.length = 0;
    delete process.env.JN_API_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.JOBNIMBUS_API_KEY;
    setWebsiteLeadStoreForTests(memoryStore().store);
  });

  after(async () => {
    console.log = consoleFns.log;
    console.warn = consoleFns.warn;
    console.error = consoleFns.error;
    restoreFetch();
    resetSpamClockForTests();
    resetWebsiteLeadStoreForTests();
    resetPublicDailyCapForTests();
    if (savedEnv.jn === undefined) delete process.env.JN_API_KEY;
    else process.env.JN_API_KEY = savedEnv.jn;
    if (savedEnv.alias === undefined) delete process.env.JOBNIMBUS_API_KEY;
    else process.env.JOBNIMBUS_API_KEY = savedEnv.alias;
    if (savedEnv.resend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedEnv.resend;
    if (savedEnv.solar === undefined) delete process.env.GOOGLE_SOLAR_API_KEY;
    else process.env.GOOGLE_SOLAR_API_KEY = savedEnv.solar;
    if (savedEnv.cap === undefined) delete process.env[ROOF_PUBLIC_DAILY_CAP_ENV];
    else process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = savedEnv.cap;
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  test('website lead schema is additive and safe to run twice', async () => {
    const seen: string[] = [];
    const query = async (sql: string) => {
      seen.push(sql);
    };
    await applyWebsiteLeadSchema(query);
    await applyWebsiteLeadSchema(query);
    assert.equal(seen.length, WEBSITE_LEAD_DDL.length * 2);
    assert.deepEqual(seen.slice(0, WEBSITE_LEAD_DDL.length), [...WEBSITE_LEAD_DDL]);
    assert.deepEqual(seen.slice(0, WEBSITE_LEAD_DDL.length), seen.slice(WEBSITE_LEAD_DDL.length));
    const joined = seen.join('\n');
    assert.match(joined, /CREATE TABLE IF NOT EXISTS website_leads/);
    for (const sql of seen) {
      assert.match(sql, /IF NOT EXISTS/);
      assert.equal(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/i.test(sql), false);
    }
    for (const column of Object.values(getTableColumns(websiteLeads))) {
      assert.match(joined, new RegExp(`\\b${column.name}\\b`));
    }
    const dbIndex = readFileSync(path.join(here, 'db/index.ts'), 'utf8');
    assert.match(dbIndex, /applyWebsiteLeadSchema/);
  });

  test('public forms use the same honeypot and timer field names', () => {
    const client = readFileSync(path.join(here, '../src/publicFormGuard.ts'), 'utf8');
    assert.match(client, new RegExp(`HONEYPOT_FIELD = '${HONEYPOT_FIELD}'`));
    assert.match(client, new RegExp(`FORM_STARTED_AT_FIELD = '${FORM_STARTED_AT_FIELD}'`));
    for (const rel of [
      '../src/components/AddressForm.tsx',
      '../src/components/QuoteResult.tsx',
      '../src/components/ConfirmAddress.tsx',
      '../src/pages/InspectPage.tsx',
    ]) {
      const src = readFileSync(path.join(here, rel), 'utf8');
      assert.match(src, /HoneypotField/);
      assert.match(src, /usePublicFormGuard/);
    }
    const app = readFileSync(path.join(here, '../src/App.tsx'), 'utf8');
    assert.match(app, /\.\.\.extras/);
    const css = readFileSync(path.join(here, '../src/styles.css'), 'utf8');
    assert.match(css, /\.hp-field\s*\{[^}]*left:\s*-10000px/s);
    assert.equal(/\.hp-field\s*\{[^}]*display\s*:\s*none/s.test(css), false);
    for (const rel of ['spamGuard.ts', 'leadRateLimit.ts']) {
      const src = readFileSync(path.join(here, rel), 'utf8');
      assert.equal(/no pressure/i.test(src), false);
      assert.match(src, /K&D Roofing/);
      assert.match(src, /919-977-4074/);
      assert.equal(src.includes('555'), false);
    }
  });

  test('forwarded addresses are trusted for one proxy hop only', async () => {
    const indexSrc = readFileSync(path.join(here, 'index.ts'), 'utf8');
    assert.match(indexSrc, /app\.set\('trust proxy', 1\)/);
    assert.equal(/trust proxy',\s*true/.test(indexSrc), false);
    const limiter = readFileSync(path.join(here, 'leadRateLimit.ts'), 'utf8');
    assert.match(limiter, /return req\.ip \|\| 'unknown'/);
    assert.match(limiter, /keyGenerator: \(req\) => clientIp\(req\)/);
    const roof = readFileSync(path.join(here, 'middleware/roofAccess.ts'), 'utf8');
    const roofKey = roof.slice(roof.indexOf('keyGenerator'));
    assert.match(roofKey, /return req\.ip \|\| 'unknown'/);
    assert.equal(/x-forwarded-for/i.test(roofKey), false);

    const open = express();
    open.get('/who', (req, res) => res.json({ ip: req.ip }));
    const untrusted = await listen(open);
    try {
      const res = await fetch(`${untrusted.base}/who`, {
        headers: { 'x-forwarded-for': '203.0.113.50' },
      });
      assert.equal((await res.json() as { ip: string }).ip, '127.0.0.1');
    } finally {
      await new Promise<void>((resolve, reject) => {
        untrusted.server.close((err) => (err ? reject(err) : resolve()));
      });
    }

    const trustedApp = express();
    trustedApp.set('trust proxy', 1);
    trustedApp.get('/who', (req, res) => res.json({ ip: req.ip }));
    const trusted = await listen(trustedApp);
    try {
      const res = await fetch(`${trusted.base}/who`, {
        headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.50' },
      });
      assert.equal((await res.json() as { ip: string }).ip, '203.0.113.50');
    } finally {
      await new Promise<void>((resolve, reject) => {
        trusted.server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  test('capture rejects honeypot, fast, stale, and invalid leads before delivery', async () => {
    const honeypot = await postLead(leadBody({ [HONEYPOT_FIELD]: 'http://spam.example' }));
    assert.equal(honeypot.status, 400);
    assert.equal(honeypot.json.error, SPAM_HONEYPOT_MESSAGE);

    const blankFilled = await postLead(leadBody({ [HONEYPOT_FIELD]: '  ' }));
    assert.equal(blankFilled.status, 400);
    assert.equal(blankFilled.json.error, SPAM_HONEYPOT_MESSAGE);

    const tooFast = await postLead(leadBody({ [FORM_STARTED_AT_FIELD]: NOW - (MIN_SUBMIT_MS - 1) }));
    assert.equal(tooFast.status, 400);
    assert.equal(tooFast.json.error, SPAM_TOO_FAST_MESSAGE);

    const missingClock = await postLead(leadBody({ [FORM_STARTED_AT_FIELD]: undefined }));
    assert.equal(missingClock.status, 400);
    assert.equal(missingClock.json.error, SPAM_RELOAD_MESSAGE);

    const stale = await postLead(leadBody({ [FORM_STARTED_AT_FIELD]: NOW - (24 * 60 * 60 * 1000) - 1 }));
    assert.equal(stale.status, 400);
    assert.equal(stale.json.error, SPAM_RELOAD_MESSAGE);

    const future = await postLead(leadBody({ [FORM_STARTED_AT_FIELD]: NOW + 60_000 }));
    assert.equal(future.status, 400);
    assert.equal(future.json.error, SPAM_RELOAD_MESSAGE);

    const longName = await postLead(leadBody({ name: 'A'.repeat(101) }));
    assert.equal(longName.status, 400);
    assert.equal(longName.json.error, 'Please enter a shorter name.');

    const badEmail = await postLead(leadBody({ email: 'not-an-email' }));
    assert.equal(badEmail.status, 400);
    assert.equal(badEmail.json.error, 'Please enter a valid email.');

    const lowHigh = await postLead(leadBody({ quoteLow: 5000, quoteHigh: 1000 }));
    assert.equal(lowHigh.status, 400);
    assert.equal(lowHigh.json.error, QUOTE_DETAIL);

    assert.deepEqual(timeline, []);
    assert.deepEqual(calls, []);
  });

  test('a slow empty honeypot is stored before JobNimbus and email run', async () => {
    process.env.JN_API_KEY = JN_API_KEY_DUMMY;
    process.env.RESEND_API_KEY = JN_API_KEY_DUMMY;
    const ready = await postLead(leadBody({ [FORM_STARTED_AT_FIELD]: NOW - MIN_SUBMIT_MS }));
    assert.equal(ready.status, 200);
    assert.equal(ready.json.success, true);
    assert.deepEqual(timeline, ['save', 'api.resend.com', 'app.jobnimbus.com']);

    const jn = calls.find((call) => call.host === 'app.jobnimbus.com');
    assert.ok(jn);
    assert.equal(jn.path, '/api1/contacts');
    assert.equal(jn.authorization, `Bearer ${JN_API_KEY_DUMMY}`);
    const contact = JSON.parse(jn.body) as Record<string, string>;
    assert.equal(contact.first_name, 'Pat');
    assert.equal(contact.last_name, 'Example');
    assert.equal(contact.email, 'pat@example.com');
    assert.equal(contact.home_phone, '919-555-0100');
    assert.equal(contact.address_line1, '123 Main St');
    assert.equal(contact.city, 'Raleigh');
    assert.equal(contact.state_text, 'NC');
    assert.equal(contact.zip, '27601');
    assert.equal(contact.source_name, 'MeasureNow');
    assert.match(contact.description, /MeasureNow Quote:/);
    assert.equal(Object.hasOwn(contact, HONEYPOT_FIELD), false);

    const email = calls.find((call) => call.host === 'api.resend.com');
    assert.ok(email);
    assert.equal(email.body.includes(HONEYPOT_FIELD), false);
    assert.equal(email.body.includes('spam.example'), false);
  });

  test('a failed save does not call JobNimbus', async () => {
    process.env.JN_API_KEY = JN_API_KEY_DUMMY;
    process.env.RESEND_API_KEY = JN_API_KEY_DUMMY;
    setWebsiteLeadStoreForTests({
      async insert() {
        timeline.push('save');
        throw new Error('db down');
      },
      async list() {
        return [];
      },
    });
    const failed = await postLead(leadBody());
    assert.equal(failed.status, 500);
    assert.equal(failed.json.error, LEAD_SAVE_ERROR);
    assert.deepEqual(timeline, ['save']);
    assert.deepEqual(calls, []);
  });

  test('list reads the stored rows, newest first', async () => {
    const mem = memoryStore();
    setWebsiteLeadStoreForTests(mem.store);
    const first = await postLead(leadBody({ name: 'Pat Example' }));
    const second = await postLead(leadBody({ name: 'Sam Example', email: 'sam@example.com' }));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const res = await fetch(`${base}/api/lead/list`);
    const body = await res.json() as { count: number; leads: Array<{ name: string; id: number }> };
    assert.equal(res.status, 200);
    assert.equal(body.count, 2);
    assert.deepEqual(body.leads.map((lead) => lead.name), ['Sam Example', 'Pat Example']);
    assert.deepEqual(mem.rows.map((lead) => lead.id), [1, 2]);
  });

  test('lead capture is limited per real client IP, not a spoofed forwarded hop', async () => {
    const mem = memoryStore();
    setWebsiteLeadStoreForTests(mem.store);
    const real = '203.0.113.50';
    for (let n = 0; n < LEAD_RATE_LIMIT_MAX; n++) {
      const ok = await postLead(leadBody({ email: `pat${n}@example.com` }), `198.51.100.${n}, ${real}`);
      assert.equal(ok.status, 200, `submit ${n}`);
    }
    assert.equal(mem.rows.length, LEAD_RATE_LIMIT_MAX);
    const blocked = await postLead(leadBody({ email: 'blocked@example.com' }), `203.0.113.99, ${real}`);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error, LEAD_RATE_LIMIT_MESSAGE);
    assert.equal(mem.rows.length, LEAD_RATE_LIMIT_MAX);
    assert.equal(blocked.json.error.includes('K&D Roofing'), true);
    assert.equal(blocked.json.error.includes('919-977-4074'), true);

    const other = await postLead(leadBody({ email: 'other@example.com' }), '203.0.113.99, 203.0.113.60');
    assert.equal(other.status, 200);
    assert.equal(mem.rows.length, LEAD_RATE_LIMIT_MAX + 1);
  });

  test('public geocode and quote reject spam before Google and before the daily cap', async () => {
    process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = '1';
    process.env.GOOGLE_SOLAR_API_KEY = JN_API_KEY_DUMMY;
    resetPublicDailyCapForTests();
    const app = express();
    app.use(express.json());
    app.use('/api/roof', roofRouter);
    const quoteServer = await listen(app);
    const post = async (pathName: string, body: unknown) => {
      const res = await fetch(`${quoteServer.base}${pathName}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, json: JSON.parse(text) as { error?: string; address?: string } };
    };
    try {
      const honeypot = await post('/api/roof/geocode', {
        address: '123 Main St, Raleigh, NC',
        [HONEYPOT_FIELD]: 'http://spam.example',
        [FORM_STARTED_AT_FIELD]: NOW - 60_000,
      });
      assert.equal(honeypot.status, 400);
      assert.equal(honeypot.json.error, SPAM_HONEYPOT_MESSAGE);

      const tooFast = await post('/api/roof/quote', {
        lat: 35.78,
        lng: -78.64,
        [FORM_STARTED_AT_FIELD]: NOW - 500,
      });
      assert.equal(tooFast.status, 400);
      assert.equal(tooFast.json.error, SPAM_TOO_FAST_MESSAGE);

      const longAddress = await post('/api/roof/geocode', {
        address: 'A'.repeat(301),
        [FORM_STARTED_AT_FIELD]: NOW - 60_000,
      });
      assert.equal(longAddress.status, 400);
      assert.equal(longAddress.json.error, 'Please enter a shorter address.');

      const badCoord = await post('/api/roof/quote', {
        lat: 91,
        lng: -78.64,
        [FORM_STARTED_AT_FIELD]: NOW - 60_000,
      });
      assert.equal(badCoord.status, 400);
      assert.equal(badCoord.json.error, 'Invalid coordinates.');
      assert.deepEqual(calls.filter((call) => call.host.endsWith('googleapis.com')), []);

      const geocode = await post('/api/roof/geocode', {
        address: '123 Main St, Raleigh, NC',
        [FORM_STARTED_AT_FIELD]: NOW - 60_000,
      });
      assert.equal(geocode.status, 200);
      assert.equal(geocode.json.address, '123 Main St, Raleigh, NC 27601');

      const capped = await post('/api/roof/quote', {
        lat: 35.78,
        lng: -78.64,
        [FORM_STARTED_AT_FIELD]: NOW - 60_000,
      });
      assert.equal(capped.status, 503);
      assert.match(capped.json.error || '', /K&D Roofing at 919-977-4074/);
      const googleCalls = calls.filter((call) => call.host.endsWith('googleapis.com'));
      assert.equal(googleCalls.length, 1);
      assert.equal(googleCalls[0].host, 'maps.googleapis.com');
    } finally {
      resetPublicDailyCapForTests();
      if (savedEnv.cap === undefined) delete process.env[ROOF_PUBLIC_DAILY_CAP_ENV];
      else process.env[ROOF_PUBLIC_DAILY_CAP_ENV] = savedEnv.cap;
      await new Promise<void>((resolve, reject) => {
        quoteServer.server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
});
