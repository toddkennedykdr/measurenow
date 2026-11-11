/** Sites that may frame /quote. Extras from the environment are appended, never substituted. */
export const HARDCODED_EMBED_ORIGINS = [
  'https://kanddroofingnc.com',
  'https://www.kanddroofingnc.com',
] as const;

export const EMBED_ORIGINS_ELEMENT_ID = 'measurenow-embed-origins';

/**
 * Canonical https://host[:port], or null.
 * The host is lowercased and may contain only letters, digits, dots, and hyphens.
 * A label cannot be empty or start or end with a hyphen. The port, if present, is 1–65535.
 */
export function canonicalizeEmbedOrigin(value: string): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed.startsWith('https://')) return null;
  const rest = trimmed.slice('https://'.length);
  if (!rest || /[\s/?#@*]/.test(rest)) return null;
  const colon = rest.lastIndexOf(':');
  let host = rest;
  let port = '';
  if (colon !== -1) {
    host = rest.slice(0, colon);
    port = rest.slice(colon + 1);
    if (!/^[0-9]+$/.test(port) || (port.length > 1 && port.startsWith('0'))) return null;
    const portNumber = Number(port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) return null;
  }
  host = host.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  const labels = host.split('.');
  if (labels.some(label => label.length === 0 || label.startsWith('-') || label.endsWith('-'))) return null;
  return port ? `https://${host}:${port}` : `https://${host}`;
}

/** True only for an origin that is already in canonical form. */
export function isExactHttpsOrigin(value: string): boolean {
  return canonicalizeEmbedOrigin(value) === value;
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
    const canonical = canonicalizeEmbedOrigin(entry);
    if (canonical) extras.push(canonical);
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
