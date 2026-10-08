/**
 * Registry write lock (card #0381 fix loop, Codex P1): every registry writer
 * does a fresh read → mutate → atomic write under one lock, so concurrent
 * writers keep BOTH changes. Temp SLYCODE_HOME — never the real registry.
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/registry-lock.test.ts
 */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileP = promisify(execFile);
const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/kanban.js');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-lock-test-'));
const REGISTRY = path.join(home, 'projects', 'registry.json');
let reg: typeof import('./registry');

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function seed(withKeys = true) {
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true });
  fs.writeFileSync(REGISTRY, JSON.stringify({
    version: '2.0.0', lastUpdated: '',
    projects: ['alpha', 'beta'].map((id, i) => ({
      id, name: id, description: '', path: path.join(home, id), hasClaudeMd: false, masterCompliant: false,
      areas: [], tags: [], order: i, ...(withKeys ? { sessionKey: id, sessionKeyAliases: [] } : {}),
    })),
  }, null, 2));
}
const read = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf-8'));
const byId = (id: string) => read().projects.find((p: { id: string }) => p.id === id);

before(async () => {
  process.env.SLYCODE_HOME = home;
  // The CLI wants a board in its cwd even for `projects`.
  fs.mkdirSync(path.join(home, 'documentation'), { recursive: true });
  fs.writeFileSync(path.join(home, 'documentation', 'kanban.json'), JSON.stringify({ project_id: 'ws', stages: { backlog: [], design: [], implementation: [], testing: [], done: [] } }));
  seed();
  reg = await import('./registry');
});

test('pause vs reorder racing: both changes survive (no stale-snapshot overwrite)', async () => {
  seed();
  await Promise.all([
    reg.mutateRegistry(async (r) => {
      const p = r.projects.find(x => x.id === 'alpha')!;
      p.status = 'paused';
      p.statusChangedAt = new Date().toISOString();
      await sleep(120); // hold the lock while the other writer queues
    }),
    (async () => {
      await sleep(10);
      await reg.mutateRegistry((r) => {
        r.projects.find(x => x.id === 'alpha')!.order = 1;
        r.projects.find(x => x.id === 'beta')!.order = 0;
      });
    })(),
  ]);
  assert.equal(byId('alpha').status, 'paused');
  assert.equal(byId('alpha').order, 1);
  assert.equal(byId('beta').order, 0);
  assert.equal(fs.existsSync(`${REGISTRY}.lock`), false, 'lock released');
});

test('session-key self-heal no longer overwrites a concurrent pause', async () => {
  seed(false); // sessionKey missing → loadRegistry will heal + persist
  await Promise.all([
    reg.mutateRegistry(async (r) => {
      r.projects.find(x => x.id === 'beta')!.status = 'paused';
      await sleep(120);
    }),
    (async () => { await sleep(10); await reg.loadRegistry(); })(),
  ]);
  assert.equal(byId('beta').status, 'paused', 'pause kept');
  assert.equal(byId('beta').sessionKey, 'beta', 'heal persisted');
});

test('no-op mutation writes nothing; a throwing mutation writes nothing', async () => {
  seed();
  const before = fs.readFileSync(REGISTRY, 'utf-8');
  await reg.mutateRegistry(() => undefined);
  await assert.rejects(reg.mutateRegistry((r) => { r.projects[0].name = 'changed'; throw new Error('abort'); }), /abort/);
  assert.equal(fs.readFileSync(REGISTRY, 'utf-8'), before);
});

test('cross-process: a CLI write while the web holds the lock keeps both changes', async () => {
  seed();
  const env = { ...process.env, SLYCODE_HOME: home };
  delete (env as Record<string, string | undefined>).SLYCODE_SESSION;
  let cli: Promise<{ stdout: string }> | null = null;
  await reg.mutateRegistry(async (r) => {
    r.projects.find(x => x.id === 'alpha')!.status = 'paused';
    // Start the CLI while we hold the lock; it must wait, then read fresh.
    cli = execFileP('node', [CLI, 'projects', 'folder', 'beta', 'Work'], { cwd: home, env, timeout: 20000 });
    await sleep(250);
  });
  const out = await cli!;
  assert.match(out.stdout, /Created folder "Work"/);
  assert.equal(byId('alpha').status, 'paused', 'web change kept');
  assert.equal(byId('beta').folderId, 'fld-work', 'CLI change kept');

  // And the other direction: CLI status write vs web folder write.
  await Promise.all([
    execFileP('node', [CLI, 'projects', 'status', 'beta', 'complete'], { cwd: home, env, timeout: 20000 }),
    reg.mutateRegistry(async (r) => { r.projects.find(x => x.id === 'alpha')!.order = 5; await sleep(50); }),
  ]);
  assert.equal(byId('beta').status, 'complete');
  assert.equal(byId('alpha').order, 5);
});

