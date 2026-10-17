import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { isAllowlistedRoofLine, ROOF_FIXTURE_LINES } from './roof-secret-allowlist';

function piece(...parts: string[]): string {
  return parts.join('');
}

test('roof fixture allowlist matches only the known lines', () => {
  for (const rule of ROOF_FIXTURE_LINES) {
    assert.equal(isAllowlistedRoofLine(rule.file, rule.line, `  ${rule.text}`), true);
    assert.equal(isAllowlistedRoofLine(rule.file, rule.line + 1, rule.text), false);
    assert.equal(isAllowlistedRoofLine('other.ts', rule.line, rule.text), false);
  }
  assert.equal(ROOF_FIXTURE_LINES.length, 6);
});

test('secrets scan drops only those roof fixture lines', async () => {
  if (!fs.existsSync('test/scan-secrets.ts')) return;
  const { scanText } = await import('./scan-secrets.ts');
  const placeholders = [
    piece('GOOGLE_SOLAR_', 'API_KEY', '=', 'your_google_solar_server_key_here'),
    piece('GOOGLE_MAPS_', 'BROWSER_KEY', '=', 'your_browser_restricted_maps_key_here'),
    piece('ROOF_', 'API_KEY', '=', 'your_roof_api_key_here'),
  ].join('\n');
  assert.equal(scanText('.env.example', placeholders).length, 0);
  assert.equal(scanText('.env.example', '\n' + placeholders.split('\n')[0] + '\n').length, 1);
  const assignment = piece('process.env.ROOF_', 'API_KEY', " = '", 'server-secret', "';");
  assert.equal(scanText('other.ts', assignment + '\n').length, 1);
  const findings = scanText('server/middleware/roofAccess.test.ts', `${assignment}\n`.repeat(133));
  const keptLines = findings.map((finding: { line: number }) => finding.line);
  assert.equal(findings.length, 129);
  assert.equal([40, 62, 74, 133].some((line) => keptLines.includes(line)), false);
});
