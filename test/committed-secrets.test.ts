import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLOWED_EXACT, isObviouslyFake, JN_API_KEY_DUMMY, SEED_PASSWORD_DUMMY } from './allowed-literals';
import { formatFindings, scanText, scanTrackedSource } from './scan-secrets';

test('allowlist entries are obviously fake and matched exactly', () => {
  assert.ok(ALLOWED_EXACT.size > 0);
  for (const value of ALLOWED_EXACT) {
    if (!isObviouslyFake(value)) {
      throw new Error('allowlist contains a literal that is not obviously fake');
    }
  }
});

test('scanner flags a password literal and an API key fallback', () => {
  const quote = "'";
  const passwordLine = ['const row = { ', 'pass' + 'word', ': ', quote, 'staff-password-example', quote, ' }'].join('');
  const keyLine = ['process.env.', 'JOBNIMBUS_', 'API_KEY', ' || ', quote, 'committed-key-example', quote].join('');
  const passwordFindings = scanText('fixture.ts', passwordLine);
  const keyFindings = scanText('fixture.ts', keyLine);
  assert.equal(passwordFindings.length, 1);
  assert.equal(passwordFindings[0].kind, 'password');
  assert.equal(passwordFindings[0].line, 1);
  assert.equal(keyFindings.length, 1);
  assert.equal(keyFindings[0].kind, 'api-key');
});

test('scanner ignores an allowlisted dummy and empty env fallbacks', () => {
  const quote = "'";
  const keyAssignment = 'export const ' + 'JN_' + 'API_KEY' + '_DUMMY = ';
  const allowedKey = [keyAssignment, quote, JN_API_KEY_DUMMY, quote].join('');
  const allowedPassword = ['const row = { ', 'pass' + 'word', ': ', quote, SEED_PASSWORD_DUMMY, quote, ' }'].join('');
  const almost = [keyAssignment, quote, JN_API_KEY_DUMMY, '-extra', quote].join('');
  assert.equal(scanText('fixture.ts', allowedKey).length, 0);
  assert.equal(scanText('fixture.ts', allowedPassword).length, 0);
  assert.equal(scanText('fixture.ts', almost).length, 1);
  assert.equal(scanText('fixture.ts', "const API_KEY = process.env.ANTHROPIC_API_KEY || '';").length, 0);
});

test('tracked source has no committed API key or password literals', () => {
  const findings = scanTrackedSource(process.cwd());
  const summary = formatFindings(findings);
  assert.equal(findings.length, 0, summary ? `committed secrets:\n${summary}` : '');
});
