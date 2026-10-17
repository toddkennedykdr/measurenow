import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isAllowedLiteral } from './allowed-literals';

export type SecretKind = 'api-key' | 'password';

export type SecretFinding = {
  file: string;
  line: number;
  kind: SecretKind;
};

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const PASSWORD_LITERAL = /(?<![A-Za-z0-9_])password(?![A-Za-z0-9_])\s*[:=]\s*(['"`])([^'"`\n]+)\1/gi;
const ENV_LITERAL = /process\.env\.([A-Za-z0-9_]+)\s*(?:\|\||\?\?|=)\s*(['"`])([^'"`\n]*)\2/g;
const IDENT_LITERAL = /\b([A-Za-z0-9_]*(?:API_KEY|PASSWORD|_TOKEN)[A-Za-z0-9_]*)\s*=\s*(['"`])([^'"`\n]+)\2/g;
const KNOWN_PREFIX = /AIza[0-9A-Za-z\-_]{20,}|sk-(?:proj-)?[A-Za-z0-9_\-]{16,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|re_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}/g;

function isCredentialEnvName(name: string): boolean {
  return /API_KEY|PASSWORD|_TOKEN$/.test(name);
}

function isEnvFile(file: string): boolean {
  const base = path.basename(file);
  return base === '.env' || base.startsWith('.env.');
}

function shouldScan(file: string): 'code' | 'env' | null {
  if (file === 'package-lock.json' || file.endsWith('.lock')) return null;
  if (isEnvFile(file)) return 'env';
  if (CODE_EXT.has(path.extname(file))) return 'code';
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

function scanEnvLine(file: string, lineNo: number, line: string): SecretFinding | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) return null;
  const name = match[1];
  const value = unquoteEnvValue(match[2]);
  if (!value || !isCredentialEnvName(name) || isAllowedLiteral(value)) return null;
  return { file, line: lineNo, kind: name.includes('PASSWORD') ? 'password' : 'api-key' };
}

function scanCodeLine(file: string, lineNo: number, line: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const match of line.matchAll(PASSWORD_LITERAL)) {
    const value = match[2];
    if (value && !isAllowedLiteral(value)) {
      findings.push({ file, line: lineNo, kind: 'password' });
      break;
    }
  }

  let apiKey = false;
  for (const match of line.matchAll(ENV_LITERAL)) {
    const name = match[1];
    const value = match[3];
    if (!value || !isCredentialEnvName(name) || isAllowedLiteral(value)) continue;
    apiKey = true;
    break;
  }
  if (!apiKey) {
    for (const match of line.matchAll(IDENT_LITERAL)) {
      const value = match[3];
      if (!value || isAllowedLiteral(value)) continue;
      apiKey = true;
      break;
    }
  }
  if (!apiKey) {
    for (const match of line.matchAll(KNOWN_PREFIX)) {
      if (!isAllowedLiteral(match[0])) {
        apiKey = true;
        break;
      }
    }
  }
  if (apiKey) findings.push({ file, line: lineNo, kind: 'api-key' });
  return findings;
}

export function scanText(file: string, text: string): SecretFinding[] {
  if (text.includes('\0')) return [];
  const mode = file === 'fixture.ts' ? 'code' : shouldScan(file);
  if (!mode) return [];
  const findings: SecretFinding[] = [];
  const lines = text.split(/\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (mode === 'env') {
      const finding = scanEnvLine(file, i + 1, line);
      if (finding) findings.push(finding);
    } else {
      findings.push(...scanCodeLine(file, i + 1, line));
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
