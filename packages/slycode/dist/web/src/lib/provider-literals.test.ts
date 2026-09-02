/**
 * Feature 085 sweep acceptance test: provider ids must not be hardcoded
 * outside the registry and the deliberately per-provider places.
 *
 * Uses `gemini` as the canary — it is the provider slated for removal (#0343),
 * so any literal left behind is exactly the kind of site that would have to be
 * hand-edited. Run with: ./bridge/node_modules/.bin/tsx --test web/src/lib/provider-literals.test.ts
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
  { path: 'bridge/src/submit-verify.ts', reason: 'per-TUI chrome classifier: one arm per hand-captured fixture set' },
  { path: 'bridge/src/claude-utils.ts', reason: 'per-provider transcript-file detection arms (pty-scrape transport)' },
  { path: 'bridge/src/session-manager.ts', reason: 'comment examples + per-provider resend caps keyed by SubmitProvider' },
  { path: 'bridge/src/reaper.ts', reason: 'doc comment naming the incident provider' },
  { path: 'bridge/src/types.ts', reason: 'doc comment examples' },
  { path: 'bridge/src/index.ts', reason: 'legacy default allow-list (bridge-config.json fallback); providers.json also vouches for its own commands' },
  { path: 'bridge/src/provider-utils.ts', reason: 'doc comments describing resume semantics' },
  { path: 'bridge/src/pty-handler.ts', reason: 'doc comment on shell-safe bare tokens' },
  { path: 'web/src/lib/types.ts', reason: 'ProviderId = CLI-assets placement targets (claude/agents/codex/gemini), a separate concept from the runtime provider registry' },
  { path: 'web/src/lib/provider-paths.ts', reason: 'CLI-assets placement directories per target' },
  { path: 'web/src/components/CliAssetsTab.tsx', reason: 'CLI-assets placement targets' },
  { path: 'web/src/components/StoreView.tsx', reason: 'CLI-assets placement targets' },
  { path: 'web/src/app/api/cli-assets/route.ts', reason: 'CLI-assets placement targets' },
  { path: 'web/src/app/api/cli-assets/assistant/route.ts', reason: 'CLI-assets placement target names in generated prompts' },
  { path: 'scripts/kanban.js', reason: 'help text examples (registry-driven validation happens in the bridge)' },
];

const LITERAL = /(['"`])gemini\1/;

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
