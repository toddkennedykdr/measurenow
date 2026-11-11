/** Sites that may frame /quote. Extras from the environment are appended, never substituted. */
export const HARDCODED_EMBED_ORIGINS = [
  'https://kanddroofingnc.com',
  'https://www.kanddroofingnc.com',
] as const;

export const EMBED_ORIGINS_ELEMENT_ID = 'measurenow-embed-origins';

/** An origin is https, a host, and an optional port. Nothing else. */
export function isExactHttpsOrigin(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0 || /[\s*]/.test(value)) return false;
  if (!value.startsWith('https://')) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;
  if (url.pathname !== '/') return false;
  if (!url.hostname || url.hostname.includes('*')) return false;
  return value === url.origin;
}

export function embedOriginWarning(invalidCount: number): string {
  const noun = invalidCount === 1 ? 'entry' : 'entries';
  return `EMBED_PARENT_ORIGINS: ignored ${invalidCount} invalid ${noun}`;
}

export function mergeEmbedOrigins(candidates: readonly string[]): string[] {
  const origins: string[] = [...HARDCODED_EMBED_ORIGINS];
  for (const candidate of candidates) {
    if (isExactHttpsOrigin(candidate) && !origins.includes(candidate)) origins.push(candidate);
  }
  return origins;
}

/** Blank means the hardcoded list. Invalid entries are counted, not printed. */
export function parseEmbedParentOrigins(
  raw: string | undefined | null,
  warn: (message: string) => void = () => {},
): string[] {
  if (raw == null || raw.trim() === '') return [...HARDCODED_EMBED_ORIGINS];
  const extras: string[] = [];
  let invalid = 0;
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    if (isExactHttpsOrigin(entry)) extras.push(entry);
    else invalid += 1;
  }
  if (invalid > 0) warn(embedOriginWarning(invalid));
  return mergeEmbedOrigins(extras);
}

/** JSON for a non-executable script tag. <, >, &, and line separators cannot break out. */
export function htmlSafeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function embedOriginsScript(origins: readonly string[]): string {
  return `<script type="application/json" id="${EMBED_ORIGINS_ELEMENT_ID}">${htmlSafeJson(origins)}</script>`;
}

type OriginListNode = { getElementById(id: string): { textContent: string | null } | null };

export function readEmbedParentOrigins(from?: OriginListNode): string[] {
  try {
    const browserDocument = (globalThis as { document?: OriginListNode }).document;
    const root = from ?? browserDocument;
    if (!root) return [...HARDCODED_EMBED_ORIGINS];
    const el = root.getElementById(EMBED_ORIGINS_ELEMENT_ID);
    if (!el || !el.textContent) return [...HARDCODED_EMBED_ORIGINS];
    const parsed: unknown = JSON.parse(el.textContent);
    if (!Array.isArray(parsed)) return [...HARDCODED_EMBED_ORIGINS];
    const valid = parsed.filter((item): item is string => typeof item === 'string' && isExactHttpsOrigin(item));
    return mergeEmbedOrigins(valid);
  } catch {
    return [...HARDCODED_EMBED_ORIGINS];
  }
}