// ---------------------------------------------------------------------------
// Fix loop 2: the registry lock FAILS CLOSED (never runs a mutation unlocked)
// ---------------------------------------------------------------------------

const LOCK = `${REGISTRY}.lock`;
function holdLock(info: Record<string, unknown> = { pid: process.pid, host: os.hostname(), token: 'someone-else', ts: Date.now() }) {
  fs.writeFileSync(LOCK, JSON.stringify(info));
}

test('contention past the deadline → RegistryLockError, mutation never runs, file untouched', async () => {
  seed();
  const before = fs.readFileSync(REGISTRY, 'utf-8');
  holdLock(); // live pid (this process), fresh, foreign token
  let ran = false;
  const { RegistryLockError } = await import('./registry-lock');
  const t0 = Date.now();
  await assert.rejects(
    reg.mutateRegistry((r) => { ran = true; r.projects[0].status = 'paused'; }, { timeoutMs: 300 }),
    (e: Error) => e instanceof RegistryLockError && /registry is busy/.test(e.message),
  );
  assert.ok(Date.now() - t0 >= 280, 'waited (with backoff) up to the deadline');
  assert.equal(ran, false, 'fn never ran unlocked');
  assert.equal(fs.readFileSync(REGISTRY, 'utf-8'), before);
  assert.ok(fs.existsSync(LOCK), "the other writer's lock is left alone");
  fs.unlinkSync(LOCK);
});

test('contention that clears before the deadline → waits, then writes', async () => {
  seed();
  holdLock();
  setTimeout(() => fs.unlinkSync(LOCK), 150);
  const t0 = Date.now();
  await reg.mutateRegistry((r) => { r.projects[0].status = 'paused'; }, { timeoutMs: 3000 });
  assert.ok(Date.now() - t0 >= 140, 'did not run before the holder released');
  assert.equal(byId('alpha').status, 'paused');
  assert.equal(fs.existsSync(LOCK), false);
});

test('stale lock recovered: dead owner pid, or older than the stale age', async () => {
  seed();
  holdLock({ pid: 2 ** 22 + 12345, host: os.hostname(), token: 'dead', ts: Date.now() }); // no such pid
  await reg.mutateRegistry((r) => { r.projects[0].order = 7; }, { timeoutMs: 300 });
  assert.equal(byId('alpha').order, 7);

  holdLock(); // live pid, but ancient
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(LOCK, old, old);
  await reg.mutateRegistry((r) => { r.projects[0].order = 8; }, { timeoutMs: 300 });
  assert.equal(byId('alpha').order, 8);
  assert.equal(fs.existsSync(LOCK), false);
});

test('a lock error other than contention → RegistryLockError, nothing written', async () => {
  seed();
  const before = fs.readFileSync(REGISTRY, 'utf-8');
  const dir = path.dirname(REGISTRY);
  fs.chmodSync(dir, 0o555); // can't create the lockfile
  try {
    const { RegistryLockError } = await import('./registry-lock');
    let ran = false;
    await assert.rejects(reg.mutateRegistry(() => { ran = true; }), (e: Error) => e instanceof RegistryLockError && /Could not take/.test(e.message));
    assert.equal(ran, false);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
  assert.equal(fs.readFileSync(REGISTRY, 'utf-8'), before);
});

test('status route under lock contention/timeout → 503 with a clear error, pause NOT applied', async () => {
  seed();
  holdLock();
  process.env.SLYCODE_REGISTRY_LOCK_TIMEOUT_MS = '250';
  try {
    const { POST } = await import('../app/api/projects/[id]/status/route');
    const res = await POST(
      new Request('http://x/api/projects/alpha/status', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'paused' }) }),
      { params: Promise.resolve({ id: 'alpha' }) },
    );
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /registry is busy/);
    assert.equal(byId('alpha').status, undefined, 'not written unlocked');
  } finally {
    delete process.env.SLYCODE_REGISTRY_LOCK_TIMEOUT_MS;
    fs.unlinkSync(LOCK);
  }
});

