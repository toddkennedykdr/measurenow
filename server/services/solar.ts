import {
  SQ_M_TO_SQ_FT,
  imageryDateFromSolar,
  segmentBoxesFromStats,
  squareFeetFromMeters,
  type ImageryDateParts,
  type SegmentBox,
} from './quoteHonesty';

/** Read at call time so dotenv and tests can set the key before a request. */
function googleSolarApiKey(): string {
  return process.env.GOOGLE_SOLAR_API_KEY || '';
}

export interface RoofSegment {
  areaSqFt: number;
  pitchDegrees: number;
  azimuthDegrees: number;
}

export interface BuildingRoofData {
  totalAreaSqFt: number;
  segments: RoofSegment[];
  avgPitch: number;
  imageryQuality: string;
  footprintSqFt: number;
  estimatedPerimeterFt: number;
  estimatedLength: number;
  estimatedWidth: number;
  boundingBox: { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } } | null;
  /** Solar imageryDate. Null when the response did not include a usable date. */
  imageryDate: ImageryDateParts | null;
  /** Roof-segment boxes used to notice separate structures. Empty when none were returned. */
  segmentBoxes: SegmentBox[];
  /** wholeRoofStats roof area in sq ft, or null when omitted. */
  wholeRoofAreaSqFt: number | null;
  /** wholeRoofStats ground area in sq ft, or null when omitted. */
  wholeRoofGroundSqFt: number | null;
  /** buildingStats ground area in sq ft, or null when omitted. Not a county record. */
  buildingGroundSqFt: number | null;
}

/**
 * Calculate wall area from building footprint data + story count.
 * Returns { grossWallArea, netSidingArea, openingsDeduction }
 */
export function calculateWallArea(
  building: BuildingRoofData,
  stories: number = 2,
  wallHeightPerStory: number = 9,
  openingsPercent: number = 0.15
) {
  const totalWallHeight = stories * wallHeightPerStory;
  // Add gable end area: triangular area above wall plate on gabled ends
  // Estimate: ~8% of gross wall area for typical gable contributions
  const baseWallArea = building.estimatedPerimeterFt * totalWallHeight;
  const gableArea = baseWallArea * 0.08;
  const grossWallArea = Math.round(baseWallArea + gableArea);
  const openingsArea = Math.round(grossWallArea * openingsPercent);
  const netSidingArea = grossWallArea - openingsArea;
  return { grossWallArea, netSidingArea, openingsArea, totalWallHeight };
}

export async function getBuildingInsights(
  lat: number,
  lng: number
): Promise<BuildingRoofData | null> {
  // Try HIGH quality first, then fall back
  for (const quality of ['HIGH', 'MEDIUM'] as const) {
    const url = new URL('https://solar.googleapis.com/v1/buildingInsights:findClosest');
    url.searchParams.set('location.latitude', lat.toString());
    url.searchParams.set('location.longitude', lng.toString());
    url.searchParams.set('requiredQuality', quality);
    url.searchParams.set('key', googleSolarApiKey());

    const res = await fetch(url.toString());
    if (res.status === 404) continue; // quality not available, try next
    if (!res.ok) {
      // Status only. The request URL, and some error bodies, contain the API key.
      console.error(`Solar API error (${quality}):`, res.status);
      continue;
    }

    const data: any = await res.json();
    const solar = data.solarPotential;
    if (!solar?.roofSegmentStats?.length) continue;

    const segments: RoofSegment[] = solar.roofSegmentStats.map((seg: any) => ({
      areaSqFt: (seg.stats?.areaMeters2 || 0) * SQ_M_TO_SQ_FT,
      pitchDegrees: seg.pitchDegrees || 0,
      azimuthDegrees: seg.azimuthDegrees || 0,
    }));

    const totalAreaSqFt = segments.reduce((sum, s) => sum + s.areaSqFt, 0);
    const avgPitch =
      segments.reduce((sum, s) => sum + s.pitchDegrees * s.areaSqFt, 0) / totalAreaSqFt;

    // Calculate building footprint from roof segments (horizontal projection)
    const footprintSqFt = segments.reduce((sum, s) => {
      const pitchRad = (s.pitchDegrees * Math.PI) / 180;
      return sum + s.areaSqFt * Math.cos(pitchRad);
    }, 0);

    // Extract bounding box if available
    let boundingBox: BuildingRoofData['boundingBox'] = null;
    if (data.boundingBox) {
      boundingBox = {
        sw: { lat: data.boundingBox.sw?.latitude || 0, lng: data.boundingBox.sw?.longitude || 0 },
        ne: { lat: data.boundingBox.ne?.latitude || 0, lng: data.boundingBox.ne?.longitude || 0 },
      };
    }

    // Estimate building dimensions from footprint
    // Use bounding box aspect ratio if available, otherwise assume square-ish
    let aspectRatio = 1.0;
    if (boundingBox && boundingBox.sw.lat && boundingBox.ne.lat) {
      const latDiff = Math.abs(boundingBox.ne.lat - boundingBox.sw.lat);
      const lngDiff = Math.abs(boundingBox.ne.lng - boundingBox.sw.lng);
      // Convert to approximate feet (1 degree lat ≈ 364,000 ft, lng varies by cos(lat))
      const latFt = latDiff * 364000;
      const centerLat = (boundingBox.ne.lat + boundingBox.sw.lat) / 2;
      const lngFt = lngDiff * 364000 * Math.cos((centerLat * Math.PI) / 180);
      if (latFt > 0 && lngFt > 0) {
        aspectRatio = Math.max(latFt, lngFt) / Math.min(latFt, lngFt);
      }
    }

    // For footprint area A and aspect ratio r: length = sqrt(A * r), width = sqrt(A / r)
    const estimatedLength = Math.sqrt(footprintSqFt * aspectRatio);
    const estimatedWidth = Math.sqrt(footprintSqFt / aspectRatio);
    // Base rectangular perimeter, then apply complexity factor.
    // Real houses (L-shapes, bump-outs, porches, garages) have 20-40% more perimeter
    // than a simple rectangle of the same area. Use 1.30 as default multiplier.
    const basePerimeter = 2 * (estimatedLength + estimatedWidth);
    const complexityMultiplier = 1.30;
    const estimatedPerimeterFt = basePerimeter * complexityMultiplier;

    return {
      totalAreaSqFt,
      segments,
      avgPitch,
      imageryQuality: data.imageryQuality || quality,
      footprintSqFt: Math.round(footprintSqFt),
      estimatedPerimeterFt: Math.round(estimatedPerimeterFt),
      estimatedLength: Math.round(estimatedLength),
      estimatedWidth: Math.round(estimatedWidth),
      boundingBox,
      imageryDate: imageryDateFromSolar(data.imageryDate),
      segmentBoxes: segmentBoxesFromStats(solar.roofSegmentStats),
      wholeRoofAreaSqFt: squareFeetFromMeters(solar.wholeRoofStats?.areaMeters2),
      wholeRoofGroundSqFt: squareFeetFromMeters(solar.wholeRoofStats?.groundAreaMeters2),
      buildingGroundSqFt: squareFeetFromMeters(solar.buildingStats?.groundAreaMeters2),
    };
  }

  return null;
}
