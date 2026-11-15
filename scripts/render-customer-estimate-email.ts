// Renders the customer estimate email to an HTML file from mock quote data.
// No email is sent and no Google request is made. Open the file and screenshot
// it at 390px and at desktop width.
//
//   npx tsx scripts/render-customer-estimate-email.ts /tmp/customer-estimate-email.html
//
// Images are inlined so the file stands alone. A real send uses absolute URLs
// from CUSTOMER_EMAIL_ASSET_BASE_URL for the logo and badge, and a CID
// attachment for the satellite photo only when ESTIMATE_EMAIL_SNAPSHOT_ENABLED
// is exactly true.
//
// Mock-sink server run (stubs Resend, JobNimbus, and Static Maps):
//   npm run build && node scripts/customer-estimate-email.test.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { calculateQuote } from '../server/services/pricing';
import {
  CUSTOMER_EMAIL_DEFAULTS,
  buildCustomerEstimateEmail,
} from '../server/services/customerEstimateEmail';
import {
  formatQuotePrice,
  formatRoofSqFt,
  HDZ_SHINGLE_NAME,
  QUOTE_DISCLAIMER,
  quoteCardWarrantyLines,
  UHDZ_SHINGLE_NAME,
} from '../server/services/quoteCardCopy';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || '/tmp/customer-estimate-email.html');

function dataUri(file: string, type: string): string {
  const bytes = readFileSync(file);
  return `data:${type};base64,${bytes.toString('base64')}`;
}

const quote = calculateQuote({
  totalAreaSqFt: 2000,
  segments: [],
  avgPitch: 22,
  imageryQuality: 'HIGH',
  footprintSqFt: 0,
  estimatedPerimeterFt: 0,
  estimatedLength: 0,
  estimatedWidth: 0,
  boundingBox: null,
});

async function main() {
  const previewAerial = Buffer.from(
    `<svg width="600" height="320" xmlns="http://www.w3.org/2000/svg"><rect width="600" height="320" fill="#5c7a4e"/><text x="300" y="168" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="22">Sample aerial photo</text></svg>`,
  );
  const snapshot = await sharp(previewAerial).png().toBuffer();
  const built = buildCustomerEstimateEmail({
    name: 'Jane Homeowner',
    address: '1 Test St, Raleigh, NC',
    roofSqFtLabel: `${formatRoofSqFt(2000)} Sq Ft`,
    hdzName: HDZ_SHINGLE_NAME,
    uhdzName: UHDZ_SHINGLE_NAME,
    hdzPrice: formatQuotePrice(quote.hdzEstimate),
    uhdzPrice: formatQuotePrice(quote.uhdzEstimate),
    hdzWarranty: quoteCardWarrantyLines('hdz'),
    uhdzWarranty: quoteCardWarrantyLines('uhdz'),
    disclaimer: QUOTE_DISCLAIMER,
    licenseText: CUSTOMER_EMAIL_DEFAULTS.gcLicense,
    masterEliteText: CUSTOMER_EMAIL_DEFAULTS.masterEliteText,
    gafId: CUSTOMER_EMAIL_DEFAULTS.gafId,
    calendlyUrl: CUSTOMER_EMAIL_DEFAULTS.calendlyUrl,
    calendlyLabel: CUSTOMER_EMAIL_DEFAULTS.calendlyLabel,
    logo: {
      src: dataUri(path.join(root, 'public/static/kd-logo.png'), 'image/png'),
      alt: CUSTOMER_EMAIL_DEFAULTS.logoAlt,
      width: CUSTOMER_EMAIL_DEFAULTS.logoWidth,
      height: CUSTOMER_EMAIL_DEFAULTS.logoHeight,
    },
    badge: {
      src: dataUri(path.join(root, 'public/static/master-elite-240.png'), 'image/png'),
      alt: CUSTOMER_EMAIL_DEFAULTS.masterEliteText,
      width: CUSTOMER_EMAIL_DEFAULTS.badgeWidth,
      height: CUSTOMER_EMAIL_DEFAULTS.badgeHeight,
    },
    snapshotSrc: `data:image/png;base64,${snapshot.toString('base64')}`,
    snapshotAlt: 'Satellite view of the property',
  }, []);
  writeFileSync(out, built.html);
  console.log(out);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : 'render failed');
  process.exit(1);
});
