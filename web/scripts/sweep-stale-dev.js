#!/usr/bin/env node
/**
 * Kill stale dev-server processes for THIS repo before starting a new one.
 * Runs from `predev`, so every `npm run dev` is protected — no matter whether
 * it was launched via sly-dev.sh, a tmux pane, or a bare terminal.
 *
 * Why it's safe to kill unconditionally: an existing same-repo `next dev` is
 * either (a) holding port 3003 — the new instance couldn't bind anyway — or
 * (b) a portless wedged tree left by a crash (the zombie signature). Both
 * should die. Matching is anchored to this repo's absolute path and
 * /proc cwd, so other projects' dev servers are never touched.
 *
 * Linux-only (/proc); silently skips elsewhere.
 */

const fs = require('fs');
const path = require('path');

if (process.platform !== 'linux') process.exit(0);

const webDir = path.resolve(__dirname, '..');
const nextDevMarker = path.join(webDir, 'node_modules', '.bin', 'next dev');

function cmdline(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').join(' ');
  } catch {
    return '';
  }
}

function cwdOf(pid) {
  try {
    return fs.readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return '';
  }
}

const victims = [];
for (const entry of fs.readdirSync('/proc')) {
  if (!/^\d+$/.test(entry)) continue;
  const pid = Number(entry);
  if (pid === process.pid || pid === process.ppid) continue;
  const cmd = cmdline(pid);
  if (!cmd) continue;
  const isOurNextDev = cmd.includes(nextDevMarker);
  const isOurNextServer = cmd.startsWith('next-server') && cwdOf(pid) === webDir;
  if (isOurNextDev || isOurNextServer) victims.push({ pid, cmd: cmd.slice(0, 100) });
}

if (victims.length === 0) process.exit(0);

for (const v of victims) {
  console.log(`[sweep-stale-dev] killing stale dev process ${v.pid}: ${v.cmd}`);
  try { process.kill(v.pid, 'SIGTERM'); } catch { /* already gone */ }
}

// Wedged trees (post-crash) routinely ignore SIGTERM — escalate after a beat.
setTimeout(() => {
  for (const v of victims) {
    try {
      process.kill(v.pid, 0); // still alive?
      console.log(`[sweep-stale-dev] SIGKILL ${v.pid} (ignored SIGTERM — wedged)`);
      process.kill(v.pid, 'SIGKILL');
    } catch { /* gone — good */ }
  }
  process.exit(0);
}, 1200);
