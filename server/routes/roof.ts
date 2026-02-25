import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { geocodeAddress } from '../services/geocode';
import { getBuildingInsights } from '../services/solar';
import { calculateQuote, type RoofQuote } from '../services/pricing';

export const roofRouter = Router();

const addressSchema = z.object({
  address: z.string().min(5, 'Please enter a valid address'),
});

roofRouter.post('/quote', async (req: Request, res: Response) => {
  try {
    const parsed = addressSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }

    const { address } = parsed.data;

    // Step 1: Geocode address
    const location = await geocodeAddress(address);
    if (!location) {
      return res.status(404).json({
        error: 'We couldn\'t find that address. Please check and try again.',
      });
    }

    // Step 2: Get building insights from Google Solar API
    const building = await getBuildingInsights(location.lat, location.lng);
    if (!building) {
      return res.status(404).json({
        error: 'We don\'t have roof data for this address yet. Please call us for a free estimate!',
      });
    }

    // Step 3: Calculate quote
    const quote = calculateQuote(building);

    return res.json({
      address: location.formattedAddress,
      lat: location.lat,
      lng: location.lng,
      roofData: {
        totalAreaSqFt: Math.round(building.totalAreaSqFt),
        segments: building.segments.length,
        avgPitchDegrees: Math.round(building.avgPitch * 10) / 10,
        imageryQuality: building.imageryQuality,
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
