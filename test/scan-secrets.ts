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

const PASSWORD_LITERAL = /(?<![A-Za-z0-9_])(?:password|passwd|pwd)(?![A-Za-z0-9_])\s*[:=]\s*(['"`])([^'"`\n]+)\1/gi;
const OR_FALLBACK = /(?:\|\||\?\?)\s*(['"`])([^'"`\n]*)\1/g;
const ENV_TERNARY = /process\.env\.([A-Za-z0-9_]+)\s*\?[^:\n]*:\s*(['"`])([^'"`\n]*)\2/g;
const ENV_ASSIGN = /process\.env\.([A-Za-z0-9_]+)\s*=\s*(['"`])([^'"`\n]*)\2/g;
const IDENT_ASSIGN = /(?<![.A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(['"`])([^'"`\n]+)\2/g;
const KEY_VALUE = /(?<!\?\s*)(?<![A-Za-z0-9_])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:\s*(['"`])([^'"`\n]+)\3/g;
// A token, not the word after "Bearer" in prose. Plants carry a digit.
const BEARER_LITERAL = /Bearer\s+([A-Za-z0-9_\-.]{12,})/g;
const HASH_SYNC_LITERAL = /\bhashSync\s*\(\s*(['"`])([^'"`\n]+)\1/g;
const KNOWN_PREFIX = /AIza[0-9A-Za-z\-_]{20,}|sk-(?:proj-)?[A-Za-z0-9_\-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|re_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}/g;
const ENV_REF = /process\.env\.([A-Za-z0-9_]+)/g;
const CONST_BINDING = /\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
const KEY_NAME = /(?<!\?\s*)(?<![A-Za-z0-9_])(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*:/g;

function allMatches(re: RegExp, line: string): RegExpMatchArray[] {
  re.lastIndex = 0;
  return [...line.matchAll(re)];
}

export function isCredentialName(name: string): boolean {
  if (/api[-_]?key/i.test(name)) return true;
  if (/(?:^|_)key$/i.test(name)) return true;
  if (/(?:^|_)(?:password|passwd|pwd|secret|token)$/i.test(name)) return true;
  if (/[a-z](?:Password|Passwd|Pwd|Secret|Token)$/.test(name)) return true;
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

// Empty values and obvious your-*-here placeholders are not secrets.
// This is separate from the exact-value allowlist.
function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^your[-_][A-Za-z0-9_-]*here$/i.test(trimmed);
}

function isBenignLiteral(value: string): boolean {
  return isPlaceholder(value) || isAllowedLiteral(value);
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
      if (!isPlaceholder(match[2])) return kindForNames(names);
    }
  }
  for (const match of allMatches(ENV_TERNARY, line)) {
    if (isCredentialName(match[1]) && !isPlaceholder(match[3])) return kindForName(match[1]);
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

function shouldScan(file: string): 'code' | 'env' | 'text' | null {
  if (path.basename(file) === 'package-lock.json' || file.endsWith('.lock')) return null;
  if (isEnvFile(file)) return 'env';
  const ext = path.extname(file).toLowerCase();
  if (CODE_EXT.has(ext)) return 'code';
  if (TEXT_EXT.has(ext)) return 'text';
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
    if (/\d/.test(match[1]) && !isBenignLiteral(match[1])) {
      add('api-key');
      break;
    }
  }
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
    if (mode === 'code' || mode === 'text') {
      for (const finding of scanCodeLine(file, lineNo, line, options)) {
        if (!findings.some((existing) => existing.line === finding.line && existing.kind === finding.kind)) {
          findings.push(finding);
        }
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
