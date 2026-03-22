import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { getStateDir, resolveConfig, resolveWorkspaceOrExit } from './workspace';
import { SERVICES, type ServiceName, detectRunMode, ensureXdgRuntime } from '../platform/service-detect';

const USAGE = `
Usage: slycode restart [service]

Restart all services, or a specific one.

  slycode restart              Restart all services
  slycode restart web          Restart only the web service
  slycode restart bridge       Restart only the bridge service
  slycode restart messaging    Restart only the messaging service

Useful after editing .env to pick up new environment variables.
`.trim();

function isValidService(name: string): name is ServiceName {
  return (SERVICES as readonly string[]).includes(name);
}

export async function restart(args: string[]): Promise<void> {
  if (args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE);
    return;
  }

  const workspace = resolveWorkspaceOrExit();
  const config = resolveConfig(workspace);
  const stateDir = getStateDir();
  const stateFile = path.join(stateDir, 'state.json');

  // Determine which services to restart
  const target = args[0];
  if (target && !isValidService(target)) {
    console.error(`Unknown service: ${target}`);
    console.error(`Valid services: ${SERVICES.join(', ')}`);
    process.exit(1);
  }

  const servicesToRestart: readonly ServiceName[] = target ? [target as ServiceName] : SERVICES;
  const runMode = detectRunMode(stateFile);

  console.log(`Restarting ${target || 'all services'}...`);
  console.log('');

  if (runMode === 'systemd') {
    ensureXdgRuntime();
    for (const svc of servicesToRestart) {
      const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `slycode-${svc}.service`);
      if (!fs.existsSync(unitPath)) {
        console.log(`  ⊘ slycode-${svc}: not installed`);
        continue;
      }
      try {
        execSync(`systemctl --user restart slycode-${svc}`, {
          stdio: 'pipe',
          timeout: 15000,
          windowsHide: true,
        });
        console.log(`  ✓ slycode-${svc} restarted`);
      } catch {
        console.error(`  ✗ slycode-${svc} failed to restart`);
        console.log(`    Check logs: journalctl --user -u slycode-${svc} --no-pager -n 20`);
      }
    }
    console.log('');
    console.log('Done.');
    return;
  }

  if (runMode === 'launchd') {
    const uid = process.getuid?.() ?? 501;
    for (const svc of servicesToRestart) {
      const plistFile = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.slycode.${svc}.plist`);
      if (!fs.existsSync(plistFile)) {
        console.log(`  \u2298 com.slycode.${svc}: not installed`);
        continue;
      }
      try {
        execSync(`launchctl kickstart -k gui/${uid}/com.slycode.${svc}`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
        console.log(`  \u2713 com.slycode.${svc} restarted`);
      } catch {
        console.error(`  \u2717 com.slycode.${svc} failed to restart`);
      }
    }
    console.log('');
    console.log('Done.');
    return;
  }

  if (runMode === 'background') {
    // Manual mode: stop then start
    console.log('  Services are running in manual mode.');
    console.log('  Use "slycode stop" then "slycode start" to restart.');
    console.log('');
    console.log('  Tip: Install as a service for easier restart:');
    console.log('    slycode service install');
    return;
  }

  console.log('No running services found.');
  console.log('Start services with "slycode start" or "slycode service install".');
}
