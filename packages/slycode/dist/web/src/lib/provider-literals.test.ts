/**
 * Feature 085 sweep acceptance test: provider ids must not be hardcoded
 * outside the registry and the deliberately per-provider places.
 *
 * Uses `opencode` as the canary — the most recently added provider, and so the
 * most likely to attract new hardcoding. (The original canary was the provider
 * card #0343 later purged, which is also the cautionary tale: every literal
 * site below is one more file a future provider removal has to hand-edit.)
 * Run with:
 * ./bridge/node_modules/.bin/tsx --test web/src/lib/provider-literals.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SCAN_ROOTS = ['bridge/src', 'web/src', 'messaging/src', 'scripts', 'packages/slycode/src', 'packages/create-slycode/src'];

/**
 * Allowed literal sites, relative to the repo root. Each entry carries the
 * reason so the next person knows whether it is still justified.
 */
const ALLOWLIST: Array<{ path: string; reason: string }> = [
  { path: 'bridge/src/index.ts', reason: 'legacy default allow-list (bridge-config.json fallback); providers.json also vouches for its own commands' },
  { path: 'bridge/src/session-manager.ts', reason: 'legacy default allow-list (bridge-config.json fallback)' },
  { path: 'bridge/src/transport/opencode-api.ts', reason: 'the OpenCode transport itself: auth.json path + CLI fallback invocation' },
  { path: 'bridge/src/types.ts', reason: 'doc comment examples' },
];

const LITERAL = /(['"`])opencode\1/;

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'lib' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__fixtures__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name) && !/\.test\.[tj]sx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}

test('no hardcoded provider ids outside the registry and allow-listed per-provider sites', () => {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) {
    const abs = path.join(REPO_ROOT, root);
    if (fs.existsSync(abs)) walk(abs, files);
  }
  const allowed = new Set(ALLOWLIST.map(a => a.path));
  const offenders: string[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).replace(/\\/g, '/');
    if (allowed.has(rel)) continue;
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    lines.forEach((line, i) => {
      if (LITERAL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, [], `provider literals found outside the allow-list:\n${offenders.join('\n')}`);
});

test('allow-list entries still exist (prune stale reasons)', () => {
  const missing = ALLOWLIST.filter(a => !fs.existsSync(path.join(REPO_ROOT, a.path))).map(a => a.path);
  assert.deepEqual(missing, []);
});
