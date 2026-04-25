import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { execSync } from 'child_process';
import { resolveWorkspaceOrExit, resolveConfig, getStateDir, type SlyCodeConfig } from './workspace';
import { refreshUpdates, refreshActionUpdates, refreshProviders, refreshTerminalClasses } from './sync';
import { SERVICES, detectRunMode, type RunMode } from '../platform/service-detect';
import { linkClis } from '../platform/symlinks';
import { loadEnvFile, getEnabledServices } from '../platform/service-common';

function isPortInUse(port: number, host: string = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, host);
  });
}

async function waitForPort(port: number, host: string = '127.0.0.1', timeoutMs: number = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortInUse(port, host)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
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

function logHintFor(service: string, runMode: RunMode): string {
  switch (runMode) {
    case 'systemd': return `journalctl --user -u slycode-${service} --no-pager -n 40`;
    case 'launchd': return `~/.slycode/logs/${service}.log`;
    case 'windows-task': return `Event Viewer → Task Scheduler history, task "SlyCode-${service}"`;
    case 'background': return `~/.slycode/logs/${service}.log`;
    default: return 'check service logs';
  }
}

async function verifyServicesUp(
  workspace: string,
  config: SlyCodeConfig,
  runMode: RunMode
): Promise<void> {
  const envVars = loadEnvFile(workspace);

  // Mirror install-time enablement logic so we don't warn on services that were
  // intentionally skipped (e.g. messaging without a channel token).
  const enabled: { name: string; port: number }[] = [];
  for (const svc of SERVICES) {
    if (!config.services[svc]) continue;
    if (svc === 'messaging' && !envVars.TELEGRAM_BOT_TOKEN && !envVars.SLACK_TOKEN) continue;
    enabled.push({ name: svc, port: config.ports[svc] });
  }

  const failures: string[] = [];
  for (const svc of enabled) {
    const ready = await waitForPort(svc.port, '127.0.0.1', 15000);
    if (!ready) failures.push(svc.name);
  }

  if (failures.length > 0) {
    console.log('');
    for (const name of failures) {
      console.error(`  ✗ ${name} did not come up on its port after restart`);
      console.error(`    Logs: ${logHintFor(name, runMode)}`);
    }
  }
}

export async function update(_args: string[]): Promise<void> {
  const workspace = resolveWorkspaceOrExit();
  const config = resolveConfig(workspace);
  const stateFile = path.join(getStateDir(), 'state.json');

  // Detect how services are running before we update anything
  const runMode = detectRunMode(stateFile);

  // On Windows background mode, the running node.exe holds file locks on dist/*.js.
  // npm update cannot overwrite those files while the service is running — so stop
  // first, then update, then restart (instead of the usual restart-after-update).
  if (runMode === 'background' && process.platform === 'win32') {
    console.log('Stopping services before update (Windows file locks)...');
    const { stop } = await import('./stop');
    await stop([]);
    console.log('');
  }

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

  // Step 2: Refresh skill updates from new templates
  const result = refreshUpdates(workspace);
  if (result.refreshed > 0) {
    console.log(`  Refreshed ${result.refreshed} skill update(s):`);
    for (const d of result.details) {
      const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
      console.log(`    ✓ ${d.name} (${label})`);
    }
    console.log('');
  }

  // Step 2a: Refresh action updates from new templates
  const actionResult = refreshActionUpdates(workspace);
  if (actionResult.refreshed > 0) {
    console.log(`  Refreshed ${actionResult.refreshed} action update(s):`);
    for (const d of actionResult.details) {
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

  // Step 3: Restart services using the detected run mode.
  // For systemd/launchd we call the platform install function instead of a plain
  // restart: it regenerates the unit/plist with current binary paths, so a stale
  // unit pointing at an old dist layout can't leave the service broken.
  if (runMode !== 'none') {
    switch (runMode) {
      case 'systemd': {
        const { serviceLinux } = await import('../platform/service-linux');
        await serviceLinux('install', workspace, config);
        break;
      }
      case 'launchd': {
        const { serviceMacos } = await import('../platform/service-macos');
        await serviceMacos('install', workspace, config);
        break;
      }
      case 'windows-task':
        restartWindowsTasks();
        break;
      case 'background': {
        console.log('  Restarting background services...');
        // On Windows we already stopped before npm update to release file locks.
        // Everywhere else, stop now.
        if (process.platform !== 'win32') {
          const { stop } = await import('./stop');
          await stop([]);
          console.log('');
        }
        const { start } = await import('./start');
        await start([]);
        break;
      }
    }
    console.log('');

    // Step 4: Verify services actually came up. Silent on success; prints one
    // error line per failed service with a log pointer.
    await verifyServicesUp(workspace, config, runMode);
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
  if (actionResult.refreshed > 0) {
    console.log(`  ${actionResult.refreshed} action update(s) refreshed.`);
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
