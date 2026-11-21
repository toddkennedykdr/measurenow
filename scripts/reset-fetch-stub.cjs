// Preload for local password tests. Localhost stays real. Resend is stubbed.
// The message body is written to OUTBOUND_LOG only, never to the console.
const fs = require('fs');
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, opts) => {
  const target = String(url);
  if (target.startsWith('http://127.0.0.1') || target.startsWith('http://localhost')) {
    return realFetch(url, opts);
  }
  let host = 'unknown';
  try { host = new URL(target).host; } catch { /* leave unknown */ }
  console.log(`[fetch-stub] blocked outbound call to ${host}`);
  const delayMs = Number(process.env.OUTBOUND_DELAY_MS || '0');
  if (host === 'api.resend.com' && delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (host === 'api.resend.com' && process.env.OUTBOUND_LOG && opts && opts.body) {
    fs.appendFileSync(process.env.OUTBOUND_LOG, String(opts.body) + '\n');
  }
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
  if (host === 'maps.googleapis.com') {
    return json({
      status: 'OK',
      results: [{
        geometry: { location: { lat: 35.78, lng: -78.64 } },
        formatted_address: '1 Test St, Raleigh, NC',
      }],
    });
  }
  if (host === 'api.resend.com') return json({ id: 'stubbed' });
  return json({ error: 'stubbed' }, 500);
};
