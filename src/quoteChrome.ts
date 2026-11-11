import { HARDCODED_EMBED_ORIGINS, readEmbedParentOrigins } from '../server/embedOrigins';

/** Public call link on the quote result. Change the number here only. */
export const KD_CALL = {
  href: 'tel:+19199774074',
  label: 'Call K&D Roofing: (919) 977-4074',
} as const;

export const QUOTE_DISCLAIMER =
  'This is a budget estimate, not a bid or quote. Final pricing is confirmed after an on-site inspection.';

export const LEAD_SUBMITTED_MESSAGE = { type: 'measurenow:lead-submitted' } as const;

/** Hardcoded parents. A preview host may append to this list at runtime. Never '*'. */
export const LEAD_PARENT_ORIGINS = HARDCODED_EMBED_ORIGINS;

function parentTargets(): readonly string[] {
  return readEmbedParentOrigins();
}

export function isEmbedSearch(search: string): boolean {
  const query = search.startsWith('?') ? search.slice(1) : search;
  return new URLSearchParams(query).get('embed') === '1';
}

/** True when this window is inside another window. A cross-origin parent throws, which still means framed. */
export function isFramedWindow(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

export function quotePageChrome(input: {
  pathname: string;
  search: string;
  framed: boolean;
  loggedIn: boolean;
}): { hideHeader: boolean; hideStaffLinks: boolean } {
  const onQuote = input.pathname === '/quote';
  const embedded = onQuote && (isEmbedSearch(input.search) || input.framed);
  return {
    hideHeader: embedded,
    hideStaffLinks: onQuote && (embedded || !input.loggedIn),
  };
}

/** After a successful lead capture, tell a framing parent. No-op when this page is top-level. */
export function notifyParentLeadSubmitted(): void {
  if (!isFramedWindow()) return;
  for (const origin of parentTargets()) {
    window.parent.postMessage(LEAD_SUBMITTED_MESSAGE, origin);
  }
}

export const HEIGHT_MESSAGE_TYPE = 'measurenow:height' as const;

/** Tell a framing parent how tall this document is. No-op when this page is top-level. */
export function notifyParentHeight(height: number): void {
  if (!isFramedWindow()) return;
  const message = { type: HEIGHT_MESSAGE_TYPE, height };
  for (const origin of parentTargets()) {
    window.parent.postMessage(message, origin);
  }
}
