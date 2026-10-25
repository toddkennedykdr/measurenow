import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { roofApiKeyMatches } from '../middleware/roofAccess';
import { rejectIfPublicDailyCap } from '../publicDailyCap';
import { geocodeAddress } from '../services/geocode';
import { MAP_SERVICE_ERROR, MapServiceError } from '../services/mapService';
import { getBuildingInsights } from '../services/solar';
import { calculateQuote, type RoofQuote } from '../services/pricing';
import { rejectIfSpam } from '../spamGuard';

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
  address: z.string().trim().min(5, 'Please enter a valid address').max(300, 'Please enter a shorter address.'),
});

const quoteSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

// Step 1: Geocode only — returns lat/lng and formatted address
roofRouter.post('/geocode', async (req: Request, res: Response) => {
  try {
    // Per-IP limiting stays on roofRateLimit (req.ip, one trusted proxy hop).
    // Staff and a roof API key already skip the public daily cap. They also
    // skip the public honeypot and timer.
    if (!skipsPublicDailyCap(req) && rejectIfSpam(req.body, res)) return;
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
  } catch (err: unknown) {
    if (err instanceof MapServiceError) {
      console.error('Geocode error: map service unavailable');
      return res.status(503).json({ error: MAP_SERVICE_ERROR });
    }
    console.error('Geocode error:', err instanceof Error ? err.name : 'Error');
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Step 2: Get quote using confirmed lat/lng
roofRouter.post('/quote', async (req: Request, res: Response) => {
  try {
    if (!skipsPublicDailyCap(req) && rejectIfSpam(req.body, res)) return;
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid coordinates.' });
    }
    if (!skipsPublicDailyCap(req) && rejectIfPublicDailyCap(res)) return;

    const { lat, lng } = parsed.data;

    const building = await getBuildingInsights(lat, lng);
    if (!building) {
      return res.status(404).json({
        error: "We don't have roof data for this location yet. Please call us for a free estimate!",
      });
    }

    const quote = calculateQuote(building);

    return res.json({
      lat,
      lng,
      roofData: {
        totalAreaSqFt: Math.round(building.totalAreaSqFt),
        segments: building.segments.length,
        avgPitchDegrees: Math.round(building.avgPitch * 10) / 10,
        imageryQuality: building.imageryQuality,
        footprintSqFt: building.footprintSqFt,
        estimatedPerimeterFt: building.estimatedPerimeterFt,
        estimatedLength: building.estimatedLength,
        estimatedWidth: building.estimatedWidth,
      },
      quote,
    });
  } catch (err: unknown) {
    if (err instanceof MapServiceError) {
      console.error('Quote error: map service unavailable');
      return res.status(503).json({ error: MAP_SERVICE_ERROR });
    }
    console.error('Quote error:', err instanceof Error ? err.name : 'Error');
    return res.status(500).json({
      error: 'Something went wrong generating your quote. Please try again or call us directly.',
    });
  }
});
