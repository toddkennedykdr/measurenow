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
});

// In-memory store for now — swap with DB or JobNimbus push later
const leads: z.infer<typeof leadSchema>[] = [];

leadRouter.post('/capture', async (req: Request, res: Response) => {
  try {
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const lead = parsed.data;
    leads.push(lead);

    console.log(`📋 New lead captured: ${lead.name} — ${lead.address} — $${lead.quoteLow.toLocaleString()}-$${lead.quoteHigh.toLocaleString()}`);

    // TODO: Push to JobNimbus API
    // TODO: Send confirmation email via Resend

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
