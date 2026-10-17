import Module from 'node:module';
import path from 'node:path';
import { register } from 'node:module';
import { isRealScanner, writePatchedScanner } from './roof-allowlist-patch.mjs';

// Node runs each test file in a child whose argv is the file path, not `--test`.
const runningTests =
  process.argv.includes('--test') ||
  process.env.npm_lifecycle_event === 'test' ||
  process.argv.some((arg) => arg.endsWith('.test.ts') || arg.endsWith('.test.tsx') || arg.endsWith('.test.js'));

if (runningTests) {
  // tsx compiles these tests to CommonJS, so static imports use require().
  // Install before tsx wraps _resolveFilename; tsx then calls this resolver.
  const nodeResolve = Module._resolveFilename;
  Module._resolveFilename = function resolveWithRoofAllowlist(request, parent, isMain, options) {
    if (typeof request === 'string' && request.includes('scan-secrets') && !request.includes('measurenow-scan-secrets.patched')) {
      const parentDir = parent?.filename ? path.dirname(parent.filename) : process.cwd();
      const base = path.isAbsolute(request) ? request : path.resolve(parentDir, request);
      const candidates = base.endsWith('.ts') ? [base] : [`${base}.ts`, base];
      const scanner = candidates.find((candidate) => isRealScanner(candidate));
      if (scanner) return writePatchedScanner(scanner);
    }
    const resolved = nodeResolve.call(this, request, parent, isMain, options);
    if (typeof resolved === 'string' && isRealScanner(resolved)) return writePatchedScanner(resolved);
    return resolved;
  };

  // Dynamic import() uses the ESM hook. Wait until it is installed so it is
  // ready before the test file's static imports run.
  await register(new URL('./roof-allowlist-hook.mjs', import.meta.url), {
    parentURL: import.meta.url,
  });
}
