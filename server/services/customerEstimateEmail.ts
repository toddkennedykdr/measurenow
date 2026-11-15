import { escapeHtml, PROD_ORIGIN } from '../middleware/security';
import {
  formatQuotePrice,
  formatRoofSqFt,
  HDZ_SHINGLE_NAME,
  QUOTE_DISCLAIMER,
  quoteCardWarrantyLines,
  UHDZ_SHINGLE_NAME,
} from './quoteCardCopy';

/**
 * Customer estimate email, sent only after the quote gate accepts a new lead.
 *
 * CUSTOMER_ESTIMATE_EMAIL_ENABLED must be the exact string "true". Anything else,
 * including unset, is off and this module does no work.
 * ESTIMATE_EMAIL_SNAPSHOT_ENABLED is a second exact-"true" flag. It fetches a
 * Google Static Maps satellite image with the existing server key
 * (GOOGLE_SOLAR_API_KEY) and attaches the bytes. The key never enters the email.
 *
 * Confirmed copy below is the default for each setting. An empty env value
 * drops that block. Do not replace these defaults with invented examples.
 */
export const CUSTOMER_EMAIL_DEFAULTS = {
  from: 'K&D Roofing <noreply@kanddroofingnc.com>',
  replyTo: 'todd@kanddroofingnc.com',
  calendlyUrl: 'https://calendly.com/admin-kanddroofingnc/30min',
  calendlyLabel: 'Book your free inspection',
  gcLicense: 'NC General Contractor License L.101285 (Limited, Residential), active through 12/31/2026',
  masterEliteText: 'K&D Roofing is a 2026 GAF Master Elite® Roofing Contractor',
  gafId: '1115371',
  logoPath: '/static/kd-logo.png',
  badgePath: '/static/master-elite-240.png',
  logoAlt: 'K&D Roofing',
  logoWidth: 140,
  logoHeight: 72,
  badgeWidth: 120,
  badgeHeight: 120,
} as const;

const FROM_ENV = 'CUSTOMER_EMAIL_FROM';
const REPLY_TO_ENV = 'CUSTOMER_EMAIL_REPLY_TO';
const CALENDLY_URL_ENV = 'CUSTOMER_EMAIL_CALENDLY_URL';
const CALENDLY_LABEL_ENV = 'CUSTOMER_EMAIL_CALENDLY_LABEL';
const LICENSE_ENV = 'CUSTOMER_EMAIL_GC_LICENSE';
const MASTER_ELITE_TEXT_ENV = 'CUSTOMER_EMAIL_MASTER_ELITE_TEXT';
const GAF_ID_ENV = 'CUSTOMER_EMAIL_GAF_ID';
const ASSET_BASE_ENV = 'CUSTOMER_EMAIL_ASSET_BASE_URL';
const LOGO_PATH_ENV = 'CUSTOMER_EMAIL_LOGO_PATH';
const BADGE_PATH_ENV = 'CUSTOMER_EMAIL_MASTER_ELITE_IMAGE_PATH';

const SNAPSHOT_CID = 'house-snapshot';
const PHONE_DISPLAY = '(919) 977-4074';
const PHONE_TEL = 'tel:+19199774074';
const SUBJECT = 'Your K&D Roofing estimate';

export type CustomerEstimateInput = {
  to: string;
  name: string;
  address: string;
  roofSqFt: number;
  hdzEstimate: number;
  uhdzEstimate: number;
  lat: number;
  lng: number;
};

export type EstimateAttachment = {
  filename: string;
  content: string;
  content_type: string;
  content_id: string;
};

type RemoteImage = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

export type CustomerEstimateModel = {
  name: string;
  address: string;
  roofSqFtLabel: string;
  hdzName: string;
  uhdzName: string;
  hdzPrice: string;
  uhdzPrice: string;
  hdzWarranty: readonly string[];
  uhdzWarranty: readonly string[];
  disclaimer: string;
  licenseText: string | null;
  masterEliteText: string | null;
  gafId: string | null;
  calendlyUrl: string | null;
  calendlyLabel: string | null;
  logo: RemoteImage | null;
  badge: RemoteImage | null;
  snapshotSrc: string | null;
  snapshotAlt: string;
};

export type RenderedCustomerEstimate = {
  from: string | null;
  replyTo: string | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments: EstimateAttachment[];
};

export function customerEstimateEmailEnabled(): boolean {
  return process.env.CUSTOMER_ESTIMATE_EMAIL_ENABLED === 'true';
}

export function estimateSnapshotEnabled(): boolean {
  return process.env.ESTIMATE_EMAIL_SNAPSHOT_ENABLED === 'true';
}

