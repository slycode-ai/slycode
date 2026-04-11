import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { resolveWorkspaceOrExit, getStateDir } from './workspace';
import { refreshUpdates, refreshProviders, refreshTerminalClasses } from './sync';
import { SERVICES, detectRunMode } from '../platform/service-detect';
import { linkClis } from '../platform/symlinks';

function restartSystemd(): void {
  console.log('  Restarting systemd services...');
  try {
    execSync('systemctl --user daemon-reload', { stdio: 'pipe', windowsHide: true });
  } catch { /* ok */ }
  for (const svc of SERVICES) {
    const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `slycode-${svc}.service`);
    if (!fs.existsSync(unitPath)) continue;
    try {
      execSync(`systemctl --user restart slycode-${svc}`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
      console.log(`    ✓ slycode-${svc} restarted`);
    } catch {
      console.warn(`    ! slycode-${svc} failed to restart`);
    }
  }
}

function restartLaunchd(): void {
  console.log('  Restarting launchd agents...');
  const uid = process.getuid?.() ?? 501;
  for (const svc of SERVICES) {
    const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.slycode.${svc}.plist`);
    if (!fs.existsSync(plistPath)) continue;
    try {
      execSync(`launchctl kickstart -k gui/${uid}/com.slycode.${svc}`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
      console.log(`    ✓ com.slycode.${svc} restarted`);
    } catch {
      console.warn(`    ! com.slycode.${svc} failed to restart`);
    }
  }
}

function restartWindowsTasks(): void {
  console.log('  Restarting Windows tasks...');
  for (const svc of SERVICES) {
    const name = `SlyCode-${svc}`;
    try {
      execSync(`schtasks /End /TN "${name}"`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
    } catch { /* may not be running */ }
    try {
      execSync(`schtasks /Run /TN "${name}"`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
      console.log(`    ✓ ${name} restarted`);
    } catch {
      console.warn(`    ! ${name} failed to restart`);
    }
  }
}

async function restartBackground(): Promise<void> {
  console.log('  Restarting background services...');
  const { stop } = await import('./stop');
  await stop([]);
  console.log('');
  const { start } = await import('./start');
  await start([]);
}

export async function update(_args: string[]): Promise<void> {
  const workspace = resolveWorkspaceOrExit();
  const stateFile = path.join(getStateDir(), 'state.json');

  // Detect how services are running before we update anything
  const runMode = detectRunMode(stateFile);

  // Step 1: npm update @slycode/slycode
  console.log('Updating SlyCode...');
  console.log('');
  try {
    console.log('  Running npm update...');
    execSync('npm update @slycode/slycode', { cwd: workspace, stdio: 'inherit' });
    console.log('');
  } catch {
    console.error('  npm update failed. Check your network connection and try again.');
    process.exit(1);
  }

  // Step 1b: Re-link CLI commands to pick up updated binaries
  linkClis(workspace);

  // Step 2: Refresh updates from new templates
  const result = refreshUpdates(workspace);
  if (result.refreshed > 0) {
    console.log(`  Refreshed ${result.refreshed} skill update(s):`);
    for (const d of result.details) {
      const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
      console.log(`    ✓ ${d.name} (${label})`);
    }
    console.log('');
  }

  // Step 2b: Refresh providers.json
  const providersResult = refreshProviders(workspace);
  if (providersResult.updated) {
    console.log('  ✓ Providers updated');
    console.log('');
  }

  // Step 2c: Seed terminal-classes.json if missing
  const tcResult = refreshTerminalClasses(workspace);
  if (tcResult.seeded) {
    console.log('  ✓ Seeded terminal-classes.json');
    console.log('');
  }

  // Step 3: Restart services using the detected run mode
  if (runMode !== 'none') {
    switch (runMode) {
      case 'systemd': restartSystemd(); break;
      case 'launchd': restartLaunchd(); break;
      case 'windows-task': restartWindowsTasks(); break;
      case 'background': await restartBackground(); break;
    }
    console.log('');
  }

  // Summary
  const pkgPath = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'package.json');
  let version = 'unknown';
  if (fs.existsSync(pkgPath)) {
    try {
      version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
    } catch { /* ignore */ }
  }
  console.log(`SlyCode updated to v${version}.`);
  if (result.refreshed > 0) {
    console.log(`  ${result.refreshed} skill update(s) refreshed.`);
  }
  if (providersResult.updated) {
    console.log('  Providers refreshed.');
  }
  if (tcResult.seeded) {
    console.log('  Terminal classes seeded.');
  }
  if (runMode !== 'none') {
    console.log(`  Services restarted (${runMode}).`);
  }
}
