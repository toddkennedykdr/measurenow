import type { Request } from 'express';
import rateLimit from 'express-rate-limit';

export const LEAD_RATE_LIMIT_MAX = 5;
export const LEAD_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export const LEAD_RATE_LIMIT_MESSAGE =
  'Too many submissions from this network. Please wait a few minutes and try again, or call K&D Roofing at 919-977-4074.';

const TRUSTED_PROXY_HOPS = 1;

/**
 * The lead limiter uses X-Forwarded-For only when the TCP peer is loopback
 * or a private address: that peer is the one expected proxy hop. The key is
 * then the last forwarded address (the hop the proxy appended). Earlier
 * entries are ignored. A public socket address is the key itself, so a
 * direct client cannot mint buckets by changing the header.
 * IPv4 keys are the full address. IPv6 keys are the /64.
 * This assumes the platform proxy is the only private peer that can connect.
 */
export function forwardedForEntries(header: string | string[] | undefined): string[] {
  if (!header) return [];
  const raw = Array.isArray(header) ? header.join(',') : header;
  return raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseIpv4(token: string): string | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(token);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part > 255)) return null;
  return parts.join('.');
}

function expandIpv6(token: string): number[] | null {
  const halves = token.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const groups = side.split(':');
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const left = parseSide(halves[0]);
  if (!left) return null;
  if (halves.length === 1) return left.length === 8 ? left : null;
  const right = parseSide(halves[1]);
  if (!right) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function normalizeAddress(address: string): string {
  let token = address.trim().toLowerCase();
  if (token.startsWith('[') && token.endsWith(']')) token = token.slice(1, -1);
  const zone = token.indexOf('%');
  if (zone !== -1) token = token.slice(0, zone);
  const v4Port = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(token);
  if (v4Port) token = v4Port[1];
  return token;
}

function splitAddress(address: string): { v4: string | null; v6: number[] | null } {
  const token = normalizeAddress(address);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(token);
  if (mapped) return { v4: parseIpv4(mapped[1]), v6: null };
  const v4 = parseIpv4(token);
  if (v4) return { v4, v6: null };
  return { v4: null, v6: expandIpv6(token) };
}

function isPrivateOrLoopbackV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export function isExpectedProxyPeer(address: string): boolean {
  const parsed = splitAddress(address);
  if (parsed.v4) return isPrivateOrLoopbackV4(parsed.v4);
  if (!parsed.v6) return false;
  const [first] = parsed.v6;
  const rest = parsed.v6.slice(1);
  if (first === 0 && rest.slice(0, 6).every((part) => part === 0) && rest[6] === 1) return true;
  if (first >= 0xfc00 && first <= 0xfdff) return true;
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  return false;
}

/** Full IPv4 address, or the IPv6 /64. Unparseable values stay as their own key. */
export function rateLimitAddressKey(address: string): string {
  const parsed = splitAddress(address);
  if (parsed.v4) return parsed.v4;
  if (parsed.v6) {
    return `${parsed.v6.slice(0, 4).map((part) => part.toString(16)).join(':')}::/64`;
  }
  const token = normalizeAddress(address);
  return token || 'unknown';
}

export function clientIp(req: Request): string {
  const socket = req.socket?.remoteAddress || '';
  const forwarded = forwardedForEntries(req.headers['x-forwarded-for']);
  if (isExpectedProxyPeer(socket) && forwarded.length >= TRUSTED_PROXY_HOPS) {
    return rateLimitAddressKey(forwarded[forwarded.length - 1]);
  }
  return rateLimitAddressKey(socket || 'unknown');
}

/** Public lead capture only. Quote routes keep the existing roof limiter. */
export const leadCaptureRateLimit = rateLimit({
  windowMs: LEAD_RATE_LIMIT_WINDOW_MS,
  max: LEAD_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  message: { error: LEAD_RATE_LIMIT_MESSAGE },
  keyGenerator: (req) => clientIp(req),
  // Honeypot and validation failures are rejected before this middleware.
  // A failed delivery must not consume a slot either. The 429 itself stays counted.
  skipFailedRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode < 400 || res.statusCode === 429,
});
