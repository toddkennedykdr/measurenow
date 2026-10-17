import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ALLOWED_EXACT, ALLOWED_FILE_LINES, JN_API_KEY_DUMMY, SEED_PASSWORD_DUMMY, isAllowedLiteral } from './allowed-literals';
import { formatFindings, scanText, scanTrackedSource, type SecretKind } from './scan-secrets';

const q = "'";
const dq = '"';
const bt = '`';

function asm(parts: readonly string[]): string {
  return parts.join('');
}

function expectFlag(file: string, text: string, kind?: SecretKind): void {
  const findings = scanText(file, text);
  assert.ok(findings.length >= 1, `expected a finding in ${file} for:\n${text}\n${formatFindings(findings)}`);
  if (kind) assert.ok(findings.some((finding) => finding.kind === kind), formatFindings(findings));
}

function expectClean(file: string, text: string): void {
  const findings = scanText(file, text);
  assert.equal(findings.length, 0, formatFindings(findings));
}

test('allowlist stays exact values or a single file:line', () => {
  assert.equal(ALLOWED_FILE_LINES.size, 0);
  for (const value of ALLOWED_EXACT) {
    assert.equal(isAllowedLiteral(value), true);
    assert.equal(isAllowedLiteral(`${value}-extra`), false);
    assert.equal(isAllowedLiteral(value.slice(0, -1)), false);
  }
  for (const entry of ALLOWED_FILE_LINES) {
    assert.match(entry, /^[^:*?\s]+:\d+$/);
  }
});

test('camelCase and lowercase key assignments are flagged', () => {
  expectFlag('server/plant.ts', asm([
    'const api',
    'Key = ',
    q,
    'mlFAKE',
    'plant0004',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const api',
    'key = ',
    q,
    'mlFAKE',
    'exampleKey',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const api',
    '_key = ',
    q,
    'mlFAKE',
    'plantSnake',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const JN',
    '_KEY = ',
    q,
    'mlFAKE',
    'plant0003',
    q,
    ';',
  ]), 'api-key');
  expectClean('server/clean.ts', "const apiKey = process.env.RESEND_API_KEY;");
  expectClean('server/clean.ts', "const apikey = '';");
  expectClean('server/clean.ts', "const api_key = 'your-key-here';");
  expectClean('server/clean.ts', "const label = 'apiKey';");
  expectClean('server/clean.ts', "const primaryKey = 'id';");
  expectClean('server/clean.ts', "const JN_KEY = 'your-key-here';");
});

test('Bearer literals are flagged and interpolations are not', () => {
  expectFlag('server/plant.ts', asm([
    'const h = { Authorization: ',
    q,
    'Bearer ',
    'mlFAKE',
    'plant0005xyz',
    q,
    ' };',
  ]), 'api-key');
  expectClean('server/clean.ts', 'export const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}` };');
  expectClean('server/clean.ts', 'export const headers = { Authorization: `Bearer ${apiKey}` };');
  expectClean('server/clean.ts', "const h = { Authorization: 'Bearer short' };");
  expectClean('server/clean.ts', "const h = { Authorization: 'Bearer your-key-here' };");
  expectClean('scanner.ts', "return flag ? 'password' : 'api-key';");
});