test('CLI fails closed too: lock held past its deadline → exit 1, clear error, file untouched', async () => {
  seed();
  const before = fs.readFileSync(REGISTRY, 'utf-8');
  holdLock();
  const env = { ...process.env, SLYCODE_HOME: home, SLYCODE_REGISTRY_LOCK_TIMEOUT_MS: '300' };
  delete (env as Record<string, string | undefined>).SLYCODE_SESSION;
  try {
    await assert.rejects(
      execFileP('node', [CLI, 'projects', 'status', 'alpha', 'paused'], { cwd: home, env, timeout: 20000 }),
      (e: { code?: number; stderr?: string }) => e.code === 1 && /registry is busy.*Nothing was changed/.test(e.stderr ?? ''),
    );
    assert.equal(fs.readFileSync(REGISTRY, 'utf-8'), before);
    // Stale (dead-pid) lock: the CLI recovers it and writes.
    holdLock({ pid: 2 ** 22 + 12345, host: os.hostname(), token: 'dead', ts: Date.now() });
    const ok = await execFileP('node', [CLI, 'projects', 'status', 'alpha', 'paused'], { cwd: home, env, timeout: 20000 });
    assert.match(ok.stdout, /Marked paused/);
    assert.equal(byId('alpha').status, 'paused');
  } finally {
    if (fs.existsSync(LOCK)) fs.unlinkSync(LOCK);
  }
});

test('heal-only pass persists (snapshot taken before healing); loadRegistry returns the fresh locked copy', async () => {
  seed(false); // no sessionKeys on disk
  const healedNoOp = await reg.mutateRegistry(() => 'nothing else');
  assert.equal(healedNoOp, 'nothing else');
  assert.equal(byId('alpha').sessionKey, 'alpha', 'heal-only change persisted');

  // A pause lands on disk while loadRegistry is healing: the copy it returns
  // must be the fresh one read under the lock, not its pre-lock snapshot.
  seed(false);
  holdLock();
  setTimeout(() => {
    const r = read();
    r.projects[1].status = 'paused';
    fs.writeFileSync(REGISTRY, JSON.stringify(r, null, 2));
    fs.unlinkSync(LOCK);
  }, 120);
  const loaded = await reg.loadRegistry();
  assert.equal(loaded.projects.find(p => p.id === 'beta')!.status, 'paused', 'returned copy sees the pause');
  assert.equal(byId('beta').status, 'paused', 'and the heal did not overwrite it');
  assert.equal(byId('beta').sessionKey, 'beta');
});

// ---------------------------------------------------------------------------
// Final verify: serialized stale-lock recovery (two recoverers racing must
// never delete a LIVE writer's lock)
// ---------------------------------------------------------------------------

const DEAD_PID = 2 ** 22 + 12345;
const RECOVER = `${LOCK}.recover`;

test('two concurrent recoverers + live writer B: B keeps its lock, one writer at a time', async () => {
  seed();
  const { registryLockTestHooks: hooks } = await import('./registry-lock');
  holdLock({ pid: DEAD_PID, host: os.hostname(), token: 'stale', ts: Date.now() }); // stale S

  let active = 0;
  let maxActive = 0;
  const mutated: string[] = [];
  const writer = (name: string, during?: () => Promise<void>) => async (r: import('./types').Registry) => {
    active++;
    maxActive = Math.max(maxActive, active);
    mutated.push(name);
    (r.projects[0] as unknown as Record<string, unknown>)[`by_${name}`] = true;
    if (during) await during();
    await sleep(20);
    active--;
  };

  // Both recoverers must OBSERVE stale S before either recovers it.
  let arrivals = 0;
  let bothObserved!: () => void;
  const bothObservedP = new Promise<void>(res => { bothObserved = res; });
  let releaseSecond!: () => void;
  const secondGate = new Promise<void>(res => { releaseSecond = res; });
  hooks.afterObserveStale = async () => {
    const n = ++arrivals;
    if (n === 1) { await bothObservedP; return; }   // first recoverer goes once both have seen S
    if (n === 2) { bothObserved(); await secondGate; } // second waits, holding its stale observation
  };

  const attempts: boolean[] = [];
  let secondAttempted!: () => void;
  const secondAttemptedP = new Promise<void>(res => { secondAttempted = res; });
  hooks.afterRecoveryAttempt = (recovered) => { attempts.push(recovered); if (attempts.length === 2) secondAttempted(); };

  // After the first recoverer removes S — before it re-acquires — live
  // writer B takes the lock. Only then does the second recoverer act on its
  // (now outdated) observation of S.
  let pB: Promise<void> | null = null;
  let bToken = '';
  let tokenWhileB = '';
  hooks.afterRecovered = async () => {
    hooks.afterRecovered = undefined; // first recoverer only
    let bHolds!: () => void;
    const bHoldsP = new Promise<void>(res => { bHolds = res; });
    let releaseB!: () => void;
    const bGate = new Promise<void>(res => { releaseB = res; });
    pB = reg.mutateRegistry(writer('B', async () => {
      bToken = JSON.parse(fs.readFileSync(LOCK, 'utf-8')).token;
      bHolds();
      await bGate;
    }));
    await bHoldsP;
    releaseSecond();
    await secondAttemptedP; // second recoverer re-read the lock under .recover and declined
    tokenWhileB = JSON.parse(fs.readFileSync(LOCK, 'utf-8')).token;
    releaseB();
  };

  try {
    await Promise.all([reg.mutateRegistry(writer('R1')), reg.mutateRegistry(writer('R2'))]);
    await pB;
  } finally {
    delete hooks.afterObserveStale;
    delete hooks.afterRecoveryAttempt;
    delete hooks.afterRecovered;
  }

  assert.deepEqual(attempts, [true, false], 'one recoverer removed S; the other saw B and left it');
  assert.ok(bToken && tokenWhileB === bToken, "B's lock survived the second recoverer");
  assert.equal(maxActive, 1, 'never two writers mutating at once');
  assert.deepEqual([...mutated].sort(), ['B', 'R1', 'R2']);
  const alpha = byId('alpha');
  assert.ok(alpha.by_B && alpha.by_R1 && alpha.by_R2, 'all three changes kept');
  assert.equal(fs.existsSync(LOCK), false);
  assert.equal(fs.existsSync(RECOVER), false, 'recovery lock released');
});

