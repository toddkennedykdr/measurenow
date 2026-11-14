// Test preload: stub outbound fetch (no JobNimbus or Resend) and record those bodies.
const fs = require('fs');
require('./fetch-stub.cjs');
const stub = global.fetch;
const file = process.env.OUTBOUND_LOG;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (file && !u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost')) {
    fs.appendFileSync(file, JSON.stringify({
      url: u,
      method: opts.method || 'GET',
      body: opts.body ? String(opts.body) : '',
    }) + '\n');
  }
  return stub(url, opts);
};
