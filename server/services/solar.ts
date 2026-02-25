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

    const data = await res.json();
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

    return {
      totalAreaSqFt,
      segments,
      avgPitch,
      imageryQuality: data.imageryQuality || quality,
    };
  }

  return null;
}
