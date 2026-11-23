// Preloaded into the server for smoke tests: stubs ALL outbound fetch so no paid
// Google / Anthropic / Resend / JobNimbus call can happen.
const realFetch = globalThis.fetch;
globalThis.__outbound = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1') || u.startsWith('http://localhost')) return realFetch(url, opts);
  const host = new URL(u).host;
  console.log(`[fetch-stub] blocked outbound call to ${host}`);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  if (host === 'maps.googleapis.com') {
    if (u.includes('/maps/api/staticmap')) {
      const delay = Number(process.env.STUB_STATICMAP_DELAY_MS || '0');
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return json({ status: 'OK', results: [{ geometry: { location: { lat: 35.78, lng: -78.64 } }, formatted_address: '1 Test St, Raleigh, NC' }] });
  }
  if (host === 'solar.googleapis.com') {
    return json({
      imageryQuality: 'HIGH',
      boundingBox: { sw: { latitude: 35.7799, longitude: -78.6402 }, ne: { latitude: 35.7801, longitude: -78.6398 } },
      solarPotential: { roofSegmentStats: [
        { pitchDegrees: 22, azimuthDegrees: 180, stats: { areaMeters2: 100 } },
        { pitchDegrees: 22, azimuthDegrees: 0, stats: { areaMeters2: 100 } },
      ] },
    });
  }
  return json({ error: 'stubbed' }, 500);
};
