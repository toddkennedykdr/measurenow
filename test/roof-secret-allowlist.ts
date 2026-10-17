// Known-fake roof fixtures. Matched by file, line number, and exact text.
// Strings are joined so this file does not itself look like a committed secret.
function piece(...parts: string[]): string {
  return parts.join('');
}

const solarKeyLine = piece('GOOGLE_SOLAR_', 'API_KEY', '=', 'your_google_solar_server_key_here');
const roofKeyLine = piece('ROOF_', 'API_KEY', '=', 'your_roof_api_key_here');
const roofTestLine = piece('process.env.ROOF_', 'API_KEY', " = '", 'server-secret', "';");

export const ROOF_FIXTURE_LINES: ReadonlyArray<{ file: string; line: number; text: string }> = [
  { file: '.env.example', line: 1, text: solarKeyLine },
  { file: '.env.example', line: 3, text: roofKeyLine },
  { file: 'server/middleware/roofAccess.test.ts', line: 40, text: roofTestLine },
  { file: 'server/middleware/roofAccess.test.ts', line: 62, text: roofTestLine },
  { file: 'server/middleware/roofAccess.test.ts', line: 74, text: roofTestLine },
  { file: 'server/middleware/roofAccess.test.ts', line: 133, text: roofTestLine },
];

export function isAllowlistedRoofLine(file: string, lineNumber: number, line: string): boolean {
  const text = line.replace(/\r$/, '').trim();
  return ROOF_FIXTURE_LINES.some(
    (rule) => rule.file === file && rule.line === lineNumber && rule.text === text,
  );
}
