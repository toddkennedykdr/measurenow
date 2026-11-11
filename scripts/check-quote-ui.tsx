// Renders the public quote page (no browser, no network, no lead POST).
import React, { type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext';
import App from '../src/App';
import { NavBar } from '../src/components/NavBar';
import { QuoteResult } from '../src/components/QuoteResult';
import type { FullQuoteData } from '../src/types';
import {
  KD_CALL,
  QUOTE_DISCLAIMER,
  LEAD_SUBMITTED_MESSAGE,
  LEAD_PARENT_ORIGINS,
  isFramedWindow,
  notifyParentLeadSubmitted,
  quotePageChrome,
} from '../src/quoteChrome';
import { calculateQuote, HDZ_PRICE_PER_SQUARE, UHDZ_PRICE_PER_SQUARE, UHDZ_UPGRADE_PER_SQUARE } from '../server/services/pricing';
import type { BuildingRoofData } from '../server/services/solar';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

function render(entry: string, node: ReactNode) {
  return renderToString(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>{node}</AuthProvider>
    </MemoryRouter>,
  );
}

const TAGLINE = 'Serving North Carolina since 2018';
const unframed = render('/quote', <App />);
const embed = render('/quote?embed=1', <App />);
const home = render('/', <NavBar />);
const inspect = render('/inspect', <NavBar />);

check('unframed /quote has the header', unframed.includes(TAGLINE));
check('unframed /quote hides Inspection Tool', !unframed.includes('Inspection Tool'));
check('unframed /quote hides Login', !unframed.includes('>Login<'));
check('embed /quote hides the header', !embed.includes(TAGLINE) && !embed.includes('class="header"'));
check('embed /quote hides Inspection Tool', !embed.includes('Inspection Tool'));
check('embed /quote hides Login', !embed.includes('>Login<'));
check('home nav still has Inspection Tool', home.includes('Inspection Tool'));
check('home nav still has Login', home.includes('>Login<'));
check('inspect nav still has Inspection Tool', inspect.includes('Inspection Tool'));

const previousWindow = (globalThis as unknown as { window?: unknown }).window;
const framedSelf = {};
(globalThis as unknown as { window: unknown }).window = { self: framedSelf, top: {}, parent: framedSelf };
let framedHtml = '';
try {
  framedHtml = render('/quote', <App />);
} finally {
  if (previousWindow === undefined) delete (globalThis as unknown as { window?: unknown }).window;
  else (globalThis as unknown as { window?: unknown }).window = previousWindow;
}
check('framed /quote hides the header', framedHtml.length > 0 && !framedHtml.includes(TAGLINE) && !framedHtml.includes('class="header"'));
check('framed /quote hides Inspection Tool', !framedHtml.includes('Inspection Tool'));
check('framed /quote hides Login', !framedHtml.includes('>Login<'));

const framedChrome = quotePageChrome({ pathname: '/quote', search: '', framed: true, loggedIn: false });
check('framed /quote hides header and staff links', framedChrome.hideHeader && framedChrome.hideStaffLinks);
const staffChrome = quotePageChrome({ pathname: '/inspect', search: '', framed: false, loggedIn: true });
check('staff page chrome is unchanged', !staffChrome.hideHeader && !staffChrome.hideStaffLinks);

const quote: FullQuoteData = {
  address: '1 Test St, Raleigh, NC',
  lat: 35.78,
  lng: -78.64,
  roofData: { totalAreaSqFt: 2000, segments: 2, avgPitchDegrees: 22, imageryQuality: 'HIGH' },
  quote: {
    roofSquares: 23,
    totalAreaSqFt: 2000,
    wasteFactor: 1.15,
    hdzEstimate: 9900,
    uhdzEstimate: 10800,
    hdzPricePerSquare: 430,
    uhdzUpgradePerSquare: 40,
    uhdzPricePerSquare: 470,
    lowEstimate: 9900,
    highEstimate: 10800,
    avgPitchDegrees: 22,
    pitchCategory: 'Standard',
    pitchOver12: 4.8,
    materialNote: 'Architectural shingles',
  },
};
const result = renderToString(<QuoteResult data={quote} onLeadSubmitted={() => {}} />);
check(
  'quote result has the call link',
  result.includes('href="tel:+19199774074"') && result.includes('Call K&amp;D Roofing: (919) 977-4074'),
);
check('quote result has the disclaimer', result.includes(QUOTE_DISCLAIMER));
check('quote result shows HDZ as the main price', result.includes('GAF Timberline HDZ') && result.includes('$9,900') && !result.includes('$9,900 –'));
check(
  'quote result shows the UHDZ upgrade line',
  result.includes('Optional upgrade: GAF Timberline UHDZ +$40/sq ($470/sq) · $10,800'),
);
check('call constant matches the public link', KD_CALL.href === 'tel:+19199774074' && KD_CALL.label === 'Call K&D Roofing: (919) 977-4074');

const calls: { data: unknown; origin: string }[] = [];
const self = {};
const parent = {
  postMessage(data: unknown, origin: string) {
    calls.push({ data, origin });
  },
};
(globalThis as unknown as { window: unknown }).window = {
  self,
  top: {},
  parent,
};
check('framed window detected', isFramedWindow());
notifyParentLeadSubmitted();
check('lead message posts once per parent origin', calls.length === 2, JSON.stringify(calls));
check(
  'lead message uses both K&D origins and never *',
  calls[0]?.origin === LEAD_PARENT_ORIGINS[0]
    && calls[1]?.origin === LEAD_PARENT_ORIGINS[1]
    && calls.every(c => c.origin !== '*' && JSON.stringify(c.data) === JSON.stringify(LEAD_SUBMITTED_MESSAGE)),
);
calls.length = 0;
(globalThis as unknown as { window: { top: unknown } }).window.top = self;
check('top-level window is not framed', !isFramedWindow());
notifyParentLeadSubmitted();
check('top-level lead capture does not postMessage', calls.length === 0);
delete (globalThis as unknown as { window?: unknown }).window;

const pricing = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../server/services/pricing.ts'), 'utf8');
check('pricing comment names HDZ $430 and UHDZ $470', pricing.includes('$430') && pricing.includes('$470') && !pricing.includes('$350') && !pricing.includes('$555'));
check(
  'price constants are the HDZ and UHDZ rates',
  HDZ_PRICE_PER_SQUARE === 430 && UHDZ_UPGRADE_PER_SQUARE === 40 && UHDZ_PRICE_PER_SQUARE === 470,
);

function sampleBuilding(area: number, pitch: number): BuildingRoofData {
  return {
    totalAreaSqFt: area,
    segments: [],
    avgPitch: pitch,
    imageryQuality: 'HIGH',
    footprintSqFt: area,
    estimatedPerimeterFt: 100,
    estimatedLength: 40,
    estimatedWidth: 25,
    boundingBox: null,
  };
}
const standard = calculateQuote(sampleBuilding(2000, 22));
const atThreshold = calculateQuote(sampleBuilding(2000, 35));
const steep = calculateQuote(sampleBuilding(2000, 40));
check('standard roof prices HDZ and UHDZ after 15% waste', standard.hdzEstimate === 9900 && standard.uhdzEstimate === 10800 && standard.lowEstimate === 9900 && standard.highEstimate === 10800, JSON.stringify({ hdz: standard.hdzEstimate, uhdz: standard.uhdzEstimate }));
check('pitch of 35 degrees does not add the steep surcharge', atThreshold.hdzEstimate === 9900 && atThreshold.uhdzEstimate === 10800);
check('pitch over 35 degrees adds 10%', steep.hdzEstimate === 10900 && steep.uhdzEstimate === 11900, JSON.stringify({ hdz: steep.hdzEstimate, uhdz: steep.uhdzEstimate }));
check('waste factor stays 15%', standard.wasteFactor === 1.15);

if (failed) process.exit(1);
