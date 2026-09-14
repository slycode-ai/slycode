/**
 * Parity test: context-priming area-index parsing, CLI vs web (#0355).
 *
 * The web lib (`parseAreaIndex` in ./area-index.ts) and the CLI
 * (`scripts/kanban.js` → `sly-kanban areas`) each carry a copy of the parser.
 * Every fixture here is run through BOTH and the outputs must agree.
 *
 * Contract: an area is a `### <name>` heading whose next non-blank line
 * starts with `- path:`. The `## Areas` grouping heading, other heading
 * levels, bold labels, and `###` headings with no path line are ignored.
 * The areas/ directory is never scanned.
 *
 * Self-contained node:test script (matches kanban-resolve.test.ts). Run via
 * the tsx binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/area-index.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAreaIndex } from './area-index';

const execFileP = promisify(execFile);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(REPO_ROOT, 'scripts', 'kanban.js');

const EMPTY_BOARD = {
  project_id: 'area-index-test',
  stages: { backlog: [], design: [], implementation: [], testing: [], done: [] },
  last_updated: '2026-01-01T00:00:00.000Z',
};

/**
 * Scaffold a temp workspace with the index under `.claude/` (or another
 * provider dir) plus a stray areas/ file that must NOT leak into the result,
 * then run `sly-kanban areas` there. Returns the parsed area names (in
 * printed order) or [] for the "No areas found" message.
 */
async function cliAreas(index: string, providerDir = '.claude'): Promise<string[]> {
  const ws = await fs.mkdtemp(path.join(os.tmpdir(), 'area-index-test-'));
  await fs.mkdir(path.join(ws, 'documentation'), { recursive: true });
  await fs.writeFile(path.join(ws, 'documentation', 'kanban.json'), JSON.stringify(EMPTY_BOARD));
  const refs = path.join(ws, providerDir, 'skills', 'context-priming', 'references');
  await fs.mkdir(path.join(refs, 'areas'), { recursive: true });
  await fs.writeFile(path.join(refs, 'area-index.md'), index);
  await fs.writeFile(path.join(refs, 'areas', 'stray-file.md'), '# not in the index\n');

  const { stdout } = await execFileP('node', [CLI, 'areas'], { cwd: ws, timeout: 15000, windowsHide: true });
  if (/No areas found/.test(stdout)) return [];
  const names = stdout
    .split('\n')
    .filter((l) => /^ {2}\S/.test(l))
    .map((l) => l.trim());
  const total = /Total: (\d+) areas/.exec(stdout);
  assert.ok(total, `missing Total line in:\n${stdout}`);
  assert.equal(Number(total[1]), names.length, 'Total line disagrees with printed rows');
  return names;
}

async function assertParity(index: string, expected: string[], providerDir?: string) {
  const web = parseAreaIndex(index);
  const cli = await cliAreas(index, providerDir);
  assert.deepEqual(web, expected, 'web parseAreaIndex');
  assert.deepEqual(cli, expected, 'sly-kanban areas');
}

const CANONICAL = `# Area Index

Updated: 2026-09-11

## Areas

### web-frontend
- path: areas/web-frontend.md
- updated: 2026-09-13
- load-when: tooltip, dashboard
- notes:
  - some note

### terminal-bridge
- path: areas/terminal-bridge.md
- updated: 2026-09-10

### skills
- path: areas/skills.md
`;

test('canonical index: exactly the ### entries with a path line, sorted; no Areas row', async () => {
  await assertParity(CANONICAL, ['skills', 'terminal-bridge', 'web-frontend']);
});

test('heading-only index (## Areas, no entries) yields zero areas', async () => {
  await assertParity('# Area Index\n\nUpdated: 2026-09-14\n\n## Areas\n', []);
});

test('empty file yields zero areas', async () => {
  await assertParity('', []);
});

test('traps: ##, ####, bold labels, list-bold, and ### without a path line are ignored', async () => {
  const index = `# Area Index

## Areas

## not-an-area
- path: areas/not-an-area.md

#### too-deep
- path: areas/too-deep.md

**bold-label**
- path: areas/bold-label.md

- **list-bold**

### no-path-line
- updated: 2026-09-14
- load-when: nothing

### real-one
- path: areas/real-one.md

### spaced heading
- path: areas/spaced.md
`;
  await assertParity(index, ['real-one']);
});

test('blank lines between the heading and its path line are tolerated; CRLF too', async () => {
  const index = '## Areas\r\n\r\n### crlf-area\r\n\r\n- path: areas/crlf-area.md\r\n';
  await assertParity(index, ['crlf-area']);
});

test('duplicate headings are reported once', async () => {
  const index = '## Areas\n\n### dup\n- path: a\n\n### dup\n- path: b\n';
  await assertParity(index, ['dup']);
});

test('index resolves under .agents/ when there is no .claude/ (Codex/OpenCode workspace)', async () => {
  await assertParity(CANONICAL, ['skills', 'terminal-bridge', 'web-frontend'], '.agents');
});

test('web and CLI agree on the repo\'s own area-index.md', async () => {
  const own = await fs.readFile(
    path.join(REPO_ROOT, '.claude', 'skills', 'context-priming', 'references', 'area-index.md'),
    'utf-8',
  );
  const web = parseAreaIndex(own);
  assert.ok(web.length > 0);
  assert.ok(!web.includes('Areas'), 'the ## Areas grouping heading must not be an area');
  const { stdout } = await execFileP('node', [CLI, 'areas'], { cwd: REPO_ROOT, timeout: 15000, windowsHide: true });
  for (const name of web) assert.match(stdout, new RegExp(`^ {2}${name}$`, 'm'));
  assert.match(stdout, new RegExp(`Total: ${web.length} areas`));
});
