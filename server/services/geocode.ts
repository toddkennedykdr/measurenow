const API_KEY = process.env.GOOGLE_SOLAR_API_KEY || '';

/** About 0.11 m. Absorbs float noise on the same point, not a moved pin. */
const GEOCODE_MATCH_DEGREES = 1e-6;
const GEOCODE_TTL_MS = 30 * 60 * 1000;
const GEOCODE_MAX = 500;

type RememberedGeocode = { lat: number; lng: number; address: string; at: number };
const rememberedGeocodes: RememberedGeocode[] = [];

function sweepGeocodes(now = Date.now()) {
  for (let i = rememberedGeocodes.length - 1; i >= 0; i -= 1) {
    if (now - rememberedGeocodes[i].at > GEOCODE_TTL_MS) rememberedGeocodes.splice(i, 1);
  }
}

/** Remember a formatted address this server just received from Google geocoding. */
export function rememberServerGeocode(lat: number, lng: number, address: string) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !address) return;
  const now = Date.now();
  sweepGeocodes(now);
  rememberedGeocodes.push({ lat, lng, address, at: now });
  while (rememberedGeocodes.length > GEOCODE_MAX) rememberedGeocodes.shift();
}

/**
 * The formatted address for this lat/lng, only if it matches a stored server geocode.
 * Tolerance is 1e-6 degrees on each axis. Client-sent text is never consulted.
 */
export function recallServerGeocode(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const now = Date.now();
  sweepGeocodes(now);
  let match: RememberedGeocode | null = null;
  for (const item of rememberedGeocodes) {
    if (Math.abs(item.lat - lat) > GEOCODE_MATCH_DEGREES || Math.abs(item.lng - lng) > GEOCODE_MATCH_DEGREES) continue;
    if (!match || item.at >= match.at) match = item;
  }
  return match ? match.address : null;
}

export interface GeoLocation {
  lat: number;
  lng: number;
  formattedAddress: string;
}

export async function geocodeAddress(address: string): Promise<GeoLocation | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', API_KEY);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding API error: ${res.status}`);
  }

  const data: any = await res.json();
  if (data.status !== 'OK' || !data.results?.length) {
    return null;
  }

  const result = data.results[0];
  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    formattedAddress: result.formatted_address,
  };
}
