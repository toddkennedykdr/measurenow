const API_KEY = process.env.GOOGLE_SOLAR_API_KEY || '';

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

  const data = await res.json();
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