test('literal || ?? and ternary fallbacks are flagged', () => {
  expectFlag('server/routes/jobnimbus.ts', asm([
    'const k = process.env.JN_',
    'API_KEY || ',
    q,
    'mlFAKE',
    'plant0001',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const k = process.env.JOBNIMBUS_',
    'API_KEY ?? ',
    q,
    'mlFAKE',
    'plant0002',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const s = process.env.SESSION',
    '_SECRET || ',
    q,
    'fakeplantsecret11',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const k = process.env.JN_',
    'API_KEY ? process.env.JN_',
    'API_KEY : ',
    q,
    'mlFAKE',
    'plant0012',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const k = process.env.JN_',
    'API_KEY || ',
    bt,
    'mlFAKE',
    'plant0019',
    bt,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const api',
    'Key = process.env.X || ',
    q,
    'mlFAKE',
    'fallback',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const primary = process.env.JN_',
    'API_KEY?.trim() || ',
    q,
    'mlFAKE',
    'trimfall',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const k = process.env.JN_',
    'API_KEY || ',
    q,
    JN_API_KEY_DUMMY,
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const k = process.env.JN_',
    'API_KEY || ',
    q,
    'abc-not-real',
    q,
    ';',
  ]), 'api-key');
  expectClean('server/clean.ts', "const API_KEY = process.env.ANTHROPIC_API_KEY || '';");
  expectClean('server/clean.ts', "const primary = process.env.JN_API_KEY?.trim() || '';");
  expectClean('server/clean.ts', "const apiKey = process.env.X || 'your-key-here';");
  expectClean('server/clean.ts', "const apiKey = process.env.X || 'your_google_api_key_here';");
  expectClean('server/clean.ts', "const apiKey = process.env.RESEND_API_KEY;");
  expectClean('server/clean.ts', "const PORT = process.env.PORT || '3000';");
  expectClean('server/db/index.ts', "const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/measurenow';");
  expectClean('server/index.ts', "if (process.env.NODE_ENV === 'production') {}");
  expectClean('server/index.ts', 'const sessionSecret = process.env.SESSION_SECRET;');
});

test('a file:line exemption covers one line and not the same text elsewhere', () => {
  const line = asm([
    'const k = process.env.JN_',
    'API_KEY || ',
    q,
    'mlFAKE',
    'linelock',
    q,
    ';',
  ]);
  expectFlag('server/plant.ts', line);
  const exempt = scanText('server/plant.ts', line, { allowedLines: new Set(['server/plant.ts:1']) });
  assert.equal(exempt.length, 0, formatFindings(exempt));
  expectFlag('server/other.ts', line);
  const other = scanText('server/other.ts', line, { allowedLines: new Set(['server/plant.ts:1']) });
  assert.equal(other.length, 1, formatFindings(other));
});

test('password, pwd, passwd, and hashSync literals are flagged', () => {
  expectFlag('server/plant.ts', asm([
    'export const u = { username: ',
    q,
    'X',
    q,
    ', pass',
    'word: ',
    q,
    'fakeplantpw8',
    q,
    ' };',
  ]), 'password');
  expectFlag('server/plant.ts', asm([
    'export const u = { username: ',
    q,
    'X',
    q,
    ', pw',
    'd: ',
    q,
    'fakeplantpw9',
    q,
    ' };',
  ]), 'password');
  expectFlag('server/plant.ts', asm([
    'export const u = { username: ',
    q,
    'X',
    q,
    ', pass',
    'wd: ',
    q,
    'fakeplantpw9b',
    q,
    ' };',
  ]), 'password');
  expectFlag('server/plant.ts', asm([
    'const h = bcrypt.hash',
    'Sync(',
    q,
    'fakeplantpw10',
    q,
    ', 10);',
  ]), 'password');
  expectClean('server/clean.ts', 'export const row = { pass' + 'word: ' + q + SEED_PASSWORD_DUMMY + q + ' };');
  expectClean('server/clean.ts', "export const row = { pwd: '' };");
  expectClean('server/clean.ts', "export const row = { passwd: 'your-password-here' };");
  expectClean('server/clean.ts', 'const hash = bcrypt.hash' + 'Sync(password, 10);');
  expectClean('server/clean.ts', 'const hash = bcrypt.hash' + 'Sync(' + q + SEED_PASSWORD_DUMMY + q + ', 10);');
  expectClean('server/db/seedUsers.ts', "const row = { passwordEnv: 'SEED_TODD_PASSWORD' };");
});

