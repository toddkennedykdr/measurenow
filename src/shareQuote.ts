export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

export interface ShareEnv {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
  legacyCopy?: (text: string) => boolean;
}

export function buildSharePayload(input: {
  address: string;
  lowLabel: string;
  highLabel: string;
  detail?: string;
  pageUrl: string;
}): SharePayload {
  const lines = [
    'K&D Roofing',
    input.address.trim(),
    `${input.lowLabel} – ${input.highLabel}`,
  ];
  if (input.detail?.trim()) lines.push(input.detail.trim());
  return {
    title: 'K&D Roofing quote',
    text: lines.join('\n'),
    url: input.pageUrl,
  };
}

export function copyTextFor(payload: SharePayload): string {
  return `${payload.text}\n${payload.url}`;
}

export async function shareQuote(payload: SharePayload, env: ShareEnv): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof env.share === 'function') {
    try {
      await env.share({ title: payload.title, text: payload.text, url: payload.url });
      return 'shared';
    } catch (err) {
      const name = err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '';
      if (name === 'AbortError') return 'cancelled';
    }
  }

  const text = copyTextFor(payload);
  const write = env.clipboard?.writeText;
  if (typeof write === 'function') {
    try {
      await Promise.race([
        Promise.resolve(write.call(env.clipboard, text)),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1200)),
      ]);
      return 'copied';
    } catch {
      // The clipboard API can hang or refuse. Try the legacy copy next.
    }
  }
  if (env.legacyCopy?.(text)) return 'copied';
  throw new Error('Share is unavailable on this device.');
}
