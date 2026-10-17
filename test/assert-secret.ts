// Compare credential-shaped strings without putting either value in the error.
export function assertExact(actual: unknown, expected: string, label: string): void {
  if (typeof actual !== 'string' || actual !== expected) {
    throw new Error(`${label} did not match the expected test literal`);
  }
}
