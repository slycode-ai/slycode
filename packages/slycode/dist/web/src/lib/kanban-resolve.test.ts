/**
 * CLI resolution tests: card numbers as first-class identifiers.
 *
 * Spawns the real CLI (scripts/kanban.js) against a scaffolded temp workspace
 * — the CLI resolves its board by walking up from cwd to find
 * documentation/kanban.json, so no mocking is needed.
 *
 * Covers the resolution contract:
 *  - '#0274', '0274', '274', and the long ID all resolve to the same card
 *  - archived cards resolve by number from cold storage (--include-archived)
 *  - unknown number → loud, distinct error + non-zero exit
 *  - numbers win over digits-only titles (documented precedence)
 *  - exact-title resolution still works
 *
 * Self-contained node:test script (matches kanban-cold.test.ts). Run via the
 * tsx binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/kanban-resolve.test.ts
 */

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CLI = path.join(REPO_ROOT, 'scripts', 'kanban.js');

let workspace: string;

function card(id: string, number: number, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    number,
    title,
    description: '',
    type: 'chore',
    priority: 'low',
    order: 10,
    areas: [],
    tags: [],
    problems: [],
    checklist: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-resolve-test-'));
  const docs = path.join(workspace, 'documentation');
  await fs.mkdir(docs, { recursive: true });

  const hot = {
    project_id: 'resolve-test',
    stages: {
      backlog: [
        card('card-1000000000001', 1, 'Alpha card'),
        // Trap: a card whose TITLE is another card's number. Number resolution
        // must win over this title when the user types "2".
        card('card-1000000000003', 3, '2'),
      ],
      design: [card('card-1000000000002', 2, 'Beta card')],
      implementation: [],
      testing: [],
      done: [],
    },
    last_updated: '2026-01-01T00:00:00.000Z',
    nextCardNumber: 5,
  };
  const cold = {
    project_id: 'resolve-test',
    stages: {
      backlog: [],
      design: [],
      implementation: [],
      testing: [],
      done: [card('card-1000000000004', 4, 'Archived card', { archived: true })],
    },
    last_updated: '2026-01-01T00:00:00.000Z',
  };
  await fs.writeFile(path.join(docs, 'kanban.json'), JSON.stringify(hot, null, 2));
  await fs.writeFile(path.join(docs, 'kanban-archive.json'), JSON.stringify(cold, null, 2));
});

async function run(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileP('node', [CLI, ...args], {
      cwd: workspace,
      timeout: 15000,
      windowsHide: true,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test('show: long ID, #NNNN, NNNN, and unpadded N resolve identically', async () => {
  const byId = await run('show', 'card-1000000000002');
  assert.equal(byId.code, 0);
  assert.match(byId.stdout, /Beta card/);

  for (const ref of ['#0002', '0002', '2']) {
    const r = await run('show', ref);
    assert.equal(r.code, 0, `ref ${ref} should resolve (stderr: ${r.stderr})`);
    assert.equal(r.stdout, byId.stdout, `ref ${ref} must match long-ID output`);
  }
});

test('show: output leads with the card number, ID demoted to detail line', async () => {
  const r = await run('show', '1');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Card: #0001/);
  assert.match(r.stdout, /ID: card-1000000000001/);
});

test('show: archived card resolves by number from cold storage', async () => {
  const withFlag = await run('show', '4', '--include-archived');
  assert.equal(withFlag.code, 0, withFlag.stderr);
  assert.match(withFlag.stdout, /Archived card/);
  assert.match(withFlag.stdout, /\[ARCHIVED\]/);

  const withoutFlag = await run('show', '4');
  assert.equal(withoutFlag.code, 1, 'archived number without flag must miss');
  assert.match(withoutFlag.stderr, /No card with number #0004/);
});

test('unknown number fails loudly with a distinct message', async () => {
  const r = await run('show', '9999');
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No card with number #9999/);

  const hashed = await run('show', '#9999');
  assert.equal(hashed.code, 1);
  assert.match(hashed.stderr, /No card with number #9999/);
});

test('numbers win over digits-only titles', async () => {
  // '2' is both card #0002's number and card #0003's exact title — the
  // number must win (documented precedence).
  const r = await run('show', '2');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Beta card/);
  assert.doesNotMatch(r.stdout, /card-1000000000003/);
});

test('exact-title resolution still works', async () => {
  const r = await run('show', 'Alpha card');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /card-1000000000001/);
});

test('search: compact output leads with #number, long ID retained', async () => {
  const r = await run('search');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /#0001\tcard-1000000000001\t/);
});

test('move by number removes the card from the old stage (no duplication)', async () => {
  // Regression: cmdMove's old-stage removal filtered by the RAW user ref, so
  // a number-ref move pushed the card into the new stage without removing it
  // from the old one — the same card ended up in two stages.
  const r = await run('move', '1', 'design');
  assert.equal(r.code, 0, r.stderr);

  const board = JSON.parse(
    await fs.readFile(path.join(workspace, 'documentation', 'kanban.json'), 'utf-8')
  );
  const hits: string[] = [];
  for (const [stage, cards] of Object.entries(board.stages) as [string, { id: string }[]][]) {
    for (const c of cards) if (c.id === 'card-1000000000001') hits.push(stage);
  }
  assert.deepEqual(hits, ['design'], 'card must exist exactly once, in the new stage');
});
