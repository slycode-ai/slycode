/**
 * Cross-project card prompting (feature #0350): --project resolution, the
 * per-project opt-in gate on BOTH routes, read-only scope, and audit events.
 *
 * Spawns the real CLI (scripts/kanban.js) against a scaffolded temp WORKSPACE
 * (projects/registry.json + its own board) and a second registered project
 * directory outside it. BRIDGE_URL points at a dead port, so a prompt that
 * passes the gate fails with "Bridge is not running" — that failure is the
 * proof the gate let it through, while a refusal exits 3 before any fetch.
 *
 *   ./bridge/node_modules/.bin/tsx web/src/lib/kanban-cross-project.test.ts
 */

import { test, before, after } from 'node:test';
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
const DEAD_BRIDGE = 'http://127.0.0.1:1';

let tmp: string;
let workspace: string;   // registry lives here; also has its own board (id ws-main)
let other: string;       // registered project OUTSIDE the workspace (id other-proj)
let nowhere: string;     // a directory with no board and no registry

function card(id: string, number: number, title: string) {
  return {
    id, number, title, description: 'desc', type: 'chore', priority: 'low', order: 10,
    areas: [], tags: [], problems: [], checklist: [],
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function board(projectId: string, cards: ReturnType<typeof card>[], settings?: Record<string, unknown>) {
  return {
    project_id: projectId,
    stages: { backlog: cards, design: [], implementation: [], testing: [], done: [] },
    last_updated: '2026-01-01T00:00:00.000Z',
    nextCardNumber: 10,
    ...(settings ? { settings } : {}),
  };
}

async function writeOtherBoard(settings?: Record<string, unknown>) {
  await fs.writeFile(
    path.join(other, 'documentation', 'kanban.json'),
    JSON.stringify(board('other-proj', [card('card-2000000000001', 1, 'Other card')], settings), null, 2),
  );
}

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'kanban-xproj-test-'));
  workspace = path.join(tmp, 'ws_main');
  other = path.join(tmp, 'other_proj');
  nowhere = path.join(tmp, 'nowhere');
  await fs.mkdir(path.join(workspace, 'documentation'), { recursive: true });
  await fs.mkdir(path.join(workspace, 'projects'), { recursive: true });
  await fs.mkdir(path.join(other, 'documentation'), { recursive: true });
  await fs.mkdir(nowhere, { recursive: true });

  await fs.writeFile(
    path.join(workspace, 'documentation', 'kanban.json'),
    JSON.stringify(board('ws-main', [card('card-1000000000001', 1, 'Main card')]), null, 2),
  );
  await writeOtherBoard();
  await fs.writeFile(path.join(workspace, 'projects', 'registry.json'), JSON.stringify({
    version: '2.0.0',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    projects: [
      { id: 'ws-main', name: 'Main Workspace', path: workspace, areas: [], tags: [], order: 0 },
      // sessionKey computed from the path basename (other_proj → other-proj);
      // an explicit legacy alias so alias resolution and alias-aware gating
      // are both exercised.
      { id: 'other-proj', name: 'Other Project', path: other, areas: [], tags: ['shared-tag'], order: 1, sessionKeyAliases: ['legacy-other'] },
    ],
  }, null, 2));
});

after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

