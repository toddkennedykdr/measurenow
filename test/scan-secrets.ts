import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// Separate import: the roof-route allowlist hook patches this exact line.
import { isAllowedLiteral } from './allowed-literals';
import { ALLOWED_FILE_LINES } from './allowed-literals';

export type SecretKind = 'api-key' | 'password';

export type SecretFinding = {
  file: string;
  line: number;
  kind: SecretKind;
};

export type ScanOptions = {
  /** Extra exact "file:line" exemptions. The committed set stays in ALLOWED_FILE_LINES. */
  allowedLines?: ReadonlySet<string>;
};

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const TEXT_EXT = new Set(['.json', '.md', '.sh']);
const CONFIG_EXT = new Set(['.yml', '.yaml', '.toml', '.html', '.htm']);

const PASSWORD_LITERAL = /(?<![A-Za-z0-9_])(?:password|passwd|pwd)(?![A-Za-z0-9_])\s*[:=]\s*(['"`])([^'"`\n]+)\1/gi;
const OR_FALLBACK = /(?:\|\||\?\?)\s*(['"`])([^'"`\n]*)\1/g;
const ENV_TERNARY = /process\.env\.([A-Za-z0-9_]+)\s*\?[^:\n]*:\s*(['"`])([^'"`\n]*)\2/g;
const ENV_ASSIGN = /process\.env\.([A-Za-z0-9_]+)\s*=\s*(['"`])([^'"`\n]*)\2/g;
const IDENT_ASSIGN = /(?<![.A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"`])([^'"`\n]+)\2/g;
const KEY_VALUE = /(?<!\?\s*)(?<![A-Za-z0-9_])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:\s*(['"`])([^'"`\n]+)\3/g;
// A token, not the word after "Bearer" in prose.
const BEARER_LITERAL = /Bearer\s+([A-Za-z0-9_\-.]{12,})/g;
const BASIC_LITERAL = /Basic\s+([A-Za-z0-9+/=]{16,})/g;
const HASH_SYNC_LITERAL = /\bhashSync\s*\(\s*(['"`])([^'"`\n]+)\1/g;
const KNOWN_PREFIX = /AIza[0-9A-Za-z\-_]{20,}|sk-(?:proj-)?[A-Za-z0-9_\-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|re_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}/g;
const ENV_REF = /process\.env\.([A-Za-z0-9_]+)/g;
const CONST_BINDING = /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
const KEY_NAME = /(?<!\?\s*)(?<![A-Za-z0-9_])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:/g;
const CONFIG_UNQUOTED = /([A-Za-z_][A-Za-z0-9_-]*)\s*(?:=|:)\s*([^\s'"`#,{}[\]<>]+)/g;
const DOCKER_ENV = /\bENV\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+|=)(['"`]?)([^\s'"`]+)\2/gi;
const COMMENTED_ASSIGN = /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\s'"`;#]+)/g;
const COMMENTED_BARE_KEY = /(?:^|[^A-Za-z0-9_])key\s*[:=]\s*(?:(['"`])([^'"`\n]+)\1|([^\s'"`;#]+))/gi;

const FUNCTION_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'our', 'your', 'to', 'of', 'for',
  'and', 'with', 'in', 'on', 'we', 'this', 'that', 'it',
]);

function allMatches(re: RegExp, line: string): RegExpMatchArray[] {
  re.lastIndex = 0;
  return [...line.matchAll(re)];
}

export function isCredentialName(name: string): boolean {
  if (/api[-_]?key/i.test(name) || /apiKey/.test(name)) {
    // API_KEY_HEADER stores the header name, not the key.
    return !/header$/i.test(name);
  }
  if (/(?:^|_)(?:password|passwd|pwd|secret|token)$/i.test(name)) return true;
  if (/[a-z](?:Password|Passwd|Pwd|Secret|Token)$/.test(name)) return true;
  // Bare `key` is a column or keyboard field. STORAGE_KEY is a local name.
  if (/^key$/i.test(name)) return false;
  if (/storage[-_]?key$/i.test(name) || /StorageKey$/.test(name)) return false;
  if (/(?:^|_)key$/i.test(name)) return true;
  return false;
}

function kindForName(name: string): SecretKind {
  if (/(?:^|_)(?:password|passwd|pwd)$/i.test(name) || /(?:Password|Passwd|Pwd)$/.test(name)) {
    return 'password';
  }
  return 'api-key';
}

function kindForNames(names: string[]): SecretKind {
  for (const name of names) {
    if (kindForName(name) === 'password') return 'password';
  }
  return 'api-key';
}

// Empty values and obvious placeholders are not secrets.
// This is separate from the exact-value allowlist.
function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (/^your[-_][A-Za-z0-9_-]*here$/i.test(trimmed)) return true;
  if (/^<your\b[^<>]*>$/i.test(trimmed)) return true;
  if (/^change[-_]?me$/i.test(trimmed)) return true;
  return false;
}

function isLabelValue(value: string): boolean {
  return /^(?:password|passwd|pwd|secret|token|api[-_ ]?key|key)$/i.test(value.trim());
}

function looksLikeEmbeddedSecret(value: string): boolean {
  return /[A-Za-z0-9_+/=-]{20,}/.test(value);
}

function isValidationMessage(value: string): boolean {
  if (!/\s/.test(value) || looksLikeEmbeddedSecret(value)) return false;
  return /\b(?:required|invalid|must|please|at least|too short|too long|does not match|do not match)\b/i.test(value);
}

function isUiCopy(value: string): boolean {
  const trimmed = value.trim();
  if (!/\s/.test(trimmed) || looksLikeEmbeddedSecret(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length < 3) return false;
  if (!words.every((word) => /^[A-Za-z][A-Za-z'.,!?-]*$/.test(word))) return false;
  return words.some((word) => FUNCTION_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, '')));
}

// Placeholders, labels, validation text, and UI copy. Allowlisted fakes are separate
// so a || / ?? fallback of a dummy still flags.
function isNonSecretText(value: string): boolean {
  return isPlaceholder(value) || isLabelValue(value) || isValidationMessage(value) || isUiCopy(value);
}

function isBenignLiteral(value: string): boolean {
  return isNonSecretText(value) || isAllowedLiteral(value);
}

function isConcreteSecret(value: string): boolean {
  const trimmed = value.trim().replace(/[,;]+$/, '');
  if (!trimmed || isBenignLiteral(trimmed)) return false;
  if (/[${}()[\]]/.test(trimmed)) return false;
  if (trimmed.includes('process.env')) return false;
  if (/^(?:true|false|null|undefined|yes|no|~)$/i.test(trimmed)) return false;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return false;
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(trimmed) && trimmed.includes('.')) return false;
  return true;
}

function isBearerToken(token: string): boolean {
  if (token.length < 12 || isBenignLiteral(token)) return false;
  // "Bearer authentication" is prose. Tokens are mixed case, punctuated, or long.
  if (/^[a-z]+$/.test(token) && token.length < 24) return false;
  return true;
}

function isBasicCredential(token: string): boolean {
  if (token.length < 16 || isBenignLiteral(token)) return false;
  if (/^[a-z]+$/.test(token)) return false;
  return true;
}

function lineKey(file: string, line: number): string {
  return `${file.split('\\').join('/')}:${line}`;
}

function isLineExempt(file: string, line: number, options?: ScanOptions): boolean {
  const key = lineKey(file, line);
  return ALLOWED_FILE_LINES.has(key) || Boolean(options?.allowedLines?.has(key));
}

function credentialNames(line: string): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    if (isCredentialName(name)) names.push(name);
  };
  for (const match of allMatches(ENV_REF, line)) add(match[1]);
  for (const match of allMatches(CONST_BINDING, line)) add(match[1]);
  for (const match of allMatches(KEY_NAME, line)) add(match[2]);
  return names;
}

function fallbackKind(line: string): SecretKind | null {
  const names = credentialNames(line);
  if (names.length > 0) {
    for (const match of allMatches(OR_FALLBACK, line)) {
      // || / ?? fallbacks stay flagged even when the value is an exact test dummy.
      if (!isNonSecretText(match[2])) return kindForNames(names);
    }
  }
  for (const match of allMatches(ENV_TERNARY, line)) {
    if (isCredentialName(match[1]) && !isNonSecretText(match[3])) return kindForName(match[1]);
  }
  for (const match of allMatches(ENV_ASSIGN, line)) {
    if (isCredentialName(match[1]) && !isBenignLiteral(match[3])) return kindForName(match[1]);
  }
  return null;
}

function isEnvFile(file: string): boolean {
  const base = path.basename(file);
  return base === '.env' || base.startsWith('.env.');
}

function isDockerfile(file: string): boolean {
  const base = path.basename(file);
  return base === 'Dockerfile' || base.startsWith('Dockerfile.');
}

function isComposeFile(file: string): boolean {
  const base = path.basename(file).toLowerCase();
  return base === 'docker-compose' || base.startsWith('docker-compose.');
}

function shouldScan(file: string): 'code' | 'env' | 'text' | 'config' | null {
  if (path.basename(file) === 'package-lock.json' || file.endsWith('.lock')) return null;
  if (isEnvFile(file)) return 'env';
  if (isDockerfile(file) || isComposeFile(file)) return 'config';
  const ext = path.extname(file).toLowerCase();
  if (CODE_EXT.has(ext)) return 'code';
  if (TEXT_EXT.has(ext)) return 'text';
  if (CONFIG_EXT.has(ext)) return 'config';
  return null;
}

function unquoteEnvValue(raw: string): string {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function scanEnvLine(file: string, lineNo: number, line: string, options?: ScanOptions): SecretFinding | null {
  if (isLineExempt(file, lineNo, options)) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!match) return null;
  const name = match[1];
  const value = unquoteEnvValue(match[2]);
  if (!value || !isCredentialName(name) || isBenignLiteral(value)) return null;
  return { file, line: lineNo, kind: kindForName(name) };
}

function commentBodies(line: string): string[] {
  const bodies: string[] = [];
  const slashAt = line.search(/(^|[^:])\/\//);
  if (slashAt >= 0) {
    const start = line.indexOf('//', slashAt);
    if (start >= 0) bodies.push(line.slice(start + 2));
  }
  if (/^\s*#(?!!)/.test(line)) bodies.push(line.replace(/^\s*#\s?/, ''));
  const block = line.match(/\/\*([\s\S]*?)\*\//);
  if (block) bodies.push(block[1]);
  return bodies;
}

function hasKnownPrefix(value: string): boolean {
  KNOWN_PREFIX.lastIndex = 0;
  const found = KNOWN_PREFIX.test(value);
  KNOWN_PREFIX.lastIndex = 0;
  return found;
}

// Long, mixed, or prefixed. Short words such as "address" and "Escape" are not secrets.
function isSecretShaped(value: string): boolean {
  const trimmed = value.trim().replace(/[,;]+$/, '');
  if (!trimmed || isBenignLiteral(trimmed)) return false;
  if (hasKnownPrefix(trimmed)) return true;
  if (trimmed.length < 12) return false;
  if (/^[a-z]+$/.test(trimmed) || /^[A-Z]+$/.test(trimmed)) return false;
  return /\d/.test(trimmed) || (/[a-z]/.test(trimmed) && /[A-Z]/.test(trimmed)) || /[^A-Za-z0-9]/.test(trimmed);
}

function commentedAssignmentKind(line: string): SecretKind | null {
  for (const body of commentBodies(line)) {
    for (const match of allMatches(COMMENTED_ASSIGN, body)) {
      const value = match[2].replace(/[,;]+$/, '');
      if (isCredentialName(match[1]) && isConcreteSecret(value)) return kindForName(match[1]);
    }
    for (const match of allMatches(COMMENTED_BARE_KEY, body)) {
      const value = match[2] || match[3] || '';
      if (isSecretShaped(value)) return 'api-key';
    }
  }
  return null;
}

function scanConfigLine(file: string, lineNo: number, line: string, options?: ScanOptions): SecretFinding | null {
  if (isLineExempt(file, lineNo, options)) return null;
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  for (const match of allMatches(DOCKER_ENV, line)) {
    const value = unquoteEnvValue(match[3]);
    if (isCredentialName(match[1]) && isConcreteSecret(value)) {
      return { file, line: lineNo, kind: kindForName(match[1]) };
    }
  }
  for (const match of allMatches(CONFIG_UNQUOTED, line)) {
    const value = match[2].replace(/[,;]+$/, '');
    if (isCredentialName(match[1]) && isConcreteSecret(value)) {
      return { file, line: lineNo, kind: kindForName(match[1]) };
    }
  }
  return null;
}

function scanCodeLine(file: string, lineNo: number, line: string, options?: ScanOptions): SecretFinding[] {
  if (isLineExempt(file, lineNo, options)) return [];
  const findings: SecretFinding[] = [];
  const add = (kind: SecretKind) => {
    if (!findings.some((finding) => finding.kind === kind)) {
      findings.push({ file, line: lineNo, kind });
    }
  };

  for (const match of allMatches(PASSWORD_LITERAL, line)) {
    if (!isBenignLiteral(match[2])) {
      add('password');
      break;
    }
  }
  for (const match of allMatches(HASH_SYNC_LITERAL, line)) {
    if (!isBenignLiteral(match[2])) {
      add('password');
      break;
    }
  }

  const fallback = fallbackKind(line);
  if (fallback) add(fallback);

  for (const match of allMatches(IDENT_ASSIGN, line)) {
    if (isCredentialName(match[1]) && !isBenignLiteral(match[3])) {
      add(kindForName(match[1]));
      break;
    }
  }
  for (const match of allMatches(KEY_VALUE, line)) {
    if (isCredentialName(match[2]) && !isBenignLiteral(match[4])) {
      add(kindForName(match[2]));
      break;
    }
  }
  for (const match of allMatches(BEARER_LITERAL, line)) {
    if (isBearerToken(match[1])) {
      add('api-key');
      break;
    }
  }
  for (const match of allMatches(BASIC_LITERAL, line)) {
    if (isBasicCredential(match[1])) {
      add('api-key');
      break;
    }
  }
  const commented = commentedAssignmentKind(line);
  if (commented) add(commented);
  for (const match of allMatches(KNOWN_PREFIX, line)) {
    if (!isBenignLiteral(match[0])) {
      add('api-key');
      break;
    }
  }
  return findings;
}

export function scanText(file: string, text: string, options?: ScanOptions): SecretFinding[] {
  if (text.includes('\0')) return [];
  const mode = file === 'fixture.ts' ? 'code' : shouldScan(file);
  if (!mode) return [];
  const findings: SecretFinding[] = [];
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    const lineNo = i + 1;
    if (mode === 'env' || mode === 'text') {
      const finding = scanEnvLine(file, lineNo, line, options);
      if (finding) findings.push(finding);
    }
    if (mode === 'config') {
      const finding = scanConfigLine(file, lineNo, line, options);
      if (finding) findings.push(finding);
    }
    if (mode === 'code' || mode === 'text' || mode === 'config') {
      for (const finding of scanCodeLine(file, lineNo, line, options)) {
        if (!findings.some((existing) => existing.line === finding.line && existing.kind === finding.kind)) {
          findings.push(finding);
        }
      }
    } else if (mode === 'env') {
      const kind = commentedAssignmentKind(line);
      if (
        kind &&
        !isLineExempt(file, lineNo, options) &&
        !findings.some((existing) => existing.line === lineNo && existing.kind === kind)
      ) {
        findings.push({ file, line: lineNo, kind });
      }
    }
  }
  return findings;
}

export function scanTrackedSource(root: string): SecretFinding[] {
  const listed = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'buffer' },
  );
  const files = listed.toString('utf8').split('\0').filter(Boolean);
  const findings: SecretFinding[] = [];
  for (const file of files) {
    if (!shouldScan(file)) continue;
    const fullPath = path.join(root, file);
    let text: string;
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }
    findings.push(...scanText(file, text));
  }
  return findings;
}

export function formatFindings(findings: SecretFinding[]): string {
  return findings.map((finding) => `${finding.file}:${finding.line} ${finding.kind} literal`).join('\n');
}
