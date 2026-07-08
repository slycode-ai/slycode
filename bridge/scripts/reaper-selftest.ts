/**
 * Orphan reaper integration self-test (feature 078).
 *
 * Spawns REAL processes against the REAL /proc and proves the reaper kills
 * exactly the right ones:
 *   - env-tagged orphan          -> killed (and exercises SIGKILL escalation)
 *   - argv-fingerprint orphan    -> killed
 *   - no-provenance decoy        -> spared
 *   - skip-listed tagged orphan  -> skipped
 *
 * SAFETY: the synthetic processes use a made-up provider command name
 * ("slyreapertest") and the reaper instance under test is configured with
 * ONLY that name — it can never evaluate, let alone signal, a real
 * claude/codex/gemini process. Everything lives in a mkdtemp dir and all
 * spawned processes are killed in the finally block.
 *
 * Run:  cd bridge && ./node_modules/.bin/tsx scripts/reaper-selftest.ts
 * Exits 0 on success, 1 on any assertion failure.
 */

import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Reaper, KILL_GRACE_MS, type SweepEntry } from '../src/reaper.js';

const COMM = 'slyreapertest'; // 13 chars — survives the 15-char comm truncation

if (os.platform() !== 'linux') {
  console.log('reaper-selftest: /proc required, skipping on ' + os.platform());
  process.exit(0);
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function entryFor(entries: SweepEntry[], pid: number): SweepEntry {
  const e = entries.find(x => x.pid === pid);
  assert.ok(e, `sweep should have evaluated pid ${pid}`);
  return e!;
}

async function main(): Promise<void> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-selftest-'));
  const fakeBin = path.join(tmp, COMM);
  fs.copyFileSync('/bin/bash', fakeBin);
  fs.chmodSync(fakeBin, 0o755);

  // The driver may itself be running inside a bridge-spawned session —
  // never let its SLYCODE_SESSION leak into the synthetic processes.
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'SLYCODE_SESSION') cleanEnv[k] = v;
  }

  const spawned: number[] = [];
  // detached:true => setsid: no controlling TTY, which is the orphan signature
  const launch = (script: string, extraEnv: Record<string, string>, extraArgs: string[] = []): number => {
    const p = spawn(fakeBin, ['-c', script, COMM, ...extraArgs], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...cleanEnv, ...extraEnv },
    });
    p.unref();
    assert.ok(p.pid, 'spawn must yield a pid');
    spawned.push(p.pid!);
    return p.pid!;
  };

  try {
    // "sleep 600 & wait" keeps the fake-named bash resident (a bare
    // -c 'sleep 600' would exec-optimize into a real `sleep`, losing the
    // synthetic comm/argv identity). TERM-immune variant exercises the
    // SIGTERM->SIGKILL escalation path.
    const tagged = launch('trap "" TERM; sleep 600 & wait $!', { SLYCODE_SESSION: 'selftest:tagged' });
    const fingerprinted = launch('sleep 600 & wait $!', {}, ['=== AUTOMATION RUN === selftest']);
    const decoy = launch('sleep 600 & wait $!', {});
    const skipListed = launch('sleep 600 & wait $!', { SLYCODE_SESSION: 'selftest:skip' });

    const skipFilePath = path.join(tmp, 'reaper-skip.txt');
    fs.writeFileSync(skipFilePath, `# selftest exclusion\n${skipListed}\n`);
    const logPath = path.join(tmp, 'reaper.log');

    await delay(200); // let /proc entries settle

    const mkReaper = (dryRun: boolean) =>
      new Reaper({
        config: { enabled: true, intervalMinutes: 10, idleHours: 0, dryRun },
        getProviderCommands: async () => new Set([COMM]),
        getLivePids: () => new Set<number>(),
        getStaleSessionPids: () => new Map<number, string>(),
        logPath,
        skipFilePath,
      });

    // --- Pass 1: dry-run ---------------------------------------------------
    const dry = mkReaper(true);
    const now = Date.now();

    const sweep1 = await dry.sweep(now);
    assert.equal(entryFor(sweep1, tagged).action, 'spare', 'sweep 1: cpu-quiet window not yet satisfied');
    assert.ok(entryFor(sweep1, tagged).reasons.some(r => r.includes('cpu-quiet')));

    const sweep2 = await dry.sweep(now + 1000);
    const dryTagged = entryFor(sweep2, tagged);
    const dryFinger = entryFor(sweep2, fingerprinted);
    assert.equal(dryTagged.action, 'kill');
    assert.equal(dryTagged.dryRun, true, 'dry-run must be flagged');
    assert.ok(dryTagged.reasons.some(r => r.includes('SLYCODE_SESSION=selftest:tagged')));
    assert.equal(dryFinger.action, 'kill');
    assert.ok(dryFinger.reasons.some(r => r.includes('fingerprint')));
    assert.equal(entryFor(sweep2, decoy).action, 'spare');
    assert.ok(entryFor(sweep2, decoy).reasons.includes('no slycode provenance'));
    assert.equal(entryFor(sweep2, skipListed).action, 'skip');

    for (const pid of spawned) {
      assert.ok(alive(pid), `dry-run must not kill anything (pid ${pid})`);
    }
    console.log('PASS dry-run: 2 flagged, decoy spared, skip honored, nothing killed');

    // --- Pass 2: live ------------------------------------------------------
    const live = mkReaper(false);
    const t0 = Date.now();
    await live.sweep(t0);                    // observation sweep
    const kills = await live.sweep(t0 + 1000); // SIGTERM sweep
    assert.equal(entryFor(kills, tagged).signal, 'SIGTERM');
    assert.equal(entryFor(kills, fingerprinted).signal, 'SIGTERM');

    await delay(300);
    assert.ok(!alive(fingerprinted), 'fingerprint orphan must die on SIGTERM');
    assert.ok(alive(tagged), 'TERM-immune process survives SIGTERM');
    assert.ok(alive(decoy), 'decoy must survive live sweep');
    assert.ok(alive(skipListed), 'skip-listed must survive live sweep');

    // Escalation: past the grace window, still matching -> SIGKILL
    const esc = await live.sweep(t0 + 1000 + KILL_GRACE_MS + 1000);
    assert.equal(entryFor(esc, tagged).signal, 'SIGKILL', 'escalates to SIGKILL after grace');
    await delay(300);
    assert.ok(!alive(tagged), 'SIGKILL must be unignorable');
    assert.ok(alive(decoy) && alive(skipListed), 'decoy/skip-listed still untouched');
    console.log('PASS live: SIGTERM kill, SIGKILL escalation, decoy + skip-listed spared');

    const log = fs.readFileSync(logPath, 'utf-8');
    assert.ok(log.includes('DRY-RUN would kill'), 'log records dry-run verdicts');
    assert.ok(log.includes('kill(SIGTERM)') && log.includes('kill(SIGKILL)'), 'log records real kills');
    assert.ok(log.includes('rss='), 'log lines carry evidence');
    console.log('PASS log: evidence lines present');

    console.log('\nreaper-selftest: ALL PASS');
  } finally {
    for (const pid of spawned) {
      // detached spawn => own process group; -pid also reaps the inner sleep
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('reaper-selftest FAILED:', err);
  process.exit(1);
});
