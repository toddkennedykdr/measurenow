import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildSharePayload, copyTextFor, shareQuote } from '../src/shareQuote.ts';
import { conditionColor, severityColor } from '../src/statusColors.ts';

const payload = buildSharePayload({
  address: '123 Main St, Raleigh, NC',
  lowLabel: '$10,000',
  highLabel: '$12,000',
  detail: '2,000 sq ft · 20 squares · 6/12 pitch',
  pageUrl: 'https://example.com/reports/1',
});

test('share payload is the on-screen summary and page link only', () => {
  assert.deepEqual(Object.keys(payload).sort(), ['text', 'title', 'url']);
  assert.equal(payload.title, 'K&D Roofing quote');
  assert.match(payload.text, /K&D Roofing/);
  assert.match(payload.text, /123 Main St, Raleigh, NC/);
  assert.match(payload.text, /\$10,000 – \$12,000/);
  assert.match(payload.text, /2,000 sq ft/);
  assert.equal(payload.url, 'https://example.com/reports/1');
  assert.doesNotMatch(payload.text, /@/);
  assert.doesNotMatch(`${payload.text}\n${payload.url}`, /api[_-]?key|password|secret/i);
});

test('cancelling the share sheet does not copy', async () => {
  let copied = '';
  const result = await shareQuote(payload, {
    share: async () => {
      const err = new Error('cancel');
      err.name = 'AbortError';
      throw err;
    },
    clipboard: { writeText: async (text) => { copied = text; } },
  });
  assert.equal(result, 'cancelled');
  assert.equal(copied, '');
});

test('missing Web Share copies the summary and link', async () => {
  let copied = '';
  const result = await shareQuote(payload, {
    clipboard: { writeText: async (text) => { copied = text; } },
  });
  assert.equal(result, 'copied');
  assert.equal(copied, copyTextFor(payload));
  assert.match(copied, /https:\/\/example\.com\/reports\/1/);
});

test('a hanging clipboard uses the legacy copy', async () => {
  let legacy = '';
  const result = await shareQuote(payload, {
    clipboard: { writeText: () => new Promise(() => {}) },
    legacyCopy: (text) => {
      legacy = text;
      return true;
    },
  });
  assert.equal(result, 'copied');
  assert.equal(legacy, copyTextFor(payload));
});

test('a failed share falls back to copy', async () => {
  let copied = '';
  const result = await shareQuote(payload, {
    share: async () => { throw new Error('unsupported'); },
    clipboard: { writeText: async (text) => { copied = text; } },
  });
  assert.equal(result, 'copied');
  assert.match(copied, /K&D Roofing/);
});

function contrast(hexA: string, hexB: string): number {
  const lum = (hex: string) => {
    const ch = [0, 2, 4].map((i) => {
      const c = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const L1 = lum(hexA);
  const L2 = lum(hexB);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

test('condition colors meet WCAG AA for white badge text', () => {
  for (const color of [conditionColor('poor'), conditionColor('fair'), conditionColor('good'), severityColor('major'), severityColor('minor')]) {
    assert.ok(contrast('#ffffff', color) >= 4.5, color);
  }
});

test('buttons and inputs declare a 48px minimum', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  const btn = css.match(/\.btn \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const input = css.match(/\.input \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.match(btn, /min-height:\s*48px/);
  assert.match(input, /min-height:\s*48px/);
  assert.match(input, /font-size:\s*16px/);
});

test('the rep inspection address box is focused when that step shows', () => {
  const src = readFileSync(new URL('../src/pages/InspectPage.tsx', import.meta.url), 'utf8');
  assert.match(src, /addressRef\.current\?\.focus\(\)/);
  assert.match(src, /id="inspect-address"/);
});

test('customer phone copy uses the K&D Roofing number', () => {
  const src = readFileSync(new URL('../src/components/ThankYou.tsx', import.meta.url), 'utf8');
  assert.match(src, /tel:\+19199774074/);
  assert.match(src, /919-977-4074/);
  assert.match(src, /K&amp;D Roofing|K&D Roofing/);
  assert.doesNotMatch(src, /no pressure/i);
  assert.doesNotMatch(src, /555/);
});
