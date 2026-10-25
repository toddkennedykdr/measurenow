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

const leadSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(100, 'Please enter a shorter name.'),
  email: z.string().trim().email('Please enter a valid email.').max(254, 'Please enter a shorter email.'),
  phone: z.string().trim().min(7, 'Please enter a valid phone number.').max(40, 'Please enter a shorter phone number.'),
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

async function sendEmailNotification(lead: z.infer<typeof leadSchema>) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('RESEND_API_KEY not set, skipping email');
    return;
  }

  try {
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
      const body = await res.text();
      console.error('Resend email error:', res.status, body);
    } else {
      console.log('📧 Email notification sent for', lead.name);
    }
  } catch (err: any) {
    console.error('Resend email exception:', err.message);
  }
}

async function pushToJobNimbus(lead: z.infer<typeof leadSchema>) {
  const apiKey = process.env.JN_API_KEY;
  if (!apiKey) {
    console.warn('JN_API_KEY not set, skipping JobNimbus');
    return;
  }

  try {
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
      const body = await res.text();
      console.error('JobNimbus error:', res.status, body);
    } else {
      console.log('🏗️ JobNimbus contact created for', lead.name);
    }
  } catch (err: any) {
    console.error('JobNimbus exception:', err.message);
  }
}

leadRouter.post('/capture', leadCaptureRateLimit, async (req: Request, res: Response) => {
  try {
    if (rejectIfSpam(req.body, res)) return;

    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const lead = parsed.data;
    await websiteLeadStore().insert(lead);

    console.log(`📋 New lead captured: ${lead.name} — ${lead.address} — $${lead.quoteLow.toLocaleString()}-$${lead.quoteHigh.toLocaleString()}`);

    // Fire and forget — don't block user response
    sendEmailNotification(lead).catch(() => {});
    pushToJobNimbus(lead).catch(() => {});

    return res.json({ success: true, message: 'Lead captured successfully' });
  } catch (err: any) {
    console.error('Lead capture error:', err.message || err);
    return res.status(500).json({ error: LEAD_SAVE_ERROR });
  }
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
  } catch (err: any) {
    console.error('Lead list error:', err.message || err);
    return res.status(500).json({ error: 'Failed to load leads.' });
  }
});
