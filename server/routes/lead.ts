import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { websiteLeadStore } from '../db/websiteLeads';
import { leadCaptureRateLimit } from '../leadRateLimit';
import { LEAD_SAVE_ERROR, rejectIfSpam } from '../spamGuard';

export const leadRouter = Router();

const quoteDetail = 'Please check the quote details and try again.';

function money(max: number) {
  return z.number({ invalid_type_error: quoteDetail, required_error: quoteDetail })
    .refine((value) => Number.isFinite(value) && value >= 0 && value <= max, quoteDetail);
}

function positiveMeasure(max: number) {
  return z.number({ invalid_type_error: quoteDetail, required_error: quoteDetail })
    .refine((value) => Number.isFinite(value) && value > 0 && value <= max, quoteDetail);
}

function optionalRange(max: number) {
  return z.number({ invalid_type_error: quoteDetail, required_error: quoteDetail })
    .refine((value) => Number.isFinite(value) && value >= 0 && value <= max, quoteDetail)
    .optional();
}

function digitCount(value: string): number {
  return value.replace(/\D/g, '').length;
}

const leadSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(100, 'Please enter a shorter name.'),
  email: z.string().trim().email('Please enter a valid email.').max(254, 'Please enter a shorter email.'),
  phone: z.string().trim().superRefine((value, ctx) => {
    const digits = digitCount(value);
    if (!/^[0-9+\-().\s]+$/.test(value) || digits < 10) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a valid phone number.' });
      return;
    }
    if (digits > 15) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Please enter a shorter phone number.' });
    }
  }),
  address: z.string().trim().min(5, 'Please enter a valid address.').max(300, 'Please enter a shorter address.'),
  quoteLow: money(10_000_000),
  quoteHigh: money(10_000_000),
  roofSqFt: positiveMeasure(5_000_000),
  roofSquares: positiveMeasure(50_000),
  avgPitchDegrees: optionalRange(90),
  pitchOver12: optionalRange(48),
}).superRefine((lead, ctx) => {
  if (lead.quoteHigh < lead.quoteLow) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: quoteDetail });
  }
});

async function sendEmailNotification(lead: z.infer<typeof leadSchema>): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'K&D Roofing <noreply@kanddroofingnc.com>',
      to: ['todd@kanddroofingnc.com'],
      subject: `New MeasureNow Lead: ${lead.name}`,
      html: `
          <h2>New Lead from MeasureNow</h2>
          <table style="border-collapse:collapse;font-family:sans-serif;">
            <tr><td style="padding:6px 12px;font-weight:bold;">Name</td><td style="padding:6px 12px;">${lead.name}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold;">Email</td><td style="padding:6px 12px;">${lead.email}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold;">Phone</td><td style="padding:6px 12px;">${lead.phone}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold;">Address</td><td style="padding:6px 12px;">${lead.address}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold;">Quote Range</td><td style="padding:6px 12px;">$${lead.quoteLow.toLocaleString()} – $${lead.quoteHigh.toLocaleString()}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold;">Roof Sq Ft</td><td style="padding:6px 12px;">${lead.roofSqFt.toLocaleString()}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold;">Squares</td><td style="padding:6px 12px;">${lead.roofSquares}</td></tr>
            <tr><td style="padding:6px 12px;font-weight:bold;">Pitch</td><td style="padding:6px 12px;">${lead.pitchOver12 ?? 'N/A'}/12 (${lead.avgPitchDegrees ?? 'N/A'}°)</td></tr>
          </table>
        `,
    }),
  });

  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    return false;
  }
  return true;
}

async function pushToJobNimbus(lead: z.infer<typeof leadSchema>): Promise<boolean> {
  const apiKey = process.env.JN_API_KEY;
  if (!apiKey) return false;

  // Parse address into components
  const parts = lead.address.split(',').map(s => s.trim());
  const street = parts[0] || lead.address;
  const city = parts[1] || '';
  // Last part might be "NC 27601" or "State Zip"
  const stateZip = parts[2] || '';
  const stateZipParts = stateZip.split(/\s+/);
  const state = stateZipParts[0] || '';
  const zip = stateZipParts[1] || '';

  const nameParts = lead.name.trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  const res = await fetch('https://app.jobnimbus.com/api1/contacts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      first_name: firstName,
      last_name: lastName,
      email: lead.email,
      home_phone: lead.phone,
      address_line1: street,
      city,
      state_text: state,
      zip,
      source_name: 'MeasureNow',
      description: `MeasureNow Quote: $${lead.quoteLow.toLocaleString()}-$${lead.quoteHigh.toLocaleString()} | Roof: ${lead.roofSqFt.toLocaleString()} sq ft, ${lead.roofSquares} squares | Pitch: ${lead.pitchOver12 ?? 'N/A'}/12`,
    }),
  });

  if (!res.ok) {
    await res.arrayBuffer().catch(() => undefined);
    return false;
  }
  return true;
}

const TRANSIENT_DRIVER_CODES = new Set([
  '40001',
  '40P01',
  '53300',
  '55P03',
  '57P01',
  '57P02',
  '57P03',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNABORTED',
]);

function isTransientDriverError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string') {
      if (TRANSIENT_DRIVER_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code)) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

async function insertLead(lead: z.infer<typeof leadSchema>): Promise<void> {
  try {
    await websiteLeadStore().insert(lead);
  } catch (err) {
    if (!isTransientDriverError(err)) throw err;
    await websiteLeadStore().insert(lead);
  }
}

function stepMark(ok: boolean): 'ok' | 'fail' {
  return ok ? 'ok' : 'fail';
}

leadRouter.post('/capture', (req: Request, res: Response, next: NextFunction) => {
  if (rejectIfSpam(req.body, res)) return;
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  next();
}, leadCaptureRateLimit, async (req: Request, res: Response) => {
  const parsed = leadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0].message });
  }
  const lead = parsed.data;

  let dbOk = false;
  let emailOk = false;
  let jnOk = false;

  try {
    await insertLead(lead);
    dbOk = true;
  } catch {
    dbOk = false;
  }

  try {
    emailOk = await sendEmailNotification(lead);
  } catch {
    emailOk = false;
  }

  try {
    jnOk = await pushToJobNimbus(lead);
  } catch {
    jnOk = false;
  }

  console.log(`lead delivery db=${stepMark(dbOk)} email=${stepMark(emailOk)} jn=${stepMark(jnOk)}`);

  if (!dbOk && !emailOk && !jnOk) {
    return res.status(500).json({ error: LEAD_SAVE_ERROR });
  }
  return res.json({ success: true, message: 'Lead captured successfully' });
});

function requireLogin(req: Request, res: Response, next: NextFunction): void {
  if (!(req.session as { userId?: number } | undefined)?.userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  next();
}

// Same session check the report routes use. Rows come from website_leads.
// Capturing a quote stays public. A roof API key is not a session.
leadRouter.get('/list', requireLogin, async (_req: Request, res: Response) => {
  try {
    const leads = await websiteLeadStore().list();
    return res.json({ count: leads.length, leads });
  } catch {
    console.error('lead list db=fail');
    return res.status(500).json({ error: 'Failed to load leads.' });
  }
});