/** Unset uses the confirmed default. Blank or whitespace drops the block. */
export function optionalConfig(name: string, fallback: string): string | null {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : raw;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function headerSafe(value: string | null): string | null {
  if (!value) return null;
  if (/[\r\n\u0000]/.test(value)) return null;
  return value;
}

function oneLine(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function httpsUrl(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.hostname === 'maps.googleapis.com' || url.hostname.endsWith('.googleapis.com')) return null;
  if (/[?&](?:key|api_key)=|AIza/i.test(url.toString())) return null;
  return url.toString();
}

function assetBase(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === 'maps.googleapis.com' || host.endsWith('.googleapis.com')) return null;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null;
  return url.origin;
}

function assetUrl(base: string | null, pathValue: string | null): string | null {
  if (!base || !pathValue) return null;
  if (!pathValue.startsWith('/') || pathValue.startsWith('//')) return null;
  if (pathValue.includes('..') || pathValue.includes('\\') || /\s/.test(pathValue)) return null;
  if (/key=|googleapis|AIza/i.test(pathValue)) return null;
  return `${base}${pathValue}`;
}

export function resolveCustomerEstimate(input: CustomerEstimateInput, snapshot: { contentType: string; bytes: Buffer } | null): {
  from: string | null;
  replyTo: string | null;
  model: CustomerEstimateModel;
  attachments: EstimateAttachment[];
} {
  const base = assetBase(optionalConfig(ASSET_BASE_ENV, PROD_ORIGIN));
  const logoSrc = assetUrl(base, optionalConfig(LOGO_PATH_ENV, CUSTOMER_EMAIL_DEFAULTS.logoPath));
  const badgeSrc = assetUrl(base, optionalConfig(BADGE_PATH_ENV, CUSTOMER_EMAIL_DEFAULTS.badgePath));
  const masterEliteText = optionalConfig(MASTER_ELITE_TEXT_ENV, CUSTOMER_EMAIL_DEFAULTS.masterEliteText);
  const calendlyUrl = httpsUrl(optionalConfig(CALENDLY_URL_ENV, CUSTOMER_EMAIL_DEFAULTS.calendlyUrl));
  const calendlyLabel = optionalConfig(CALENDLY_LABEL_ENV, CUSTOMER_EMAIL_DEFAULTS.calendlyLabel);
  const attachments: EstimateAttachment[] = [];
  let snapshotSrc: string | null = null;
  if (snapshot && (snapshot.contentType === 'image/png' || snapshot.contentType === 'image/jpeg') && snapshot.bytes.length > 0) {
    snapshotSrc = `cid:${SNAPSHOT_CID}`;
    attachments.push({
      filename: snapshot.contentType === 'image/jpeg' ? 'house.jpg' : 'house.png',
      content: snapshot.bytes.toString('base64'),
      content_type: snapshot.contentType,
      content_id: SNAPSHOT_CID,
    });
  }
  return {
    from: headerSafe(optionalConfig(FROM_ENV, CUSTOMER_EMAIL_DEFAULTS.from)),
    replyTo: headerSafe(optionalConfig(REPLY_TO_ENV, CUSTOMER_EMAIL_DEFAULTS.replyTo)),
    attachments,
    model: {
      name: oneLine(input.name),
      address: oneLine(input.address),
      roofSqFtLabel: `${formatRoofSqFt(input.roofSqFt)} Sq Ft`,
      hdzName: HDZ_SHINGLE_NAME,
      uhdzName: UHDZ_SHINGLE_NAME,
      hdzPrice: formatQuotePrice(input.hdzEstimate),
      uhdzPrice: formatQuotePrice(input.uhdzEstimate),
      hdzWarranty: quoteCardWarrantyLines('hdz'),
      uhdzWarranty: quoteCardWarrantyLines('uhdz'),
      disclaimer: QUOTE_DISCLAIMER,
      licenseText: optionalConfig(LICENSE_ENV, CUSTOMER_EMAIL_DEFAULTS.gcLicense),
      masterEliteText,
      gafId: optionalConfig(GAF_ID_ENV, CUSTOMER_EMAIL_DEFAULTS.gafId),
      calendlyUrl: calendlyUrl && calendlyLabel ? calendlyUrl : null,
      calendlyLabel: calendlyUrl && calendlyLabel ? calendlyLabel : null,
      logo: logoSrc ? {
        src: logoSrc,
        alt: CUSTOMER_EMAIL_DEFAULTS.logoAlt,
        width: CUSTOMER_EMAIL_DEFAULTS.logoWidth,
        height: CUSTOMER_EMAIL_DEFAULTS.logoHeight,
      } : null,
      badge: badgeSrc ? {
        src: badgeSrc,
        alt: masterEliteText || 'Certification badge',
        width: CUSTOMER_EMAIL_DEFAULTS.badgeWidth,
        height: CUSTOMER_EMAIL_DEFAULTS.badgeHeight,
      } : null,
      snapshotSrc,
      snapshotAlt: 'Satellite view of the property',
    },
  };
}

