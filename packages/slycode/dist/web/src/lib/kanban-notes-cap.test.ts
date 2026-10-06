/**
 * CLI notes hard-cap tests (#0370).
 *
 * The Daily Security Audit wrote its run note as
 * `sly-kanban notes <card> add "…" 2>&1 | tail -1`. At the 100-note hard cap the
 * add failed, but tail kept only a recovery-hint line and the pipeline exited 0,
 * so the failure looked like success for weeks. These tests pin the contract:
 *  - at the cap, add exits non-zero and BOTH the first and last output lines
 *    say the note was NOT added (survives head -1 and tail -1)
 *  - the add that reaches the cap warns that the next add will fail
 *  - the documented recovery (oldest → summarize → add) works
 *
 * Spawns the real CLI (scripts/kanban.js) against a temp board, same harness as
 * kanban-resolve.test.ts. Run via the tsx binary in bridge/:
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/kanban-notes-cap.test.ts
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

function notes(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    text: `run note ${i + 1}`,
    timestamp: new Date(Date.UTC(2026, 4, 1 + i)).toISOString(),
    agent: 'audit',
  }));
}

function card(id: string, number: number, title: string, noteCount: number) {
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
    agentNotes: notes(noteCount),
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

before(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-notes-cap-test-'));
  const docs = path.join(workspace, 'documentation');
  await fs.mkdir(docs, { recursive: true });
  const board = {
    project_id: 'notes-cap-test',
    stages: {
      backlog: [
        card('card-1000000000001', 1, 'Full card', 100),
        card('card-1000000000002', 2, 'Nearly full card', 99),
      ],
      design: [],
      implementation: [],
      testing: [],
      done: [],
    },
    last_updated: '2026-01-01T00:00:00.000Z',
    nextCardNumber: 3,
  };
  await fs.writeFile(path.join(docs, 'kanban.json'), JSON.stringify(board, null, 2));
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

async function noteCount(cardId: string): Promise<number> {
  const raw = await fs.readFile(path.join(workspace, 'documentation', 'kanban.json'), 'utf-8');
  const board = JSON.parse(raw);
  for (const stage of Object.values(board.stages) as Array<Array<{ id: string; agentNotes?: unknown[] }>>) {
    const found = stage.find((c) => c.id === cardId);
    if (found) return found.agentNotes?.length ?? 0;
  }
  throw new Error(`card ${cardId} not in board`);
}

const NOT_ADDED = /NOT added.*hard cap/;

test('add at the hard cap fails, and both ends of the output say so', async () => {
  const r = await run('notes', '1', 'add', 'tonight', '--agent', 'audit');
  assert.equal(r.code, 1);
  const lines = (r.stdout + r.stderr).trim().split('\n');
  assert.match(lines[0], NOT_ADDED, 'first line must carry the failure');
  assert.match(lines[lines.length - 1], NOT_ADDED, 'last line must carry the failure');
  assert.match(r.stderr, /notes 1 oldest 20/);
  assert.match(r.stderr, /notes 1 summarize/);
  assert.equal(await noteCount('card-1000000000001'), 100, 'nothing written');
});

test('the audit pipe (2>&1 | tail -1) still shows the failure', async () => {
  // Exactly the shape the audit used. The pipeline exit is tail's (0), so the
  // text is the only signal left: it must not look like a hint.
  const { stdout } = await execFileP(
    'sh',
    ['-c', `node "${CLI}" notes 1 add "tonight" --agent audit 2>&1 | tail -1`],
    { cwd: workspace, timeout: 15000, windowsHide: true },
  );
  assert.match(stdout.trim(), NOT_ADDED);
});

test('the add that reaches the cap warns that the next add will fail', async () => {
  const r = await run('notes', '2', 'add', 'last one', '--agent', 'audit');
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Added note #100/);
  assert.match(r.stdout, /NEXT note add will fail/);
  assert.equal(await noteCount('card-1000000000002'), 100);
});

test('recovery: oldest → summarize → add succeeds', async () => {
  const oldest = await run('notes', '1', 'oldest', '20');
  assert.equal(oldest.code, 0);
  assert.match(oldest.stdout, /Oldest 20 of 100 notes/);

  const sum = await run('notes', '1', 'summarize', 'Runs 1-20: all clean.', '--count', '20', '--agent', 'audit');
  assert.equal(sum.code, 0, sum.stderr);
  assert.match(sum.stdout, /Remaining notes: 81/);

  const add = await run('notes', '1', 'add', 'tonight', '--agent', 'audit');
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /Added note #/);
  assert.equal(await noteCount('card-1000000000001'), 82);
});
