import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENV_EXAMPLE_API_KEY_PLACEHOLDER, JN_API_KEY_DUMMY, isAllowedLiteral } from './allowed-literals';
import { scanText } from './scan-secrets';

function piece(...parts: string[]): string {
  return parts.join('');
}

test('roof fixtures use allowlisted fakes and other keys stay flagged', () => {
  assert.equal(isAllowedLiteral(ENV_EXAMPLE_API_KEY_PLACEHOLDER), true);
  assert.equal(isAllowedLiteral(JN_API_KEY_DUMMY), true);
  assert.equal(isAllowedLiteral(piece('server', '-secret')), false);

  const envExample = [
    piece('GOOGLE_SOLAR_', 'API_KEY', '=', ENV_EXAMPLE_API_KEY_PLACEHOLDER),
    piece('ROOF_', 'API_KEY', '=', JN_API_KEY_DUMMY),
  ].join('\n');
  assert.equal(scanText('.env.example', envExample).length, 0);

  const assignment = piece('process.env.ROOF_', 'API_KEY', " = '", JN_API_KEY_DUMMY, "';");
  assert.equal(scanText('server/middleware/roofAccess.test.ts', assignment).length, 0);

  const blocked = piece('process.env.ROOF_', 'API_KEY', " = '", 'server', '-secret', "';");
  assert.equal(scanText('other.ts', blocked).length, 1);
  assert.equal(scanText('.env.example', piece('ROOF_', 'API_KEY', '=', 'server', '-secret')).length, 1);
});