test('stale recovery lock → fail closed, message names the file to delete, nothing written', async () => {
  seed();
  const before = fs.readFileSync(REGISTRY, 'utf-8');
  const { RegistryLockError } = await import('./registry-lock');
  holdLock({ pid: DEAD_PID, host: os.hostname(), token: 'stale', ts: Date.now() }); // stale main lock
  fs.writeFileSync(RECOVER, JSON.stringify({ pid: DEAD_PID, host: os.hostname(), token: 'crashed', ts: Date.now() }));
  try {
    let ran = false;
    await assert.rejects(
      reg.mutateRegistry(() => { ran = true; }, { timeoutMs: 500 }),
      (e: Error) => e instanceof RegistryLockError && e.message.includes(`delete ${RECOVER}`),
    );
    assert.equal(ran, false);
    assert.equal(fs.readFileSync(REGISTRY, 'utf-8'), before);
    assert.ok(fs.existsSync(LOCK) && fs.existsSync(RECOVER), 'no guessing: both locks left for the owner');

    // Old-by-age recovery lock (live pid) is stale too.
    fs.writeFileSync(RECOVER, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'old', ts: 0 }));
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(RECOVER, old, old);
    await assert.rejects(reg.mutateRegistry(() => undefined, { timeoutMs: 500 }), /delete .*registry\.json\.lock\.recover/);

    // A LIVE recoverer holding .recover is just contention → times out as "busy".
    fs.writeFileSync(RECOVER, JSON.stringify({ pid: process.pid, host: os.hostname(), token: 'live', ts: Date.now() }));
    await assert.rejects(reg.mutateRegistry(() => undefined, { timeoutMs: 300 }), /registry is busy/);
  } finally {
    for (const f of [LOCK, RECOVER]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

test('CLI: stale recovery lock fails closed naming the file; normal stale recovery leaves no .recover behind', async () => {
  seed();
  const env = { ...process.env, SLYCODE_HOME: home, SLYCODE_REGISTRY_LOCK_TIMEOUT_MS: '500' };
  delete (env as Record<string, string | undefined>).SLYCODE_SESSION;
  holdLock({ pid: DEAD_PID, host: os.hostname(), token: 'stale', ts: Date.now() });
  fs.writeFileSync(RECOVER, JSON.stringify({ pid: DEAD_PID, host: os.hostname(), token: 'crashed', ts: Date.now() }));
  try {
    await assert.rejects(
      execFileP('node', [CLI, 'projects', 'status', 'alpha', 'paused'], { cwd: home, env, timeout: 20000 }),
      (e: { code?: number; stderr?: string }) => e.code === 1 && (e.stderr ?? '').includes(`delete ${RECOVER}`),
    );
    assert.equal(byId('alpha').status, undefined);
    fs.unlinkSync(RECOVER); // owner follows the instruction
    const ok = await execFileP('node', [CLI, 'projects', 'status', 'alpha', 'paused'], { cwd: home, env, timeout: 20000 });
    assert.match(ok.stdout, /Marked paused/);
    assert.equal(fs.existsSync(RECOVER), false);
    assert.equal(fs.existsSync(LOCK), false);
  } finally {
    for (const f of [LOCK, RECOVER]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});
