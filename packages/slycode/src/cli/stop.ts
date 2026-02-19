import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getStateDir, resolveConfig, resolveWorkspaceOrExit } from './workspace';

interface ServiceState {
  pid: number;
  port: number;
  name: string;
  startedAt: string;
}

interface State {
  workspace: string;
  services: ServiceState[];
  startedAt: string;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findPidOnPort(port: number): number | null {
  try {
    // Try ss first (Linux)
    const output = execSync(`ss -tlnp 2>/dev/null | grep ":${port} "`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const match = output.match(/pid=(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch {
    // ss not available or no match
  }

  try {
    // Try lsof (macOS / Linux fallback)
    const output = execSync(`lsof -ti :${port} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const pid = parseInt(output.trim().split('\n')[0], 10);
    if (!isNaN(pid)) return pid;
  } catch {
    // lsof not available or no match
  }

  return null;
}

function killProcess(pid: number, name: string): boolean {
  console.log(`  Stopping ${name} (PID ${pid})...`);

  const isWindows = process.platform === 'win32';

  if (isWindows) {
    try {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }

  // Unix: kill children first, then parent
  try {
    execSync(`pkill -P ${pid} 2>/dev/null`, { stdio: 'pipe', windowsHide: true });
  } catch {
    // No children or pkill not available
  }

  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return false;
  }

  // Wait up to 5 seconds for graceful shutdown
  const start = Date.now();
  while (Date.now() - start < 5000) {
    if (!isProcessAlive(pid)) return true;
    // Busy-wait in small increments (sync stop command)
    execSync('sleep 0.5', { stdio: 'pipe', windowsHide: true });
  }

  // Force kill
  if (isProcessAlive(pid)) {
    console.warn(`  ! ${name} didn't stop gracefully, force killing...`);
    try {
      execSync(`pkill -9 -P ${pid} 2>/dev/null`, { stdio: 'pipe', windowsHide: true });
    } catch {
      // ignore
    }
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // ignore
    }
  }

  return !isProcessAlive(pid);
}

export async function stop(_args: string[]): Promise<void> {
  const workspace = resolveWorkspaceOrExit();
  const config = resolveConfig(workspace);
  const stateDir = getStateDir();
  const stateFile = path.join(stateDir, 'state.json');

  console.log('Stopping SlyCode...');
  console.log('');

  let stoppedAny = false;

  // Strategy 1: Use state file for known PIDs
  if (fs.existsSync(stateFile)) {
    try {
      const state: State = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      for (const svc of state.services) {
        if (isProcessAlive(svc.pid)) {
          if (killProcess(svc.pid, svc.name)) {
            console.log(`  \u2713 ${svc.name} stopped`);
            stoppedAny = true;
          } else {
            console.error(`  \u2717 ${svc.name} (PID ${svc.pid}) could not be stopped`);
          }
        } else {
          console.log(`  ${svc.name} was not running`);
        }
      }
    } catch {
      // Corrupted state file, fall through to port-based discovery
    }
  }

  // Strategy 2: Port-based fallback
  if (!stoppedAny) {
    const portMap = [
      { name: 'Web', port: config.ports.web },
      { name: 'Bridge', port: config.ports.bridge },
      { name: 'Messaging', port: config.ports.messaging },
    ];

    for (const svc of portMap) {
      const pid = findPidOnPort(svc.port);
      if (pid) {
        if (killProcess(pid, svc.name)) {
          console.log(`  \u2713 ${svc.name} stopped (was on port ${svc.port})`);
          stoppedAny = true;
        } else {
          console.error(`  \u2717 ${svc.name} (PID ${pid}) could not be stopped`);
        }
      } else {
        console.log(`  ${svc.name} \u2014 not running (port ${svc.port} free)`);
      }
    }
  }

  // Clean up state file
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }

  console.log('');
  if (stoppedAny) {
    console.log('SlyCode stopped.');
  } else {
    console.log('Nothing was running.');
  }
}
