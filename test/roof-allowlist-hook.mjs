import { isRealScanner, patchedScannerUrl } from './roof-allowlist-patch.mjs';

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const url = resolved.url?.split('?')[0] ?? '';
  if (!isRealScanner(url)) return resolved;
  return { ...resolved, url: patchedScannerUrl(url), format: undefined };
}
