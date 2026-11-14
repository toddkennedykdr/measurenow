import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import type { RoofQuote } from './pricing';

/** How long a gated quote can be re-opened without sending another lead. */
export const ACCESS_TTL_MS = 30 * 60 * 1000;

export type StoredRoof = {
  totalAreaSqFt: number;
  segments: number;
  avgPitchDegrees: number;
  imageryQuality: string;
  footprintSqFt: number;
  estimatedPerimeterFt: number;
  estimatedLength: number;
  estimatedWidth: number;
};

export type ContactInput = {
  name: string;
  email: string;
  phone: string;
  address: string;
};

/** Same shape QuoteResult used to POST to /api/lead/capture. */
export type LeadPayload = {
  name: string;
  email: string;
  phone: string;
  address: string;
  quoteLow: number;
  quoteHigh: number;
  roofSqFt: number;
  roofSquares: number;
  avgPitchDegrees: number;
  pitchOver12: number;
};

type Session = {
  id: string;
  createdAt: number;
  expiresAt: number;
  lat: number;
  lng: number;
  quote: RoofQuote;
  roof: StoredRoof;
  address: string | null;
  leadSent: boolean;
  fingerprint: string | null;
};

const sessions = new Map<string, Session>();
const byFingerprint = new Map<string, string>();
const tails = new Map<string, Promise<unknown>>();

let bootSecret: string | null = null;

function secret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  if (!bootSecret) bootSecret = randomBytes(32).toString('hex');
  return bootSecret;
}

/** 10-digit US number. Accepts a leading country code 1 and common punctuation. */
export function usPhoneDigits(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(national)) return null;
  return national;
}

export function leadFingerprint(contact: ContactInput, lat: number, lng: number): string {
  const email = contact.email.trim().toLowerCase();
  const phone = usPhoneDigits(contact.phone) || '';
  const address = contact.address.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${email}|${phone}|${address}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
}

function sweep(now = Date.now()) {
  for (const [id, session] of sessions) {
    if (session.expiresAt > now) continue;
    sessions.delete(id);
    if (session.fingerprint && byFingerprint.get(session.fingerprint) === id) {
      byFingerprint.delete(session.fingerprint);
    }
  }
}

export function createQuoteSession(input: {
  lat: number;
  lng: number;
  quote: RoofQuote;
  roof: StoredRoof;
}): Session {
  sweep();
  const now = Date.now();
  const session: Session = {
    id: randomBytes(16).toString('base64url'),
    createdAt: now,
    expiresAt: now + ACCESS_TTL_MS,
    lat: input.lat,
    lng: input.lng,
    quote: input.quote,
    roof: input.roof,
    address: null,
    leadSent: false,
    fingerprint: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function getQuoteSession(id: string): Session | null {
  sweep();
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) return null;
  return session;
}

export function findSentSession(fingerprint: string): Session | null {
  sweep();
  const id = byFingerprint.get(fingerprint);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || !session.leadSent || session.expiresAt <= Date.now()) return null;
  return session;
}

function rememberLead(session: Session, contact: ContactInput, fingerprint: string, claimFingerprint: boolean) {
  session.leadSent = true;
  session.address = contact.address.trim();
  session.fingerprint = fingerprint;
  session.expiresAt = Date.now() + ACCESS_TTL_MS;
  if (claimFingerprint) byFingerprint.set(fingerprint, session.id);
}

/** Run fn after any in-flight work for this key. Serializes double-submits. */
export function enqueue<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  tails.set(key, run.then(() => undefined, () => undefined));
  return run;
}

/**
 * Fields the quote page used to send from the browser once the prices were already visible.
 * Built here so the browser never has those numbers before the lead is accepted.
 */
export function toLeadPayload(session: Session, contact: ContactInput): LeadPayload {
  return {
    name: contact.name.trim(),
    email: contact.email.trim(),
    phone: contact.phone.trim(),
    address: contact.address.trim(),
    quoteLow: session.quote.hdzEstimate,
    quoteHigh: session.quote.uhdzEstimate,
    roofSqFt: session.roof.totalAreaSqFt,
    roofSquares: session.quote.roofSquares,
    avgPitchDegrees: session.quote.avgPitchDegrees,
    pitchOver12: session.quote.pitchOver12,
  };
}

