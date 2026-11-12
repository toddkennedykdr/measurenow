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
  notifyParentHeight,
  notifyParentLeadSubmitted,
  quotePageChrome,
  replyToParentPing,
} from '../src/quoteChrome';
import { calculateQuote, HDZ_PRICE_PER_SQUARE, UHDZ_PRICE_PER_SQUARE, UHDZ_UPGRADE_PER_SQUARE } from '../server/services/pricing';
import {
  HARDCODED_EMBED_ORIGINS,
  canonicalizeEmbedOrigin,
  embedOriginsScript,
  htmlSafeJson,
  isExactHttpsOrigin,
  parseEmbedParentOrigins,
  readEmbedParentOrigins,
} from '../server/embedOrigins';
import type { BuildingRoofData } from '../server/services/solar';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

const TAGLINE = 'Serving North Carolina since 2017';
const unframed = render('/quote', <App />);
const embed = render('/quote?embed=1', <App />);
const home = render('/', <NavBar />);
const inspect = render('/inspect', <NavBar />);

check('unframed /quote has the header', unframed.includes(TAGLINE));
check('unframed /quote keeps the nav', unframed.includes('class="appbar"'));
check('unframed /quote hides Inspection Tool', !unframed.includes('Inspection Tool'));
check('unframed /quote hides Login', !unframed.includes('>Login<'));
check('embed /quote hides the header', !embed.includes(TAGLINE) && !embed.includes('class="header"'));
check('embed /quote hides the nav', !embed.includes('class="appbar"') && !embed.includes('Instant Quote'));
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
check('framed /quote hides the nav', !framedHtml.includes('class="appbar"') && !framedHtml.includes('Instant Quote'));
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
calls.length = 0;
notifyParentHeight(640);
check('top-level page does not post a height', calls.length === 0);
(globalThis as unknown as { window: { top: unknown } }).window.top = {};
notifyParentHeight(812);
check('height message posts once per parent origin', calls.length === 2, JSON.stringify(calls));
check(
  'height message uses both K&D Roofing origins and never *',
  calls[0]?.origin === LEAD_PARENT_ORIGINS[0]
    && calls[1]?.origin === LEAD_PARENT_ORIGINS[1]
    && calls.every(c => c.origin !== '*' && JSON.stringify(c.data) === JSON.stringify({ type: 'measurenow:height', height: 812 })),
);
delete (globalThis as unknown as { window?: unknown }).window;

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(tsx|ts|css|html)$/.test(name)) found.push(full);
  }
  return found;
}
const customerSource = sourceFiles(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src'))
  .map(file => readFileSync(file, 'utf8'))
  .join('\n');
check('customer copy has no "no pressure"', !/no pressure/i.test(customerSource));
const withoutFullName = customerSource.replace(/K&amp;D Roofing/g, '').replace(/K&D Roofing/g, '');
check('customer copy does not use a bare K&D', !/K&(?:amp;)?D/.test(withoutFullName));

const styles = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/styles.css'), 'utf8');
const disclaimerRule = styles.slice(styles.indexOf('.quote-result__disclaimer'), styles.indexOf('.quote-result__upgrade'));
const callRule = styles.slice(styles.indexOf('.quote-result__call {'), styles.indexOf('.quote-result__call:hover'));
check('disclaimer font is 14px', disclaimerRule.includes('font-size: 14px;'));
check('call link tap target is at least 48px', callRule.includes('min-height: 48px;'));

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

const hardcoded = [...HARDCODED_EMBED_ORIGINS];
const silent: string[] = [];
check('unset embed parents stay the two sites', JSON.stringify(parseEmbedParentOrigins(undefined, message => silent.push(message))) === JSON.stringify(hardcoded) && silent.length === 0);
check('blank embed parents stay the two sites', JSON.stringify(parseEmbedParentOrigins('  ,  ', message => silent.push(message))) === JSON.stringify(hardcoded) && silent.length === 0);
const preview = 'https://preview.example.com';
const warnings: string[] = [];
const raw = `${preview}, *, http://x.com, https://x.com/path, https://*.x.com, "><script>, `;
const parsedOrigins = parseEmbedParentOrigins(raw, message => warnings.push(message));
check(
  'a valid preview origin is appended and duplicates are not required',
  JSON.stringify(parsedOrigins) === JSON.stringify([...hardcoded, preview]),
);
check(
  'invalid embed origins are counted without echoing them',
  warnings.length === 1 && warnings[0] === 'EMBED_PARENT_ORIGINS: ignored 5 invalid entries' && !warnings[0].includes('*') && !warnings[0].includes('http') && !warnings[0].includes('script'),
);
for (const bad of ['*', 'http://x.com', 'https://x.com/path', 'https://*.x.com', '"><script>', 'https://x.com/', 'https://x.com?q=1', 'https://a;b.test', "https://a$'.test", 'https://x.test:99999']) {
  check(`rejected embed origin ${bad}`, canonicalizeEmbedOrigin(bad) === null && !isExactHttpsOrigin(bad));
}
check('port 8443 is an accepted embed origin', canonicalizeEmbedOrigin('https://good.test:8443') === 'https://good.test:8443' && isExactHttpsOrigin('https://good.test:8443'));
check('uppercase embed host is lowercased', canonicalizeEmbedOrigin('https://GOOD.TEST') === 'https://good.test' && !isExactHttpsOrigin('https://GOOD.TEST') && isExactHttpsOrigin('https://good.test'));
const tightened = parseEmbedParentOrigins("https://a;b.test, https://a$'.test, https://good.test:8443, https://x.test:99999, https://GOOD.TEST");
check(
  'tightened hosts keep only the canonical origins',
  JSON.stringify(tightened) === JSON.stringify([...hardcoded, 'https://good.test:8443', 'https://good.test']),
);
check('hardcoded origins are not duplicated', parseEmbedParentOrigins(` ${hardcoded[0]} , ${preview} `).length === 3);
const nasty = htmlSafeJson(['</script><script>alert(1)</script>', 'a&b', 'line\u2028sep\u2029']);
check('embed JSON cannot break out of the script tag', !nasty.includes('<') && !nasty.includes('>') && !nasty.includes('&') && !nasty.includes('\u2028') && !nasty.includes('\u2029'));
const injected = embedOriginsScript(parsedOrigins);
check('injected block is not an executable script', injected.startsWith('<script type="application/json"') && !injected.includes('"><script>'));
const payload = injected.slice(injected.indexOf('>') + 1, injected.lastIndexOf('</script>'));
const clientList = readEmbedParentOrigins({
  getElementById(id: string) {
    return id === 'measurenow-embed-origins' ? { textContent: payload } : null;
  },
});
check('client revalidates the injected preview list', JSON.stringify(clientList) === JSON.stringify(parsedOrigins));
const hostile = readEmbedParentOrigins({
  getElementById() {
    return { textContent: JSON.stringify(['*', 'http://x.com', 'https://ok.example', preview]) };
  },
});
check(
  'client drops bad origins and keeps the two sites first',
  hostile[0] === hardcoded[0] && hostile[1] === hardcoded[1] && hostile.includes('https://ok.example') && hostile.includes(preview) && !hostile.includes('*') && !hostile.some(origin => origin.startsWith('http://')),
);
check('client falls back when the payload is not JSON', JSON.stringify(readEmbedParentOrigins({
  getElementById() { return { textContent: '{"not":"a list"' }; },
})) === JSON.stringify(hardcoded));

const pingParent = {
  postMessage(data: unknown, origin: string) {
    calls.push({ data, origin });
  },
};
const stranger = {
  postMessage(data: unknown, origin: string) {
    calls.push({ data, origin: `stranger:${origin}` });
  },
};
calls.length = 0;
const trustedPing = replyToParentPing(
  { origin: hardcoded[0], source: pingParent, data: { type: 'measurenow:ping' } },
  540,
  pingParent,
);
check('trusted parent ping gets a height reply', trustedPing && calls.length === 1 && JSON.stringify(calls[0]) === JSON.stringify({ data: { type: 'measurenow:height', height: 540 }, origin: hardcoded[0] }));
check('ping reply is not a lead-submitted message', calls.every(call => JSON.stringify(call.data) !== JSON.stringify({ type: 'measurenow:lead-submitted' })));
calls.length = 0;
const untrustedPing = replyToParentPing(
  { origin: 'https://evil.example', source: pingParent, data: { type: 'measurenow:ping' } },
  540,
  pingParent,
);
const strangerPing = replyToParentPing(
  { origin: hardcoded[0], source: stranger, data: { type: 'measurenow:ping' } },
  540,
  pingParent,
);
check('untrusted origin and non-parent source get no ping reply', !untrustedPing && !strangerPing && calls.length === 0);

if (failed) process.exit(1);