test('known-prefix literals are flagged in code files', () => {
  expectFlag('src/plant.tsx', asm([
    'export const g = ',
    q,
    'AIza',
    'FAKEplantFAKEplantFAKEplant0006',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'export const o = ',
    q,
    'sk-',
    'FAKEplantFAKEplant0007',
    q,
    ';',
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    'const r = ',
    q,
    're_',
    'FAKEplant0020abcdef',
    q,
    ';',
  ]), 'api-key');
  const both = [
    asm([
      'const api',
      'Key = ',
      q,
      'mlFAKE',
      'lineone',
      q,
      ';',
    ]),
    asm([
      'const h = { Authorization: ',
      q,
      'Bearer ',
      'mlFAKE',
      'linetwo0005',
      q,
      ' };',
    ]),
  ].join('\n');
  const findings = scanText('server/plant.ts', both);
  assert.equal(findings.length, 2, formatFindings(findings));
  assert.deepEqual(findings.map((finding) => finding.line), [1, 2]);
});

test('json, markdown, and shell files are scanned', () => {
  expectFlag('railway.json', asm([
    '{ ',
    dq,
    'env',
    dq,
    ': { ',
    dq,
    'JN_',
    'API_KEY',
    dq,
    ': ',
    dq,
    'mlFAKE',
    'plant0014',
    dq,
    ' } }',
  ]), 'api-key');
  expectFlag('config.json', asm([
    '{ ',
    dq,
    'api',
    'Key',
    dq,
    ': ',
    dq,
    'mlFAKE',
    'jsoncamel',
    dq,
    ' }',
  ]), 'api-key');
  expectFlag('README.md', asm([
    'JN_',
    'API_KEY=',
    'mlFAKE',
    'plant0015',
  ]), 'api-key');
  expectFlag('scripts/deploy.sh', asm([
    'export JN_',
    'API_KEY=',
    'mlFAKE',
    'plant0016',
  ]), 'api-key');
  expectFlag('.env.production', asm([
    'JN_',
    'API_KEY=',
    'mlFAKE',
    'plant0013',
  ]), 'api-key');
  expectClean('clean.json', '{ "name": "measurenow", "port": "3001" }');
  expectClean('notes.md', 'See the docs.\n  &key=YOUR_API_KEY\n');
  expectClean('scripts/clean.sh', '#!/bin/bash\necho hello\nexport PORT=3001\n');
  expectClean('.env.example', 'GOOGLE_SOLAR_API_KEY=your_google_api_key_here\nJN_API_KEY=\nSESSION_SECRET=\n');
  expectClean('notes.md', 'export PORT=3001\n');
});

test('password label maps are not secrets', () => {
  expectClean('src/labels.ts', "const labels = { password: 'Password' };");
  expectClean('src/labels.ts', "const labels = { password: 'password', passwd: 'Passwd' };");
});

test('validation messages are not secrets', () => {
  expectClean('src/form.ts', "errors.password = 'Password is required';");
  expectClean('src/form.ts', "errors.password = 'Password must be at least 8 characters';");
});

test('object key fields are not secrets', () => {
  expectClean('src/table.ts', "const columns = [{ key: 'address' }, { key: 'Escape' }];");
});

test('STORAGE_KEY constants are not secrets', () => {
  expectClean('src/theme.ts', "const STORAGE_KEY = 'measurenow-theme';");
  expectClean('src/theme.ts', "const storageKey = 'measurenow-theme';");
});

test('API_KEY_HEADER names are not secrets', () => {
  expectClean('src/http.ts', "const API_KEY_HEADER = 'x-api-key';");
});

test('UI copy that mentions secrets is not a secret', () => {
  expectClean('src/copy.ts', "const copy = { secret: 'Our secret is quality work' };");
});

test('README angle-bracket and change-me placeholders are not secrets', () => {
  expectClean('README.md', '    JN_API_KEY=<your JobNimbus key>\nSESSION_SECRET=change-me\n');
  expectClean('README.md', 'API_KEY=<your-api-key>\nTOKEN=changeme\nSECRET=change_me\n');
});