function warrantyHtml(lines: readonly string[]): string {
  return lines.map((line, index) => {
    if (index === 0 && line.startsWith('Warranty: ')) {
      const rest = line.slice('Warranty: '.length);
      return `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#0a1628;"><strong>Warranty:</strong> ${escapeHtml(rest)}</p>`;
    }
    return `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#4a5568;">${escapeHtml(line)}</p>`;
  }).join('');
}

function optionCard(name: string, price: string, lines: readonly string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 12px;border:1px solid #e3e8ef;background-color:#ffffff;">
    <tr>
      <td style="padding:16px 16px 8px;font-family:Arial,Helvetica,sans-serif;">
        <p style="margin:0;font-size:13px;line-height:18px;font-weight:bold;letter-spacing:0.02em;color:#1b5de0;">${escapeHtml(name)}</p>
        <p style="margin:4px 0 0;font-size:28px;line-height:34px;font-weight:bold;color:#0a1628;">${escapeHtml(price)}</p>
      </td>
    </tr>
    <tr>
      <td style="padding:0 16px 12px;">${warrantyHtml(lines)}</td>
    </tr>
  </table>`;
}

export function buildCustomerEstimateEmail(model: CustomerEstimateModel, attachments: EstimateAttachment[]): { html: string; text: string; attachments: EstimateAttachment[] } {
  const logo = model.logo
    ? `<img src="${escapeHtml(model.logo.src)}" width="${model.logo.width}" height="${model.logo.height}" alt="${escapeHtml(model.logo.alt)}" style="display:block;border:0;outline:none;text-decoration:none;width:${model.logo.width}px;height:${model.logo.height}px;max-width:100%;">`
    : '';
  const snapshot = model.snapshotSrc
    ? `<tr><td style="padding:0 0 16px;"><img src="${escapeHtml(model.snapshotSrc)}" width="552" alt="${escapeHtml(model.snapshotAlt)}" style="display:block;width:100%;max-width:552px;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>`
    : '';
  const license = model.licenseText
    ? `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#0a1628;">${escapeHtml(model.licenseText)}</p>`
    : '';
  const elite = model.masterEliteText
    ? `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#0a1628;">${escapeHtml(model.masterEliteText)}</p>`
    : '';
  const gafId = model.gafId
    ? `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#4a5568;">GAF ID ${escapeHtml(model.gafId)}</p>`
    : '';
  const badge = model.badge
    ? `<img src="${escapeHtml(model.badge.src)}" width="${model.badge.width}" height="${model.badge.height}" alt="${escapeHtml(model.badge.alt)}" style="display:block;border:0;outline:none;text-decoration:none;width:${model.badge.width}px;height:${model.badge.height}px;max-width:100%;margin:0 0 12px;">`
    : '';
  const button = model.calendlyUrl && model.calendlyLabel
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 16px;">
        <tr>
          <td align="center" bgcolor="#1b5de0" style="background-color:#1b5de0;border-radius:8px;">
            <a href="${escapeHtml(model.calendlyUrl)}" style="display:block;padding:14px 18px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:bold;color:#ffffff;text-decoration:none;">${escapeHtml(model.calendlyLabel)}</a>
          </td>
        </tr>
      </table>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(SUBJECT)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your roof estimate from K&amp;D Roofing</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6f9;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:16px 8px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;">
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:20px 24px 16px;">
            ${logo}
            <p style="margin:${logo ? '12px' : '0'} 0 0;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;font-weight:bold;color:#0a1628;">K&amp;D Roofing</p>
            <p style="margin:4px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#5b6678;">Your roof estimate</p>
          </td>
        </tr>
        <tr><td bgcolor="#f5a623" style="background-color:#f5a623;height:4px;font-size:0;line-height:0;">&nbsp;</td></tr>
        <tr>
          <td style="padding:20px 24px 8px;font-family:Arial,Helvetica,sans-serif;">
            <p style="margin:0 0 8px;font-size:16px;line-height:24px;color:#0a1628;">Hello ${escapeHtml(model.name)},</p>
            <p style="margin:0 0 4px;font-size:14px;line-height:20px;color:#4a5568;">${escapeHtml(model.address)}</p>
            <p style="margin:0;font-size:14px;line-height:20px;color:#0a1628;"><strong>${escapeHtml(model.roofSqFtLabel)}</strong></p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">
              ${snapshot}
            </table>
            ${optionCard(model.hdzName, model.hdzPrice, model.hdzWarranty)}
            ${optionCard(model.uhdzName, model.uhdzPrice, model.uhdzWarranty)}
            <p style="margin:4px 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#5b6678;">${escapeHtml(model.disclaimer)}</p>
            ${license}
            ${elite}
            ${gafId}
            ${badge}
            ${button}
            <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#5b6678;">Call K&amp;D Roofing</p>
            <p style="margin:2px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;font-weight:bold;"><a href="${PHONE_TEL}" style="color:#1b5de0;text-decoration:none;">${PHONE_DISPLAY}</a></p>
          </td>
        </tr>
        <tr>
          <td style="padding:8px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#5b6678;">K&amp;D Roofing</td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const textLines = [
    SUBJECT,
    '',
    `Hello ${model.name},`,
    '',
    model.address,
    model.roofSqFtLabel,
  ];
  if (model.snapshotSrc) {
    textLines.push('', 'A satellite photo of the property is included in this email.');
  }
  textLines.push(
    '',
    model.hdzName,
    model.hdzPrice,
    ...model.hdzWarranty,
    '',
    model.uhdzName,
    model.uhdzPrice,
    ...model.uhdzWarranty,
    '',
    model.disclaimer,
  );
  if (model.licenseText) textLines.push('', model.licenseText);
  if (model.masterEliteText) textLines.push('', model.masterEliteText);
  if (model.gafId) textLines.push('', `GAF ID ${model.gafId}`);
  if (model.calendlyUrl && model.calendlyLabel) textLines.push('', `${model.calendlyLabel}: ${model.calendlyUrl}`);
  textLines.push('', `Call K&D Roofing: ${PHONE_DISPLAY}`);

  return {
    html,
    text: textLines.join('\n'),
    attachments,
  };
}

