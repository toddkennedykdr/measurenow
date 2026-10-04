import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { geocodeAddress } from '../services/geocode';
import { getBuildingInsights } from '../services/solar';
import { calculateQuote, type RoofQuote } from '../services/pricing';
import { perIpLimit, dailyCap } from '../middleware/security';

export const roofRouter = Router();

// Expose API key for Google Maps JavaScript API on the frontend.
// Stays public: the public homeowner flow needs it (src/components/ConfirmAddress.tsx:60).
// Protection is GCP-side (referrer + API restrictions on a browser-only key).
roofRouter.get('/maps-key', (_req: Request, res: Response) => {
  res.json({ key: process.env.GOOGLE_SOLAR_API_KEY || '' });
});

const addressSchema = z.object({
  address: z.string().min(5, 'Please enter a valid address'),
});

const quoteSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

// Public paid endpoints: per-IP limit (staff exempt) + daily global cap (fails closed with 429).
const geocodeIpLimit = perIpLimit('geocode', 60 * 60_000, 20);
const quoteIpLimit = perIpLimit('quote', 60 * 60_000, 20);
const geocodeCap = dailyCap('geocode', 150, 500);
const quoteCap = dailyCap('quote', 150, 500);

// Step 1: Geocode only — returns lat/lng and formatted address
roofRouter.post('/geocode', geocodeIpLimit, geocodeCap, async (req: Request, res: Response) => {
  try {
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

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
roofRouter.post('/quote', quoteIpLimit, quoteCap, async (req: Request, res: Response) => {
  try {
    const parsed = quoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid coordinates.' });
    }

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
  } catch (err: any) {
    console.error('Quote error:', err.message || err);
    return res.status(500).json({
      error: 'Something went wrong generating your quote. Please try again or call us directly.',
    });
  }
});
