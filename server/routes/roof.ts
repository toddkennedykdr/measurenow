import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { roofApiKeyMatches } from '../middleware/roofAccess';
import { rejectIfPublicDailyCap } from '../publicDailyCap';
import { buildAddressRoofReport } from '../services/addressReport';
import { geocodeAddress } from '../services/geocode';
import { getBuildingInsights } from '../services/solar';

export const roofRouter = Router();

/** Quotes, commas, and whitespace must not disguise the Solar key. */
function normalizeKey(value: string | undefined): string {
  return (value ?? '').replace(/['"`,\s]+/g, '').toLowerCase();
}

// Browser-restricted Maps JavaScript API key. Never the Solar server key.
roofRouter.get('/maps-key', (_req: Request, res: Response) => {
  const browserRaw = process.env.GOOGLE_MAPS_BROWSER_KEY ?? '';
  const solarNorm = normalizeKey(process.env.GOOGLE_SOLAR_API_KEY);
  const browserNorm = normalizeKey(browserRaw);
  // The map runs in the browser, so it gets only the referrer-restricted Maps key.
  // Any browser value that still contains the Solar key after normalization is withheld.
  const key = solarNorm !== '' && browserNorm.includes(solarNorm) ? '' : browserRaw.trim();
  res.json({ key });
});

/** Staff sessions and a valid ROOF_API_KEY do not use the public daily cap. */
function skipsPublicDailyCap(req: Request): boolean {
  if ((req.session as { userId?: number } | undefined)?.userId) return true;
  return roofApiKeyMatches(req.header('x-api-key'));
}

const addressSchema = z.object({
  address: z.string().min(5, 'Please enter a valid address'),
});

const quoteSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const addressReportSchema = quoteSchema.extend({
  address: z.string().optional(),
});

const QUOTE_NO_ROOF_DATA = "We don't have roof data for this location yet. Please call us for a free estimate!";
const ADDRESS_REPORT_NO_ROOF_DATA = "We don't have roof data for this location yet. Call K&D Roofing at (919) 977-4074 to schedule a documented inspection.";

// Step 1: Geocode only — returns lat/lng and formatted address
roofRouter.post('/geocode', async (req: Request, res: Response) => {
  try {
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    if (!skipsPublicDailyCap(req) && rejectIfPublicDailyCap(res)) return;

    const location = await geocodeAddress(parsed.data.address);
    if (!location) {
      return res.status(404).json({
        error: "We couldn't find that address. Please check and try again.",
      });
    }

    return res.json({
      address: location.formattedAddress,
      lat: location.lat,
      lng: location.lng,
    });
  } catch (err: any) {
    console.error('Geocode error:', err.message || err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Step 2: Get quote using confirmed lat/lng
roofRouter.post('/quote', async (req: Request, res: Response) => {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid coordinates.' });
    }
    if (!skipsPublicDailyCap(req) && rejectIfPublicDailyCap(res)) return;

    const { lat, lng } = parsed.data;

    const building = await getBuildingInsights(lat, lng);
    if (!building) {
      return res.status(404).json({ error: QUOTE_NO_ROOF_DATA });
    }

    const report = buildAddressRoofReport(building);

    return res.json({
      lat,
      lng,
      roofData: report.roofData,
      quote: report.quote,
    });
  } catch (err: any) {
    console.error('Quote error:', err.message || err);
    return res.status(500).json({
      error: 'Something went wrong generating your quote. Please try again or call us directly.',
    });
  }
});

// Address-only roof report. Same satellite data as /quote, plus wall
// measurements. Photos are not accepted and Gemini is not called.
roofRouter.post('/address-report', async (req: Request, res: Response) => {
  try {
    const parsed = addressReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid coordinates.' });
    }

    const { lat, lng, address } = parsed.data;
    const building = await getBuildingInsights(lat, lng);
    if (!building) {
      return res.status(404).json({ error: ADDRESS_REPORT_NO_ROOF_DATA });
    }

    const report = buildAddressRoofReport(building);
    return res.json({
      lat,
      lng,
      address: address || '',
      ...report,
    });
  } catch (err: any) {
    console.error('Address report error:', err.message || err);
    return res.status(500).json({
      error: 'Something went wrong generating your roof report. Please try again or call us directly.',
    });
  }
});