export function renderCustomerEstimateEmail(input: CustomerEstimateInput, snapshot: { contentType: string; bytes: Buffer } | null): RenderedCustomerEstimate {
  const resolved = resolveCustomerEstimate(input, snapshot);
  const built = buildCustomerEstimateEmail(resolved.model, resolved.attachments);
  return {
    from: resolved.from,
    replyTo: resolved.replyTo,
    to: oneLine(input.to),
    subject: SUBJECT,
    html: built.html,
    text: built.text,
    attachments: built.attachments,
  };
}

/**
 * Satellite snapshot for the estimate email.
 * Uses the existing server key only. Returns null when the snapshot flag is
 * off, the key is missing, or the image cannot be fetched. Never returns a URL.
 */
export async function fetchSatelliteSnapshot(lat: number, lng: number): Promise<{ contentType: 'image/png' | 'image/jpeg'; bytes: Buffer } | null> {
  if (!estimateSnapshotEnabled()) return null;
  const key = process.env.GOOGLE_SOLAR_API_KEY || '';
  if (!key) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
    url.searchParams.set('center', `${lat},${lng}`);
    url.searchParams.set('zoom', '20');
    url.searchParams.set('size', '600x320');
    url.searchParams.set('scale', '1');
    url.searchParams.set('maptype', 'satellite');
    url.searchParams.set('format', 'png');
    url.searchParams.set('key', key);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'image/png' && contentType !== 'image/jpeg') return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length < 32) return null;
    return { contentType, bytes };
  } catch {
    return null;
  }
}

export async function deliverCustomerEstimateEmail(input: CustomerEstimateInput): Promise<void> {
  if (!customerEstimateEmailEnabled()) return;
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('customer estimate email skipped');
      return;
    }
    const snapshot = await fetchSatelliteSnapshot(input.lat, input.lng);
    const rendered = renderCustomerEstimateEmail(input, snapshot);
    if (!rendered.from || !rendered.to || /[\r\n]/.test(rendered.to)) {
      console.error('customer estimate email skipped');
      return;
    }
    const payload: Record<string, unknown> = {
      from: rendered.from,
      to: [rendered.to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
    if (rendered.replyTo) payload.reply_to = rendered.replyTo;
    if (rendered.attachments.length) payload.attachments = rendered.attachments;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error('customer estimate email failed');
  } catch {
    console.error('customer estimate email failed');
  }
}

/** Fire-and-forget. Returns immediately so the quote-lead response is not delayed. */
export function maybeSendCustomerEstimateEmail(input: CustomerEstimateInput): void {
  if (!customerEstimateEmailEnabled()) return;
  void deliverCustomerEstimateEmail(input);
}