interface RunOpts { cwd?: string; env?: Record<string, string> }
async function run(args: string[], opts: RunOpts = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  // Strip anything the real SlyCode environment might inject so the test is
  // hermetic: no session identity, no workspace pointer, no live bridge.
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (k === 'SLYCODE_SESSION' || k === 'SLYCODE_HOME' || k === 'BRIDGE_URL' || k === 'SLYCODE_BRIDGE_URL') continue;
    env[k] = v;
  }
  Object.assign(env, { BRIDGE_URL: DEAD_BRIDGE }, opts.env ?? {});
  try {
    const { stdout, stderr } = await execFileP('node', [CLI, ...args], {
      cwd: opts.cwd ?? workspace, env, timeout: 20000, windowsHide: true,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

async function readEvents(root: string): Promise<Array<{ type: string; detail: string; project: string; card?: string }>> {
  try {
    return JSON.parse(await fs.readFile(path.join(root, 'documentation', 'events.json'), 'utf-8'));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Discovery + resolution
// ---------------------------------------------------------------------------

test('projects: lists registered projects with the cross-project flag (default off)', async () => {
  const r = await run(['projects']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /ws-main\s+Main Workspace\s+ws-main\s+off/);
  assert.match(r.stdout, /other-proj\s+Other Project\s+other-proj\s+off/);

  const j = await run(['projects', '--json']);
  const rows = JSON.parse(j.stdout) as Array<{ id: string; allowCrossProjectPrompts: boolean }>;
  assert.deepEqual(rows.map(x => [x.id, x.allowCrossProjectPrompts]), [['ws-main', false], ['other-proj', false]]);
});

test('--project resolves by id, session key, alias and case-insensitive name', async () => {
  for (const ref of ['other-proj', 'legacy-other', 'Other Project', 'other project']) {
    const r = await run(['show', '--project', ref, '1']);
    assert.equal(r.code, 0, `ref "${ref}" failed: ${r.stderr}`);
    assert.match(r.stdout, /Other card/, `ref "${ref}" resolved the wrong board`);
  }
  // Flag position is free — before or after the positional args.
  const trailing = await run(['show', '1', '--project', 'other-proj']);
  assert.match(trailing.stdout, /Other card/);
});

test('--project: tags are not refs; unknown ref lists the registered projects', async () => {
  const r = await run(['show', '--project', 'shared-tag', '1']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /No registered project matches "shared-tag"/);
  assert.match(r.stderr, /other-proj · Other Project · other-proj/);
});

test('--project works from a cwd with no board when SLYCODE_HOME points at the workspace', async () => {
  const without = await run(['show', '1'], { cwd: nowhere });
  assert.equal(without.code, 1);
  assert.match(without.stderr, /No kanban board found/);

  const withHome = await run(['show', '--project', 'other-proj', '1'], { cwd: nowhere, env: { SLYCODE_HOME: workspace } });
  assert.equal(withHome.code, 0, withHome.stderr);
  assert.match(withHome.stdout, /Other card/);
});

test('--project is read-only except for prompt', async () => {
  const update = await run(['update', '--project', 'other-proj', '1', '--title', 'Hijacked']);
  assert.equal(update.code, 1);
  assert.match(update.stderr, /--project is read-only except for 'prompt'/);

  const notesAdd = await run(['notes', '--project', 'other-proj', '1', 'add', 'sneaky', '--agent', 'Test']);
  assert.equal(notesAdd.code, 1);
  assert.match(notesAdd.stderr, /read-only/);

  const notesList = await run(['notes', '--project', 'other-proj', '1', 'list']);
  assert.equal(notesList.code, 0, notesList.stderr);

  const statusRead = await run(['status', '--project', 'other-proj', '1']);
  assert.equal(statusRead.code, 0, statusRead.stderr);
  const statusWrite = await run(['status', '--project', 'other-proj', '1', 'Hijacked']);
  assert.equal(statusWrite.code, 1);

  // Nothing leaked onto the other board.
  const b = JSON.parse(await fs.readFile(path.join(other, 'documentation', 'kanban.json'), 'utf-8'));
  assert.equal(b.stages.backlog[0].title, 'Other card');
  assert.equal(b.stages.backlog[0].status, undefined);
});

// ---------------------------------------------------------------------------
// The gate — explicit --project route
// ---------------------------------------------------------------------------

const CALLER = { SLYCODE_SESSION: 'ws-main:claude:card:card-1000000000001' };

test('prompt --project: refused with exit 3 when the target has the setting off', async () => {
  await writeOtherBoard();
  const r = await run(['prompt', '--project', 'other-proj', '1', 'do the thing'], { env: CALLER });
  assert.equal(r.code, 3, `expected refusal exit 3, got ${r.code}: ${r.stderr}`);
  assert.match(r.stderr, /Refused: project "Other Project" \(other-proj\) does not accept cross-project prompts/);
  assert.match(r.stderr, /Accept cross-project prompts/);
  assert.match(r.stderr, /Do not work around this/);
  assert.match(r.stderr, /Tell the user/);
  assert.doesNotMatch(r.stderr, /Bridge is not running/, 'gate must fire before the bridge is contacted');

  const events = await readEvents(other);
  const refused = events.find(e => /refused \(setting off\)/.test(e.detail));
  assert.ok(refused, 'target board must record the refused attempt');
  assert.match(refused!.detail, /from ws-main #0001/);
  assert.equal(refused!.card, 'card-2000000000001');
});

test('prompt --project: passes the gate when the setting is on (fails only at the dead bridge)', async () => {
  await writeOtherBoard({ allowCrossProjectPrompts: true });
  const r = await run(['prompt', '--project', 'other-proj', '1', 'do the thing'], { env: CALLER });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stderr, /Refused/);
  assert.match(r.stderr, /Bridge is not running/);
});

test('prompt --project: ALWAYS gated for a foreign target, even from a plain shell (no SLYCODE_SESSION)', async () => {
  // Review ruling on #0350: the flag is the target project's policy, so an
  // explicit --project to another project's board is refused regardless of
  // who is asking. Humans included — the flag is flipped in the target's UI.
  await writeOtherBoard();
  const r = await run(['prompt', '--project', 'other-proj', '1', 'do the thing']);
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /Refused: project "Other Project" \(other-proj\)/);
  assert.doesNotMatch(r.stderr, /Bridge is not running/);
  const events = await readEvents(other);
  const refused = events.filter(e => /refused \(setting off\)/.test(e.detail)).pop();
  assert.ok(refused);
  assert.match(refused!.detail, /from ws-main \(shell, no session\)/);

  await writeOtherBoard({ allowCrossProjectPrompts: true });
  const ok = await run(['prompt', '--project', 'other-proj', '1', 'do the thing']);
  assert.doesNotMatch(ok.stderr, /Refused/);
  assert.match(ok.stderr, /Bridge is not running/);
});

test('prompt --project naming the cwd\'s OWN project is not cross-project', async () => {
  // ws-main has no flag; --project ws-main from inside ws-main must behave
  // exactly like omitting the flag.
  const r = await run(['prompt', '--project', 'ws-main', '1', 'do the thing']);
  assert.doesNotMatch(r.stderr, /Refused/);
  assert.match(r.stderr, /Bridge is not running/);
  const withSession = await run(['prompt', '--project', 'Main Workspace', '1', 'do the thing'], { env: CALLER });
  assert.doesNotMatch(withSession.stderr, /Refused/);
  assert.match(withSession.stderr, /Bridge is not running/);
});

test('caller identity that matches more than one registered project is rejected as ambiguous', async () => {
  // A second workspace whose registry has a COLLISION: "legacy-other" is both
  // an alias of other-proj and the canonical id of a third project. A caller
  // whose session key is "legacy-other" must not be exempted via the alias.
  const ws2 = path.join(tmp, 'ws_collide');
  const third = path.join(tmp, 'legacy_other');
  await fs.mkdir(path.join(ws2, 'projects'), { recursive: true });
  await fs.mkdir(path.join(ws2, 'documentation'), { recursive: true });
  await fs.mkdir(path.join(third, 'documentation'), { recursive: true });
  await fs.writeFile(path.join(ws2, 'documentation', 'kanban.json'), JSON.stringify(board('ws-collide', [])));
  await fs.writeFile(path.join(third, 'documentation', 'kanban.json'), JSON.stringify(board('legacy-other', [card('card-3000000000001', 1, 'Third card')])));
  await fs.writeFile(path.join(ws2, 'projects', 'registry.json'), JSON.stringify({
    version: '2.0.0', lastUpdated: '2026-01-01T00:00:00.000Z',
    projects: [
      { id: 'ws-collide', name: 'Collide Workspace', path: ws2, areas: [], tags: [], order: 0 },
      { id: 'other-proj', name: 'Other Project', path: other, areas: [], tags: [], order: 1, sessionKeyAliases: ['legacy-other'] },
      { id: 'legacy-other', name: 'Legacy Other', path: third, areas: [], tags: [], order: 2 },
    ],
  }));

  await writeOtherBoard();
  const r = await run(['prompt', '1', 'do the thing'], {
    cwd: other,
    env: { SLYCODE_SESSION: 'legacy-other:claude:card:card-3000000000001', SLYCODE_HOME: ws2 },
  });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /matches more than one registered project/);
  assert.match(r.stderr, /other-proj \(other-proj\), legacy-other \(legacy-other\)/);
  assert.doesNotMatch(r.stderr, /Bridge is not running/);
  const events = await readEvents(other);
  assert.ok(events.some(e => /rejected \(ambiguous caller identity/.test(e.detail)));

  // Even with the flag ON the ambiguity is rejected — attribution would be a lie.
  await writeOtherBoard({ allowCrossProjectPrompts: true });
  const on = await run(['prompt', '1', 'do the thing'], {
    cwd: other,
    env: { SLYCODE_SESSION: 'legacy-other:claude:card:card-3000000000001', SLYCODE_HOME: ws2 },
  });
  assert.equal(on.code, 3);
  assert.match(on.stderr, /ambiguous/);

  // A caller that canonically resolves to the third project (its own
  // sessionKey, no collision) is plain cross-project → refused by the flag.
  await writeOtherBoard();
  const foreign = await run(['prompt', '1', 'do the thing'], {
    cwd: other,
    env: { SLYCODE_SESSION: 'legacy-other-x:claude:card:x', SLYCODE_HOME: ws2 },
  });
  assert.equal(foreign.code, 3);
  assert.match(foreign.stderr, /does not accept cross-project prompts/);
});

test('questionnaire/session dispatch: --project is stripped before positional subcommands', async () => {
  const list = await run(['questionnaire', '--project', 'other-proj', 'list', '1']);
  assert.equal(list.code, 0, list.stderr);
  // `answers` on a card with none attached is a legitimate exit 1 — the point
  // is that it reached the subcommand, not "Unknown subcommand: --project".
  const answers = await run(['questionnaire', 'answers', '1', '--project', 'other-proj']);
  assert.match(answers.stderr, /no questionnaires attached/);
  const patch = await run(['questionnaire', '--project', 'other-proj', 'answer', '1', '--name', 'x', '--item', 'q1', '--value', '"v"']);
  assert.equal(patch.code, 1);
  assert.match(patch.stderr, /read-only/);
  // session list reaches for the bridge (dead) — must fail there, not on dispatch
  const session = await run(['session', '--project', 'other-proj', 'list', '1']);
  assert.doesNotMatch(session.stderr + session.stdout, /Unknown subcommand|Unknown session subcommand/i);
});

// ---------------------------------------------------------------------------
// The gate — cwd route (running from inside the target's directory)
// ---------------------------------------------------------------------------

test('cwd route: a session from another project is refused the same way', async () => {
  await writeOtherBoard();
  const r = await run(['prompt', '1', 'do the thing'], { cwd: other, env: { ...CALLER, SLYCODE_HOME: workspace } });
  assert.equal(r.code, 3, r.stderr);
  assert.match(r.stderr, /Refused: project "Other Project" \(other-proj\)/);
});

test('cwd route: same project under a legacy alias prefix is NOT cross-project', async () => {
  await writeOtherBoard();
  const r = await run(['prompt', '1', 'do the thing'], {
    cwd: other,
    env: { SLYCODE_SESSION: 'legacy-other:claude:card:card-2000000000001', SLYCODE_HOME: workspace },
  });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stderr, /Refused/);
  assert.match(r.stderr, /Bridge is not running/);
});

test('cwd route: own-project session and human shell are not gated', async () => {
  await writeOtherBoard();
  const own = await run(['prompt', '1', 'do the thing'], {
    cwd: other,
    env: { SLYCODE_SESSION: 'other-proj:codex:card:card-2000000000001' },
  });
  assert.doesNotMatch(own.stderr, /Refused/);
  assert.match(own.stderr, /Bridge is not running/);

  const human = await run(['prompt', '1', 'do the thing'], { cwd: other });
  assert.doesNotMatch(human.stderr, /Refused/);
  assert.match(human.stderr, /Bridge is not running/);
});

// ---------------------------------------------------------------------------
// Delivery bookkeeping must not clobber concurrent board edits
// ---------------------------------------------------------------------------

test('markDelivered re-reads the board: a flag switched off and a title edited mid-startup survive', async () => {
  // Fake bridge: first GET /sessions/:name → 404 (no session), POST /sessions
  // → 200 (and that is the moment the "owner" edits the board on disk), later
  // GET /sessions/:name → running. Everything else → 200 {}.
  const http = await import('node:http');
  let sessionCreated = false;
  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '';
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && url.startsWith('/sessions/')) {
      return sessionCreated ? json(200, { status: 'running' }) : json(404, { error: 'not found' });
    }
    if (req.method === 'POST' && url === '/sessions') {
      // Owner turns the flag OFF and edits a title while the CLI waits for
      // the session to come up.
      const b = board('other-proj', [card('card-2000000000001', 1, 'Other card (edited by owner)')], { allowCrossProjectPrompts: false });
      await fs.writeFile(path.join(other, 'documentation', 'kanban.json'), JSON.stringify(b, null, 2));
      sessionCreated = true;
      return json(200, { success: true });
    }
    if (req.method === 'POST' && url.endsWith('/chain')) return json(200, { success: true });
    return json(200, {});
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;

  try {
    await writeOtherBoard({ allowCrossProjectPrompts: true });
    const r = await run(['prompt', '--project', 'other-proj', '1', 'do the thing'], {
      env: { ...CALLER, BRIDGE_URL: `http://127.0.0.1:${port}` },
    });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Prompt delivered/);

    const b = JSON.parse(await fs.readFile(path.join(other, 'documentation', 'kanban.json'), 'utf-8'));
    assert.equal(b.settings.allowCrossProjectPrompts, false, 'the owner\'s flag flip must not be resurrected');
    assert.equal(b.stages.backlog[0].title, 'Other card (edited by owner)', 'concurrent title edit must survive');
    assert.equal(b.stages.backlog[0].status?.text, 'Prompt received from ws-main');
    assert.equal(b.stages.backlog[0].status?.kind, 'auto');

    const callerEvents = await readEvents(workspace);
    assert.ok(callerEvents.some(e => /Cross-project prompt sent to other-proj #0001/.test(e.detail)), 'caller board gets the hand-off event');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('cwd route: setting on lets a foreign session through', async () => {
  await writeOtherBoard({ allowCrossProjectPrompts: true });
  const r = await run(['prompt', '1', 'do the thing'], { cwd: other, env: { ...CALLER, SLYCODE_HOME: workspace } });
  assert.equal(r.code, 1);
  assert.doesNotMatch(r.stderr, /Refused/);
  assert.match(r.stderr, /Bridge is not running/);
});

// ---------------------------------------------------------------------------
// Project status (#0381): `projects status`, and held targets refuse prompts
// ---------------------------------------------------------------------------

async function readRegistryEntry(id: string): Promise<Record<string, string | undefined>> {
  const reg = JSON.parse(await fs.readFile(path.join(workspace, 'projects', 'registry.json'), 'utf-8'));
  return reg.projects.find((p: { id: string }) => p.id === id);
}

test('projects status: print, set paused, no-op on unchanged, resumedAt only on → active', async () => {
  const print = await run(['projects', 'status', 'other-proj']);
  assert.equal(print.code, 0, print.stderr);
  assert.match(print.stdout, /Other Project \(other-proj\): active/);

  const bad = await run(['projects', 'status', 'other-proj', 'sleeping']);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /status must be one of active, paused, complete, archived/);

  const pause = await run(['projects', 'status', 'Other Project', 'paused']);
  assert.equal(pause.code, 0, pause.stderr);
  assert.match(pause.stdout, /Marked paused Other Project \(active → paused\)/);
  assert.match(pause.stdout, /Sessions already running finish on their own/);
  let e = await readRegistryEntry('other-proj');
  assert.equal(e.status, 'paused');
  assert.ok(e.statusChangedAt);
  assert.equal(e.resumedAt, undefined, 'pausing never stamps resumedAt');
  const pausedAt = e.statusChangedAt;

  const again = await run(['projects', 'status', 'other-proj', 'paused']);
  assert.match(again.stdout, /already paused\. Nothing changed/);
  e = await readRegistryEntry('other-proj');
  assert.equal(e.statusChangedAt, pausedAt, 'no-op does not move statusChangedAt');

  const list = await run(['projects']);
  assert.match(list.stdout, /other-proj\s+Other Project\s+other-proj\s+held\s+paused/);
  const rows = JSON.parse((await run(['projects', '--json'])).stdout) as Array<{ id: string; status: string }>;
  assert.deepEqual(rows.map(r => [r.id, r.status]), [['ws-main', 'active'], ['other-proj', 'paused']], 'active first');

  const events = await readEvents(workspace);
  assert.ok(events.some(ev => ev.type === 'project_status' && /Marked paused: Other Project/.test(ev.detail)));
});

test('prompt --project into a paused project: refused (exit 3) even with the opt-in on', async () => {
  await writeOtherBoard({ allowCrossProjectPrompts: true });
  const r = await run(['prompt', '--project', 'other-proj', '1', 'do the thing'], { env: CALLER });
  assert.equal(r.code, 3, `expected refusal exit 3, got ${r.code}: ${r.stderr}`);
  assert.match(r.stderr, /Refused: project "Other Project" \(other-proj\) is paused/);
  assert.match(r.stderr, /sly-kanban projects status other-proj active/);
  assert.match(r.stderr, /Do not work around this/);
  assert.doesNotMatch(r.stderr, /Bridge is not running/, 'refused before any bridge call');
});

test('a held project is still readable cross-project, and its own sessions are not gated', async () => {
  const show = await run(['show', '--project', 'other-proj', '1']);
  assert.equal(show.code, 0, show.stderr);
  // Prompting a paused project from its OWN board is not cross-project → passes to the (dead) bridge.
  const own = await run(['prompt', '1', 'hi'], { cwd: other, env: { SLYCODE_HOME: workspace, SLYCODE_SESSION: 'other-proj:claude:card:card-2000000000001' } });
  assert.notEqual(own.code, 3, own.stderr);
});

test('projects status write is refused through --project', async () => {
  const r = await run(['projects', 'status', 'other-proj', 'active', '--project', 'other-proj']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /read-only/);
});

test('projects status: resume stamps resumedAt; complete/archived also refuse prompts', async () => {
  const resume = await run(['projects', 'status', 'other-proj', 'active']);
  assert.equal(resume.code, 0, resume.stderr);
  assert.match(resume.stdout, /Resumed Other Project \(paused → active\)/);
  assert.match(resume.stdout, /skipped, not replayed/);
  const e = await readRegistryEntry('other-proj');
  assert.equal(e.status, 'active');
  assert.ok(e.resumedAt);
  assert.equal(e.resumedAt, e.statusChangedAt);

  for (const st of ['complete', 'archived']) {
    await run(['projects', 'status', 'other-proj', st]);
    const r = await run(['prompt', '--project', 'other-proj', '1', 'x'], { env: CALLER });
    assert.equal(r.code, 3, `${st}: ${r.stderr}`);
    assert.match(r.stderr, new RegExp(`is ${st}`));
  }
  const restore = await run(['projects', 'status', 'other-proj', 'active']);
  assert.match(restore.stdout, /Restored Other Project \(archived → active\)/);
});

// ---------------------------------------------------------------------------
// Den folders (#0381 Phase B): `projects folder` / `projects folders`
// ---------------------------------------------------------------------------

async function readRegistry(): Promise<{ folders?: Array<{ id: string; name: string; order: number }>; projects: Array<Record<string, string | undefined>> }> {
  return JSON.parse(await fs.readFile(path.join(workspace, 'projects', 'registry.json'), 'utf-8'));
}

test('projects folder: creates on first use, slug id, FOLDER column, case-insensitive reuse', async () => {
  const empty = await run(['projects', 'folders']);
  assert.match(empty.stdout, /No folders/);

  const r = await run(['projects', 'folder', 'other-proj', '  Client   Work ']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Created folder "Client Work" and moved Other Project into "Client Work"/);
  let reg = await readRegistry();
  assert.deepEqual(reg.folders, [{ id: 'fld-client-work', name: 'Client Work', order: 0 }]);
  assert.equal(reg.projects.find(p => p.id === 'other-proj')!.folderId, 'fld-client-work');

  const again = await run(['projects', 'folder', 'ws-main', 'client work']);
  assert.match(again.stdout, /^Moved Main Workspace into "Client Work"/);
  reg = await readRegistry();
  assert.equal(reg.folders!.length, 1, 'reused, not duplicated');

  const list = await run(['projects']);
  assert.match(list.stdout, /ws-main\s+Main Workspace\s+ws-main\s+off\s+active\s+Client Work/);

  const folders = JSON.parse((await run(['projects', 'folders', '--json'])).stdout);
  assert.deepEqual(folders, [{ id: 'fld-client-work', name: 'Client Work', order: 0, projects: ['ws-main', 'other-proj'] }]);
});

test('projects folders rename keeps the id; validation errors change nothing', async () => {
  await run(['projects', 'folder', 'ws-main', 'Personal']);
  const clash = await run(['projects', 'folders', 'rename', 'Personal', 'CLIENT WORK']);
  assert.equal(clash.code, 1);
  assert.match(clash.stderr, /already exists\. Nothing changed/);
  const tooLong = await run(['projects', 'folder', 'ws-main', 'x'.repeat(41)]);
  assert.equal(tooLong.code, 1);
  assert.match(tooLong.stderr, /40 characters or fewer/);

  const ok = await run(['projects', 'folders', 'rename', 'client work', 'Clients']);
  assert.equal(ok.code, 0, ok.stderr);
  const reg = await readRegistry();
  const f = reg.folders!.find(x => x.id === 'fld-client-work')!;
  assert.equal(f.name, 'Clients');
  assert.equal(reg.projects.find(p => p.id === 'other-proj')!.folderId, 'fld-client-work', 'assignment survives rename');
});

test('projects folders delete unfiles projects (nothing removed); folder --none; --project refused', async () => {
  const del = await run(['projects', 'folders', 'delete', 'Clients']);
  assert.equal(del.code, 0, del.stderr);
  assert.match(del.stdout, /Deleted folder "Clients"\. 1 project moved to no folder; no projects were removed/);
  let reg = await readRegistry();
  assert.equal(reg.projects.length, 2);
  assert.equal(reg.projects.find(p => p.id === 'other-proj')!.folderId, undefined);

  const none = await run(['projects', 'folder', 'ws-main', '--none']);
  assert.match(none.stdout, /Moved Main Workspace out of "Personal"/);
  reg = await readRegistry();
  assert.equal(reg.projects.find(p => p.id === 'ws-main')!.folderId, undefined);
  assert.ok(reg.folders!.some(x => x.name === 'Personal'), 'unfiling never deletes the folder');

  const viaProject = await run(['projects', 'folder', 'ws-main', 'X', '--project', 'other-proj']);
  assert.equal(viaProject.code, 1);
  assert.match(viaProject.stderr, /read-only/);
  const listViaProject = await run(['projects', 'folders', '--project', 'other-proj']);
  assert.equal(listViaProject.code, 0, listViaProject.stderr);
});
