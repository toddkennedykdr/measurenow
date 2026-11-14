// Renders the public quote page (no browser, no network, no lead POST).
import React, { type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext';
import App from '../src/App';
import { NavBar } from '../src/components/NavBar';
import { QuoteResult } from '../src/components/QuoteResult';
import { spawn } from 'node:child_process';
import { QuoteGate, firstInvalidGateField } from '../src/components/QuoteGate';
import { GAF_CONTRACTOR_ID, GAF_MASTER_ELITE_LABEL, QUOTE_INCLUDES, QUOTE_WARRANTY } from '../src/quoteIncludes';
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
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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
const result = renderToString(<QuoteResult data={quote} />);
check(
  'quote result has the call link',
  result.includes('href="tel:+19199774074"') && result.includes('Call K&amp;D Roofing: (919) 977-4074'),
);
check('quote result has the disclaimer', result.includes(QUOTE_DISCLAIMER));
check(
  'quote result shows HDZ as the selected price',
  result.includes('GAF Timberline HDZ')
    && result.includes('$9,900')
    && result.includes('$430/sq')
    && !result.includes('$9,900 –')
    && result.indexOf('aria-checked="true"') !== -1
    && result.indexOf('aria-checked="true"') < result.indexOf('GAF Timberline HDZ')
    && result.indexOf('GAF Timberline HDZ') < result.indexOf('aria-checked="false"'),
);
check(
  'quote result shows the UHDZ option at +$40/sq ($470/sq)',
  result.includes('GAF Timberline UHDZ') && result.includes('+$40/sq ($470/sq)') && result.includes('$10,800'),
);
const includeTexts = QUOTE_INCLUDES.map((item) => item.text);
const radiogroupHtml = result.slice(result.indexOf('role="radiogroup"'), result.indexOf('quote-panel--hdz'));
const hdzPanel = result.slice(result.indexOf('quote-panel--hdz'), result.indexOf('quote-panel--uhdz'));
const uhdzPanel = result.slice(result.indexOf('quote-panel--uhdz'));
const financing = QUOTE_INCLUDES[QUOTE_INCLUDES.length - 1];
const financingHref = 'https://projects.greensky.com/MerchantLoanApplication?apptype=short&merchant=81101872&dealerplan=2521&channel=External-Button-03';
function countText(haystack: string, needle: string) {
  return haystack.split(needle).length - 1;
}
function appearsInOrder(haystack: string, parts: readonly string[]) {
  let at = -1;
  return parts.every((part) => {
    const next = haystack.indexOf(part, at + 1);
    if (next === -1) return false;
    at = next;
    return true;
  });
}
check(
  'quote result warranty is per card',
  QUOTE_WARRANTY.label === 'Warranty:'
    && QUOTE_WARRANTY.goldenPledge.hdz === 'GAF Golden Pledge Warranty, 50-year shingle with 25-year labor backed by GAF'
    && QUOTE_WARRANTY.goldenPledge.uhdz === 'GAF Golden Pledge Warranty, 50-year shingle with 30-year labor backed by GAF'
    && QUOTE_WARRANTY.wind === '15-year WindProven™ Limited Wind Warranty, no max wind speed'
    && QUOTE_WARRANTY.algae.hdz === '25-year StainGuard Plus™ Algae Protection Limited Warranty'
    && QUOTE_WARRANTY.algae.uhdz === '30-year StainGuard Plus PRO™ Algae Protection Limited Warranty'
    && hdzPanel.includes(QUOTE_WARRANTY.goldenPledge.hdz)
    && hdzPanel.includes(QUOTE_WARRANTY.algae.hdz)
    && hdzPanel.includes(QUOTE_WARRANTY.wind)
    && !hdzPanel.includes('30-year labor')
    && !hdzPanel.includes('30-year StainGuard')
    && uhdzPanel.includes(QUOTE_WARRANTY.goldenPledge.uhdz)
    && uhdzPanel.includes(QUOTE_WARRANTY.algae.uhdz)
    && uhdzPanel.includes(QUOTE_WARRANTY.wind)
    && !result.includes('Architectural shingles')
    && !result.includes('Unlimited wind warranty on shingles')
    && !result.includes('50-year shingle with a 25-year labor warranty backed by the manufacturer (GAF)'),
);
check(
  'financing links are outside the radiogroup',
  radiogroupHtml.includes('role="radio"') && !radiogroupHtml.includes('<a'),
);
check(
  'quote result shows the seven included items on both cards',
  includeTexts.length === 7
    && includeTexts[0] === 'Full tear-off plus up to 2 sheets of decking replaced'
    && includeTexts[6] === 'Financing is available'
    && !includeTexts.some((text) => text.startsWith('GAF Golden Pledge'))
    && appearsInOrder(result, includeTexts)
    && includeTexts.every((text) => countText(result, text) === 2)
    && countText(result, "What's included") + countText(result, "What&#x27;s included") === 2,
);
check(
  'financing include links to the GreenSky application',
  financing.text === 'Financing is available'
    && financing.linkText === 'Click here to apply'
    && financing.href === financingHref
    && countText(result, `href="${financingHref.replace(/&/g, '&amp;')}"`) === 2
    && countText(result, 'target="_blank"') === 2
    && countText(result, 'rel="noopener noreferrer"') === 2
    && countText(result, 'Click here to apply') === 2,
);
const ALLOWED_QUOTE_IMAGES = [
  '/images/gaf-timberline-hdz.webp',
  '/images/gaf-timberline-uhdz.webp',
] as const;
const quoteImgs = [...result.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
function imageSrc(tag: string) {
  const match = tag.match(/src="([^"]+)"/);
  return match ? match[1] : '';
}
check(
  'quote screen images are only the two GAF product photos',
  quoteImgs.length === 2
    && quoteImgs.every((tag) => (ALLOWED_QUOTE_IMAGES as readonly string[]).includes(imageSrc(tag)))
    && new Set(quoteImgs.map(imageSrc)).size === 2
    && quoteImgs.every((tag) => tag.includes('loading="lazy"'))
    && quoteImgs.every((tag) => tag.includes('width="800"') && tag.includes('height="315"'))
    && quoteImgs.every((tag) => !/logo/i.test(tag))
    && result.includes('alt="Home roof with GAF Timberline HDZ shingles"')
    && result.includes('alt="Home roof with GAF Timberline UHDZ shingles"'),
  quoteImgs.join(' | '),
);
const quoteImageDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/images');
const quoteImageFiles = readdirSync(quoteImageDir).filter((name) => !name.startsWith('.'));
check(
  'public quote images are exactly the two GAF product photos',
  quoteImageFiles.length === 2
    && quoteImageFiles.includes('gaf-timberline-hdz.webp')
    && quoteImageFiles.includes('gaf-timberline-uhdz.webp'),
  quoteImageFiles.join(', '),
);
check('address step does not render package photos', !unframed.includes('/images/gaf-timberline-') && !embed.includes('/images/gaf-timberline-'));
const gateHtml = renderToString(
  <QuoteGate address="1 Test St, Raleigh, NC" submitting={false} serverError="" onSubmit={() => {}} />,
);
check(
  'gate form has contact fields and no prices or photos',
  gateHtml.includes('See your estimate')
    && gateHtml.includes('K&amp;D Roofing')
    && gateHtml.includes('id="gate-name"')
    && gateHtml.includes('id="gate-phone"')
    && gateHtml.includes('id="gate-email"')
    && gateHtml.includes('id="gate-address"')
    && gateHtml.includes('1 Test St, Raleigh, NC')
    && !/<img\b/i.test(gateHtml)
    && !gateHtml.includes('$')
    && !/no pressure/i.test(gateHtml),
);
const preGatePages = `${unframed}\n${embed}\n${framedHtml}\n${gateHtml}`;
check(
  'pre-gate pages do not show squares, pitch, area, or prices',
  !/roofSquares|pitchOver12|pitchCategory|Sq Ft|\bSquares\b|\$\d|10,600|11,600/.test(preGatePages),
);
check('gate focus order starts at the first invalid field', firstInvalidGateField({ name: 'Name is required.', phone: 'Please enter a valid US phone number.' }) === 'name');
check('gate focus moves past a valid name', firstInvalidGateField({ phone: 'Please enter a valid US phone number.', email: 'Please enter a valid email.' }) === 'phone');
check('gate focus reaches email before address', firstInvalidGateField({ email: 'Please enter a valid email.', address: 'Please enter a valid address.' }) === 'email');
check(
  'quote result names GAF Master Elite in plain text',
  result.includes(GAF_MASTER_ELITE_LABEL) && result.includes(`Contractor ID ${GAF_CONTRACTOR_ID}`),
);
check('call constant matches the public link', KD_CALL.href === 'tel:+19199774074' && KD_CALL.label === 'Call K&D Roofing: (919) 977-4074');
check(
  'call number stays on one line',
  result.includes('class="quote-result__call-number"')
    && result.includes('aria-label="Call K&amp;D Roofing: (919) 977-4074"')
    && result.includes('(919) 977-4074'),
);
check(
  'shingle options use a roving tabindex',
  result.includes('role="radiogroup"')
    && result.indexOf('tabindex="0"') !== -1
    && result.indexOf('tabindex="0"') < result.indexOf('GAF Timberline HDZ')
    && result.indexOf('GAF Timberline HDZ') < result.indexOf('tabindex="-1"'),
);

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
const numberRuleStart = styles.indexOf('.quote-result__call-number');
const numberRule = styles.slice(numberRuleStart, styles.indexOf('}', numberRuleStart) + 1);
const btnStart = styles.indexOf('.btn {');
const btnRule = styles.slice(btnStart, styles.indexOf('}', btnStart) + 1);
check('disclaimer font is 14px', disclaimerRule.includes('font-size: 14px;'));
check('call link tap target is at least 48px', callRule.includes('min-height: 48px;'));
check('call number css does not wrap', numberRule.includes('white-space: nowrap;'));
check('detailed estimate button is at least 48px', btnRule.includes('min-height: 48px;'));

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

runGateFocusCheck().then(() => {
  if (failed) process.exit(1);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});

function pageLeak(value: string) {
  return /\$\s?\d|roofSquares|pitchOver12|pitchCategory|Sq Ft|\bSquares\b|sqft|10,600|11,600|\b24\.8\b|\b4\.8\/12\b/.test(value);
}

async function runGateFocusCheck() {
  const uiPort = 15000 + (process.pid % 1000);
  const chromePort = 17000 + (process.pid % 1000);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const srv = spawn(process.execPath, ['-r', path.join(root, 'scripts/fetch-stub.cjs'), path.join(root, 'dist-server/index.js')], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(uiPort),
      SKIP_DB_INIT: '1',
      GOOGLE_SOLAR_API_KEY: 'test-not-a-key',
      ANTHROPIC_API_KEY: '',
      RESEND_API_KEY: '',
      JN_API_KEY: '',
      SESSION_SECRET: 'smoke-test-only',
      CAP_QUOTE_PUBLIC: '100',
      CAP_LEAD_PUBLIC: '100',
      CAP_QUOTE_GATE_PUBLIC: '100',
      EMBED_PARENT_ORIGINS: '',
    },
    stdio: 'ignore',
  });
  const chromeBin = process.env.QUOTE_UI_CHROME || '/usr/bin/google-chrome';
  const userDataDir = path.join('/tmp', `quote-ui-chrome-${process.pid}`);
  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-default-apps',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-client-side-phishing-detection',
    '--disable-domain-reliability',
    '--disable-component-extensions-with-background-pages',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-prompt-on-repost',
    '--disable-translate',
    '--metrics-recording-only',
    '--disable-features=Translate,AutofillServerCommunication,OptimizationHints,MediaRouter,InterestFeedContentSuggestions',
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  let socket: WebSocket | null = null;
  try {
    const base = `http://127.0.0.1:${uiPort}`;
    let up = false;
    for (let i = 0; i < 50; i++) {
      try { await fetch(`${base}/quote`); up = true; break; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    check('quote ui server booted for the focus check', up);
    if (!up) return;
    let version: { webSocketDebuggerUrl?: string } | null = null;
    for (let i = 0; i < 50; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${chromePort}/json/version`)).json();
        if (version?.webSocketDebuggerUrl) break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    check('quote ui browser booted for the focus check', Boolean(version?.webSocketDebuggerUrl));
    if (!version?.webSocketDebuggerUrl) return;
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve());
      socket!.addEventListener('error', () => reject(new Error('browser socket failed')));
    });
    let seq = 0;
    const waiters = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      const waiter = message.id ? waiters.get(message.id) : undefined;
      if (!waiter) return;
      waiters.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
    });
    const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) => new Promise<any>((resolve, reject) => {
      const id = ++seq;
      waiters.set(id, { resolve, reject });
      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      socket!.send(JSON.stringify(payload));
    });
    const created = await send('Target.createTarget', { url: `${base}/quote` });
    const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true });
    const sessionId = attached.sessionId as string;
    await send('Runtime.enable', {}, sessionId);
    const evaluated = await send('Runtime.evaluate', {
      expression: `(() => {
        const setVal = (el, value) => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const waitFor = (label, pred) => new Promise((resolve, reject) => {
          const start = Date.now();
          const tick = () => {
            try {
              const found = pred();
              if (found) resolve(found);
              else if (Date.now() - start > 15000) reject(new Error('timeout ' + label));
              else setTimeout(tick, 50);
            } catch (err) { reject(err); }
          };
          tick();
        });
        const store = () => ({ session: { ...sessionStorage }, local: { ...localStorage } });
        return (async () => {
          const address = await waitFor('address', () => document.querySelector('#address'));
          setVal(address, '1 Test St, Raleigh, NC');
          await new Promise((resolve) => setTimeout(resolve, 50));
          address.form.requestSubmit();
          const confirm = await waitFor('confirm', () => [...document.querySelectorAll('button')].find((button) => /Yes, Get My Quote|Confirm This Location/.test(button.textContent || '')));
          confirm.click();
          await waitFor('gate', () => document.querySelector('#gate-name'));
          const before = { html: document.documentElement.outerHTML, text: document.body.innerText, ...store() };
          document.querySelector('#gate-name').form.requestSubmit();
          const nameField = await waitFor('name focus', () => document.activeElement && document.activeElement.id === 'gate-name' ? document.activeElement : null);
          const first = {
            active: nameField.id,
            alerts: [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent),
            invalid: nameField.getAttribute('aria-invalid'),
            describedby: nameField.getAttribute('aria-describedby'),
          };
          setVal(nameField, 'Jane Homeowner');
          await new Promise((resolve) => setTimeout(resolve, 50));
          nameField.form.requestSubmit();
          const phoneField = await waitFor('phone focus', () => document.activeElement && document.activeElement.id === 'gate-phone' ? document.activeElement : null);
          return { before, first, secondActive: phoneField.id, after: { html: document.documentElement.outerHTML, text: document.body.innerText, ...store() } };
        })();
      })()`,
      awaitPromise: true,
      returnByValue: true,
    }, sessionId);
    if (evaluated.exceptionDetails) {
      check('gate error moves focus to the first invalid field', false, JSON.stringify(evaluated.exceptionDetails).slice(0, 500));
      return;
    }
    const value = evaluated.result?.value;
    const blobs = [
      value?.before?.html, value?.before?.text, JSON.stringify(value?.before?.session), JSON.stringify(value?.before?.local),
      value?.after?.html, value?.after?.text, JSON.stringify(value?.after?.session), JSON.stringify(value?.after?.local),
    ];
    check(
      'pre-gate dom and storage hide squares, pitch, area, and prices',
      blobs.every((blob) => typeof blob === 'string' && !pageLeak(blob))
        && Object.keys(value.before.session).length === 0
        && Object.keys(value.before.local).length === 0
        && Object.keys(value.after.session).length === 0
        && Object.keys(value.after.local).length === 0,
      blobs.find((blob) => typeof blob === 'string' && pageLeak(blob))?.slice(0, 240) || '',
    );
    check(
      'gate error moves focus to the first invalid field',
      value.first.active === 'gate-name'
        && value.first.invalid === 'true'
        && value.first.describedby === 'gate-name-error'
        && value.first.alerts.some((text: string) => text.includes('Name is required.'))
        && value.secondActive === 'gate-phone',
      JSON.stringify({ first: value.first, second: value.secondActive }),
    );
  } catch (err) {
    check('gate error moves focus to the first invalid field', false, err instanceof Error ? err.message : String(err));
  } finally {
    socket?.close();
    srv.kill('SIGKILL');
    try {
      if (chrome.pid) process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      chrome.kill('SIGKILL');
    }
    await new Promise((resolve) => {
      if (chrome.exitCode != null || chrome.signalCode != null) resolve(undefined);
      else {
        chrome.once('exit', () => resolve(undefined));
        setTimeout(resolve, 2000);
      }
    });
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