test('yaml, compose, Dockerfile, toml, and html are scanned', () => {
  expectFlag('.github/workflows/ci.yml', asm([
    'env:\n  JN_',
    'API_KEY: ',
    'mlFAKE',
    'yamlplant01\n',
  ]), 'api-key');
  expectFlag('railway.yaml', asm([
    'API_',
    'KEY: ',
    dq,
    'mlFAKE',
    'yamlplant02',
    dq,
    '\n',
  ]), 'api-key');
  expectFlag('docker-compose.yml', asm([
    'services:\n  app:\n    environment:\n      - JN_',
    'API_KEY=',
    'mlFAKE',
    'compose0003\n',
  ]), 'api-key');
  expectFlag('docker-compose', asm([
    'JN_',
    'API_KEY: ',
    'mlFAKE',
    'compose0003b\n',
  ]), 'api-key');
  expectFlag('Dockerfile', asm([
    'FROM node:20\nENV JN_',
    'API_KEY=',
    'mlFAKE',
    'docker0004\n',
  ]), 'api-key');
  expectFlag('Dockerfile', asm([
    'ENV SESSION_',
    'SECRET ',
    'mlFAKE',
    'docker0005\n',
  ]), 'api-key');
  expectFlag('config.toml', asm([
    'api_key = ',
    dq,
    'mlFAKE',
    'tomlplant06',
    dq,
    '\n',
  ]), 'api-key');
  expectFlag('widget.html', asm([
    '<script>const apiKey = ',
    q,
    'mlFAKE',
    'htmlplant07',
    q,
    ';</script>\n',
  ]), 'api-key');
  expectClean('docker-compose.yml', 'services:\n  app:\n    image: node:20\n    ports:\n      - "3001:3001"\n');
  expectClean('Dockerfile', 'FROM node:20\nENV PORT=3001\nWORKDIR /app\n');
  expectClean('notes.toml', 'title = "MeasureNow"\nport = 3001\n');
  expectClean('index.html', '<label>Password</label>\n<input type="password" />\n');
});

test('a quoted key assignment in a comment is flagged when the value looks like a secret', () => {
  expectFlag('server/plant.ts', asm([
    '// old key: ',
    q,
    'mlFAKE',
    'oldkey0001',
    q,
  ]), 'api-key');
  expectFlag('server/plant.ts', asm([
    '// key = ',
    dq,
    'mlFAKE',
    'oldkey0002',
    dq,
  ]), 'api-key');
  expectClean('server/plant.ts', "// old key: 'address'");
  expectClean('server/plant.ts', "// key: 'Escape'");
  expectClean('src/table.ts', "const columns = [{ key: 'address' }, { key: 'Escape' }];");
});

test('unquoted key assignments in comments are flagged', () => {
  expectFlag('server/plant.ts', asm([
    '// JN_',
    'API_KEY=',
    'mlFAKE',
    'commented01',
  ]), 'api-key');
  expectFlag('scripts/deploy.sh', asm([
    '# JN_',
    'API_KEY=',
    'mlFAKE',
    'commented02',
  ]), 'api-key');
  expectClean('server/plant.ts', '// JN_API_KEY=');
  expectClean('server/plant.ts', '// JN_API_KEY=change-me');
  expectClean('server/plant.ts', 'const apiKey = process.env.JN_API_KEY;');
});

test('Basic auth credentials are flagged', () => {
  expectFlag('server/plant.ts', asm([
    'const h = { Authorization: ',
    q,
    'Basic ',
    'FAKEbasic',
    'AuthToken==',
    q,
    ' };',
  ]), 'api-key');
  expectClean('server/plant.ts', "const h = { Authorization: 'Basic authentication' };");
});

