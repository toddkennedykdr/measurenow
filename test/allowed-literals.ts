// Obviously fake values used by tests. The secrets scan allowlists these exact strings only.
export const JN_API_KEY_DUMMY = 'jn-test-key-not-real';
export const JN_ALIAS_API_KEY_DUMMY = 'jn-alias-test-key-not-real';
export const SEED_PASSWORD_DUMMY = 'seed-test-password-not-real';
export const ENV_EXAMPLE_API_KEY_PLACEHOLDER = 'your_google_api_key_here';

export const ALLOWED_EXACT = new Set<string>([
  JN_API_KEY_DUMMY,
  JN_ALIAS_API_KEY_DUMMY,
  SEED_PASSWORD_DUMMY,
  ENV_EXAMPLE_API_KEY_PLACEHOLDER,
]);

export function isObviouslyFake(value: string): boolean {
  return value.endsWith('-not-real') || value === ENV_EXAMPLE_API_KEY_PLACEHOLDER;
}

export function isAllowedLiteral(value: string): boolean {
  return ALLOWED_EXACT.has(value) && isObviouslyFake(value);
}
