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
