export interface SharePayload {
  title: string;
  text: string;
  url: string;
}

export interface ShareEnv {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
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

  const write = env.clipboard?.writeText;
  if (typeof write !== 'function') {
    throw new Error('Share is unavailable on this device.');
  }
  await write.call(env.clipboard, copyTextFor(payload));
  return 'copied';
}
