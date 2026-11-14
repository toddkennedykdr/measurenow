import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { dailyCap, perIpLimit } from '../middleware/security';
import {
  getQuoteSession,
  openQuoteForContact,
  pricedBody,
  signQuoteToken,
  usPhoneDigits,
  verifyQuoteToken,
} from '../services/quoteAccess';

const gateSchema = z.object({
  quoteId: z.string().min(16).max(200),
  name: z.string().trim().min(1, 'Name is required.').max(200),
  email: z.string().trim().email('Please enter a valid email.'),
  phone: z.string().trim().min(1, 'Please enter a valid US phone number.').max(40),
  address: z.string().trim().min(5, 'Please enter a valid address.').max(300),
});

const REVEAL_ERROR = 'Please submit your contact info to view your estimate.';

function noStore(res: Response) {
  res.set('Cache-Control', 'no-store');
}

/**
 * Price reveal and the contact gate. Lead delivery stays on POST /api/lead/capture.
 * These routes reuse a quote that POST /api/roof/quote already paid for, so they do
 * not spend the quote IP limit or the daily quote cap. A fresh paid lookup is only
 * POST /api/roof/quote. The gate keeps its own 5/hour and 50/day submit budget.
 * /api/lead/capture keeps its own 5/hour and 50/day lead budget.
 */
export function mountQuoteGate(router: Router) {
  const gateIpLimit = perIpLimit('quote-gate', 60 * 60_000, 5);
  const gateDailyCap = dailyCap('quote-gate', 50, 50);

  router.post(
    '/quote-lead',
    gateIpLimit,
    gateDailyCap,
    async (req: Request, res: Response) => {
      noStore(res);
      const parsed = gateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
      }
      if (!usPhoneDigits(parsed.data.phone)) {
        return res.status(400).json({ error: 'Please enter a valid US phone number.' });
      }

      const session = getQuoteSession(parsed.data.quoteId);
      if (!session) {
        return res.status(400).json({ error: 'Please confirm your address again.' });
      }

      try {
        const result = await openQuoteForContact(session, parsed.data, req);
        if (!result.ok) {
          return res.status(result.status).json({ error: result.error });
        }
        return res.json({
          ...result.body,
          token: result.token,
          leadCreated: result.leadCreated,
        });
      } catch (err) {
        console.error('quote gate error');
        return res.status(500).json({ error: 'Failed to save your information. Please call us directly.' });
      }
    },
  );

  router.post(
    '/quote-reveal',
    (req: Request, res: Response) => {
      noStore(res);
      const parsed = verifyQuoteToken(req.body?.token);
      if (!parsed) return res.status(401).json({ error: REVEAL_ERROR });
      const session = getQuoteSession(parsed.id);
      if (!session || !session.leadSent || !session.address) {
        return res.status(401).json({ error: REVEAL_ERROR });
      }
      return res.json({
        ...pricedBody(session),
        token: signQuoteToken(session.id, session.expiresAt),
        leadCreated: false,
      });
    },
  );
}
