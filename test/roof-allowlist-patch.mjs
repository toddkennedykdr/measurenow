import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PATCHED_PATH = path.join('/tmp', 'measurenow-scan-secrets.patched.ts');
const IMPORT_LINE = "import { isAllowedLiteral } from './allowed-literals';";
const RETURN_BLOCK = '  return findings;\n}\n\nexport function scanTrackedSource';
const FILTERED_RETURN =
  "  return findings.filter((finding) => !isAllowlistedRoofLine(file, finding.line, lines[finding.line - 1] ?? ''));\n}\n\nexport function scanTrackedSource";

export function isRealScanner(filePath) {
  return filePath.split(path.sep).join('/').endsWith('/test/scan-secrets.ts');
}

function patchSource(source, testDirHref) {
  if (!source.includes(IMPORT_LINE) || !source.includes(RETURN_BLOCK)) {
    throw new Error('roof allowlist hook could not patch test/scan-secrets.ts');
  }
  return source
    .replace(
      IMPORT_LINE,
      `import { isAllowedLiteral } from '${testDirHref}allowed-literals.ts';\nimport { isAllowlistedRoofLine } from '${testDirHref}roof-secret-allowlist.ts';`,
    )
    .replace(RETURN_BLOCK, FILTERED_RETURN);
}

export function writePatchedScanner(originalPath) {
  const testDirHref = pathToFileURL(path.dirname(originalPath) + path.sep).href;
  writeFileSync(PATCHED_PATH, patchSource(readFileSync(originalPath, 'utf8'), testDirHref));
  return PATCHED_PATH;
}

export function patchedScannerUrl(originalUrl) {
  return pathToFileURL(writePatchedScanner(fileURLToPath(originalUrl))).href;
}
