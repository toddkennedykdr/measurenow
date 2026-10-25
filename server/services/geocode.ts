import { MapServiceError } from './mapService';

export interface GeoLocation {
  lat: number;
  lng: number;
  formattedAddress: string;
}

/** Read at call time so dotenv and tests can set the key before a request. */
function googleSolarApiKey(): string {
  return process.env.GOOGLE_SOLAR_API_KEY || '';
}

export async function geocodeAddress(address: string): Promise<GeoLocation | null> {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('key', googleSolarApiKey());

  let res: Response;
  try {
    res = await fetch(url.toString());
  } catch {
    // The thrown error can include the request URL, which carries the API key.
    console.error('Geocoding API error: network');
    throw new MapServiceError();
  }

  if (!res.ok) {
    console.error('Geocoding API error:', res.status);
    throw new MapServiceError();
  }

  let data: any;
  try {
    data = await res.json();
  } catch {
    console.error('Geocoding API error: invalid response');
    throw new MapServiceError();
  }

  if (data.status === 'ZERO_RESULTS') return null;

  const result = data.results?.[0];
  const lat = result?.geometry?.location?.lat;
  const lng = result?.geometry?.location?.lng;
  const formattedAddress = result?.formatted_address;
  if (
    data.status === 'OK' &&
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    typeof formattedAddress === 'string'
  ) {
    return { lat, lng, formattedAddress };
  }

  console.error('Geocoding API error:', data.status || 'unknown');
  throw new MapServiceError();
}
