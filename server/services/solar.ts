const API_KEY = process.env.GOOGLE_SOLAR_API_KEY || '';
const SQ_M_TO_SQ_FT = 10.764;

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
}

/**
 * Calculate wall area from building footprint data + story count.
 * Returns { grossWallArea, netSidingArea, openingsDeduction }
 */
export function calculateWallArea(
  building: BuildingRoofData,
  stories: number = 2,
  wallHeightPerStory: number = 9,
  openingsPercent: number = 0.18
) {
  const totalWallHeight = stories * wallHeightPerStory;
  const grossWallArea = Math.round(building.estimatedPerimeterFt * totalWallHeight);
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
    url.searchParams.set('key', API_KEY);

    const res = await fetch(url.toString());
    if (res.status === 404) continue; // quality not available, try next
    if (!res.ok) {
      const body = await res.text();
      console.error(`Solar API error (${quality}):`, res.status, body);
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
    const estimatedPerimeterFt = 2 * (estimatedLength + estimatedWidth);

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
    };
  }

  return null;
}
