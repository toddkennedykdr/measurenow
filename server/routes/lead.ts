import { Router, Request, Response } from 'express';
import { z } from 'zod';

export const leadRouter = Router();

const leadSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Please enter a valid email'),
  phone: z.string().min(7, 'Please enter a valid phone number'),
  address: z.string().min(5),
  quoteLow: z.number(),
  quoteHigh: z.number(),
  roofSqFt: z.number(),
  roofSquares: z.number(),
  avgPitchDegrees: z.number().optional(),
  pitchOver12: z.number().optional(),
});

// In-memory store for now
const leads: z.infer<typeof leadSchema>[] = [];

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

leadRouter.post('/capture', async (req: Request, res: Response) => {
  try {
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const lead = parsed.data;
    leads.push(lead);

    console.log(`📋 New lead captured: ${lead.name} — ${lead.address} — $${lead.quoteLow.toLocaleString()}-$${lead.quoteHigh.toLocaleString()}`);

    // Fire and forget — don't block user response
    sendEmailNotification(lead).catch(() => {});
    pushToJobNimbus(lead).catch(() => {});

    return res.json({ success: true, message: 'Lead captured successfully' });
  } catch (err: any) {
    console.error('Lead capture error:', err.message || err);
    return res.status(500).json({ error: 'Failed to save your information. Please call us directly.' });
  }
});

// Admin endpoint to view leads (protect in production)
leadRouter.get('/list', (_req: Request, res: Response) => {
  return res.json({ count: leads.length, leads });
});
