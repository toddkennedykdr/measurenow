import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it } from 'node:test';
import { ThankYou } from '../src/components/ThankYou';
import type { FullQuoteData } from '../src/types';

const root = process.cwd();

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

const quote: FullQuoteData = {
  address: '123 Main St, Raleigh, NC',
  lat: 35.78,
  lng: -78.64,
  roofData: {
    totalAreaSqFt: 1,
    segments: 1,
    avgPitchDegrees: 1,
    imageryQuality: 'HIGH',
  },
  quote: {
    roofSquares: 1,
    totalAreaSqFt: 1,
    wasteFactor: 1,
    lowEstimate: 100,
    highEstimate: 200,
    avgPitchDegrees: 1,
    pitchCategory: 'test',
    pitchOver12: 1,
    materialNote: 'test',
  },
};

describe('public copy', () => {
  it('renders the marketing phone on the thank-you page', () => {
    const html = renderToStaticMarkup(createElement(ThankYou, {
      name: 'Ada Example',
      data: quote,
      onStartOver: () => {},
    }));
    assert.match(html, /href="tel:\+19199774074"/);
    assert.match(html, /Call K&amp;D Roofing: 919-977-4074/);
    assert.match(html, /K&amp;D Roofing/);
    assert.equal(html.includes('555'), false);
    assert.equal(html.toLowerCase().includes('pressure'), false);
  });

  it('does not leave the old placeholder number in the client', () => {
    const hits: string[] = [];
    for (const file of filesUnder(path.join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      if (text.includes('555-1234') || text.includes('19195551234') || text.includes('+1919555')) {
        hits.push(path.relative(root, file));
      }
    }
    assert.deepEqual(hits, []);
    const form = readFileSync(path.join(root, 'src/components/QuoteResult.tsx'), 'utf8');
    assert.match(form, /placeholder="Mobile number"/);
  });

  it('keeps the inspection tool behind the login route', () => {
    const main = readFileSync(path.join(root, 'src/main.tsx'), 'utf8');
    assert.match(
      main,
      /path="\/inspect" element=\{<RequireAuth><InspectPage \/><\/RequireAuth>\}/,
    );
    const nav = readFileSync(path.join(root, 'src/components/NavBar.tsx'), 'utf8');
    assert.equal(nav.includes('Inspection Tool'), false);
    assert.match(nav, /to="\/inspect"/);
  });
});