test('Bearer tokens without digits are flagged', () => {
  expectFlag('server/plant.ts', asm([
    'const h = { Authorization: ',
    q,
    'Bearer ',
    'mlFAKE',
    'plantBearer',
    q,
    ' };',
  ]), 'api-key');
  expectClean('server/plant.ts', "const h = { Authorization: 'Bearer authentication' };");
  expectClean('server/plant.ts', "const h = { Authorization: 'Bearer short' };");
});

test('planted fixtures flag every plant.sh case and skip a gitignored env file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'measurenow-plants-'));
  const git = (args: string[]) => {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  };
  const write = (rel: string, text: string) => {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text.endsWith('\n') ? text : `${text}\n`);
  };

  const p1 = asm([
    'const k = process.env.JN_',
    'API_KEY || ',
    q,
    'mlFAKE',
    'plant0001',
    q,
    ';',
  ]);
  const shared = [
    ['P1b', asm([
      'const k = process.env.JOBNIMBUS_',
      'API_KEY ?? ',
      q,
      'mlFAKE',
      'plant0002',
      q,
      ';',
    ])],
    ['P2', asm([
      'const JN',
      '_KEY = ',
      q,
      'mlFAKE',
      'plant0003',
      q,
      ';',
    ])],
    ['P3', asm([
      'const api',
      'Key = ',
      q,
      'mlFAKE',
      'plant0004',
      q,
      ';',
    ])],
    ['P4', asm([
      'const h = { Authorization: ',
      q,
      'Bearer ',
      'mlFAKE',
      'plant0005xyz',
      q,
      ' };',
    ])],
    ['P6', asm([
      'export const o = ',
      q,
      'sk-',
      'FAKEplantFAKEplant0007',
      q,
      ';',
    ])],
    ['P7', asm([
      'export const u = { username: ',
      q,
      'X',
      q,
      ', pass',
      'word: ',
      q,
      'fakeplantpw8',
      q,
      ' };',
    ])],
    ['P8', asm([
      'export const u = { username: ',
      q,
      'X',
      q,
      ', pw',
      'd: ',
      q,
      'fakeplantpw9',
      q,
      ' };',
    ])],
    ['P9', asm([
      'const h = bcrypt.hash',
      'Sync(',
      q,
      'fakeplantpw10',
      q,
      ', 10);',
    ])],
    ['P10', asm([
      'const s = process.env.SESSION',
      '_SECRET || ',
      q,
      'fakeplantsecret11',
      q,
      ';',
    ])],
    ['P11', asm([
      'const k = process.env.JN_',
      'API_KEY ? process.env.JN_',
      'API_KEY : ',
      q,
      'mlFAKE',
      'plant0012',
      q,
      ';',
    ])],
    ['P16', asm([
      'const k = process.env.JN_',
      'API_KEY || ',
      q,
      JN_API_KEY_DUMMY,
      q,
      ';',
    ])],
    ['P17', asm([
      'const k = process.env.JN_',
      'API_KEY || ',
      q,
      'abc-not-real',
      q,
      ';',
    ])],
    ['P19', asm([
      'const k = process.env.JN_',
      'API_KEY || ',
      bt,
      'mlFAKE',
      'plant0019',
      bt,
      ';',
    ])],
    ['P20', asm([
      'const r = ',
      q,
      're_',
      'FAKEplant0020abcdef',
      q,
      ';',
    ])],
  ] as const;

  const located: { id: string; file: string; line: number }[] = [
    { id: 'P1', file: 'server/routes/jobnimbus.ts', line: 2 },
    ...shared.map((entry, index) => ({ id: entry[0], file: 'server/plant.ts', line: index + 1 })),
    { id: 'P5', file: 'src/plant.tsx', line: 1 },
    { id: 'P12', file: '.env.production', line: 1 },
    { id: 'P13', file: 'railway.json', line: 1 },
    { id: 'P14', file: 'README.md', line: 2 },
    { id: 'P15', file: 'scripts/deploy.sh', line: 1 },
    { id: 'P18', file: 'test/plant.ts', line: 1 },
  ];

  try {
    git(['init', '-q']);
    write('.gitignore', '.env\nnode_modules\n');
    write('server/routes/jobnimbus.ts', `export {}\n${p1}\n`);
    write('server/plant.ts', `${shared.map((entry) => entry[1]).join('\n')}\n`);
    write('src/plant.tsx', `${asm([
      'export const g = ',
      q,
      'AIza',
      'FAKEplantFAKEplantFAKEplant0006',
      q,
      ';',
    ])}\n`);
    write('.env.production', `${asm([
      'JN_',
      'API_KEY=',
      'mlFAKE',
      'plant0013',
    ])}\n`);
    write('railway.json', `${asm([
      '{ ',
      dq,
      'env',
      dq,
      ': { ',
      dq,
      'JN_',
      'API_KEY',
      dq,
      ': ',
      dq,
      'mlFAKE',
      'plant0014',
      dq,
      ' } }',
    ])}\n`);
    write('README.md', `# Notes\n${asm([
      'JN_',
      'API_KEY=',
      'mlFAKE',
      'plant0015',
    ])}\n`);
    write('scripts/deploy.sh', `${asm([
      'export JN_',
      'API_KEY=',
      'mlFAKE',
      'plant0016',
    ])}\n`);
    write('test/plant.ts', `${asm([
      'const k = process.env.JN_',
      'API_KEY || ',
      q,
      'mlFAKE',
      'plant0018',
      q,
      ';',
    ])}\n`);
    write('server/clean.ts', [
      'const apiKey = process.env.RESEND_API_KEY;',
      "const apikey = '';",
      "const api_key = 'your-key-here';",
      "const PORT = process.env.PORT || '3000';",
      "const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://localhost:5432/measurenow';",
      'export const headers = { Authorization: `Bearer ${process.env.RESEND_API_KEY}` };',
      "const primary = process.env.JN_API_KEY?.trim() || '';",
      "const row = { passwordEnv: 'SEED_TODD_PASSWORD' };",
    ].join('\n'));
    write('clean.json', '{ "name": "measurenow", "port": "3001" }\n');
    write('notes.md', 'See the docs.\n  &key=YOUR_API_KEY\n');
    write('scripts/clean.sh', '#!/bin/bash\necho hello\nexport PORT=3001\n');

    const flagged = scanTrackedSource(root);
    const missed = located.filter((plant) => !flagged.some((finding) => finding.file === plant.file && finding.line === plant.line));
    console.log(located.map((plant) => {
      const hit = flagged.find((finding) => finding.file === plant.file && finding.line === plant.line);
      return `${plant.id} ${plant.file}:${plant.line} ${hit ? hit.kind : 'MISSED'}`;
    }).join('\n'));
    assert.deepEqual(missed.map((plant) => plant.id), [], formatFindings(flagged));

    const cleanFiles = new Set(['server/clean.ts', 'clean.json', 'notes.md', 'scripts/clean.sh', '.gitignore']);
    const unexpected = flagged.filter((finding) => cleanFiles.has(finding.file));
    assert.deepEqual(unexpected, []);

    write('.env', `${asm([
      'JN_',
      'API_KEY=',
      'mlFAKE',
      'plant0022',
    ])}\n`);
    const ignored = scanTrackedSource(root);
    assert.equal(ignored.some((finding) => finding.file === '.env'), false, formatFindings(ignored));
    console.log('P22 gitignored .env ignored');

    git(['add', '-f', '.env']);
    const staged = scanTrackedSource(root);
    const stagedHit = staged.find((finding) => finding.file === '.env');
    assert.ok(stagedHit, formatFindings(staged));
    console.log(`P21 staged .env ${stagedHit.file}:${stagedHit.line} ${stagedHit.kind}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