/** Pre-gate body: progress only. No package prices and no total/price/cost/amount keys. */
export function progressBody(session: Session) {
  return {
    quoteId: session.id,
    lat: session.lat,
    lng: session.lng,
    roofData: {
      segments: session.roof.segments,
      avgPitchDegrees: session.roof.avgPitchDegrees,
      imageryQuality: session.roof.imageryQuality,
      footprintSqFt: session.roof.footprintSqFt,
      estimatedPerimeterFt: session.roof.estimatedPerimeterFt,
      estimatedLength: session.roof.estimatedLength,
      estimatedWidth: session.roof.estimatedWidth,
    },
    quote: {
      roofSquares: session.quote.roofSquares,
      avgPitchDegrees: session.quote.avgPitchDegrees,
      pitchOver12: session.quote.pitchOver12,
      pitchCategory: session.quote.pitchCategory,
    },
  };
}

/** Post-gate body. Same quote object the public quote route used to return. */
export function pricedBody(session: Session) {
  return {
    address: session.address || '',
    lat: session.lat,
    lng: session.lng,
    roofData: {
      totalAreaSqFt: session.roof.totalAreaSqFt,
      segments: session.roof.segments,
      avgPitchDegrees: session.roof.avgPitchDegrees,
      imageryQuality: session.roof.imageryQuality,
      footprintSqFt: session.roof.footprintSqFt,
      estimatedPerimeterFt: session.roof.estimatedPerimeterFt,
      estimatedLength: session.roof.estimatedLength,
      estimatedWidth: session.roof.estimatedWidth,
    },
    quote: session.quote,
  };
}

export function signQuoteToken(id: string, exp = Date.now() + ACCESS_TTL_MS): string {
  const body = Buffer.from(JSON.stringify({ v: 1, id, exp })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyQuoteToken(token: unknown): { id: string; exp: number } | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot !== token.lastIndexOf('.')) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: { v?: unknown; id?: unknown; exp?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== 1 || typeof parsed.id !== 'string' || typeof parsed.exp !== 'number') return null;
  if (!Number.isFinite(parsed.exp) || parsed.exp <= Date.now()) return null;
  return { id: parsed.id, exp: parsed.exp };
}

/**
 * Calls the existing public lead route. Does not build a JobNimbus or email request itself.
 */
export async function postExistingLead(payload: LeadPayload, req: Request): Promise<{ status: number; body: { error?: string; success?: boolean } }> {
  const port = process.env.PORT || '3001';
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': req.ip || '127.0.0.1',
  };
  const cookie = req.get('cookie');
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`http://127.0.0.1:${port}/api/lead/capture`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({})) as { error?: string; success?: boolean };
  return { status: res.status, body };
}

export type GateResult =
  | { ok: true; leadCreated: boolean; token: string; body: ReturnType<typeof pricedBody> }
  | { ok: false; status: number; error: string };

/**
 * Send the lead through /api/lead/capture the first time this quote session, or this
 * contact + roof, is submitted. Later submits and token refreshes reuse the session.
 */
export async function openQuoteForContact(session: Session, contact: ContactInput, req: Request): Promise<GateResult> {
  const fingerprint = leadFingerprint(contact, session.lat, session.lng);
  return enqueue(`quote:${session.id}`, () => enqueue(`lead:${fingerprint}`, async () => {
    const current = getQuoteSession(session.id);
    if (!current) return { ok: false as const, status: 400, error: 'Please confirm your address again.' };

    if (current.leadSent && current.address) {
      const token = signQuoteToken(current.id, current.expiresAt);
      return { ok: true as const, leadCreated: false, token, body: pricedBody(current) };
    }

    const prior = findSentSession(fingerprint);
    if (prior) {
      rememberLead(current, contact, fingerprint, false);
      const token = signQuoteToken(current.id, current.expiresAt);
      return { ok: true as const, leadCreated: false, token, body: pricedBody(current) };
    }

    const payload = toLeadPayload(current, contact);
    let captured: { status: number; body: { error?: string; success?: boolean } };
    try {
      captured = await postExistingLead(payload, req);
    } catch {
      return { ok: false as const, status: 502, error: 'Failed to save your information. Please call us directly.' };
    }
    if (captured.status !== 200 || !captured.body?.success) {
      const status = captured.status >= 400 ? captured.status : 502;
      return {
        ok: false as const,
        status,
        error: captured.body?.error || 'Failed to save your information. Please call us directly.',
      };
    }

    rememberLead(current, contact, fingerprint, true);
    const token = signQuoteToken(current.id, current.expiresAt);
    return { ok: true as const, leadCreated: true, token, body: pricedBody(current) };
  }));
}
