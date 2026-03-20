import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

export const SERVICES = ['web', 'bridge', 'messaging'] as const;
export type ServiceName = typeof SERVICES[number];

export type RunMode = 'systemd' | 'launchd' | 'windows-task' | 'background' | 'none';

/**
 * Ensure XDG_RUNTIME_DIR is set.
 * Required for `systemctl --user` in environments like SSH, code-server, and cron
 * where the variable may not be inherited.
 */
export function ensureXdgRuntime(): void {
  if (!process.env.XDG_RUNTIME_DIR) {
    const uid = process.getuid?.();
    if (uid !== undefined) {
      const candidate = `/run/user/${uid}`;
      if (fs.existsSync(candidate)) {
        process.env.XDG_RUNTIME_DIR = candidate;
      }
    }
  }
}

/**
 * Detect how services are currently running.
 * Checks platform service managers first, then falls back to PID state file.
 */
export function detectRunMode(stateFile: string): RunMode {
  // Linux: check systemd units
  if (process.platform === 'linux') {
    ensureXdgRuntime();
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const hasUnits = SERVICES.some(svc =>
      fs.existsSync(path.join(unitDir, `slycode-${svc}.service`))
    );
    if (hasUnits) {
      try {
        const output = execSync('systemctl --user is-active slycode-web', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        }).trim();
        if (output === 'active') return 'systemd';
      } catch { /* not active or systemd unavailable */ }
    }
  }

  // macOS: check launchd agents
  if (process.platform === 'darwin') {
    const agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const hasAgents = SERVICES.some(svc =>
      fs.existsSync(path.join(agentDir, `com.slycode.${svc}.plist`))
    );
    if (hasAgents) {
      try {
        const output = execSync('launchctl list com.slycode.web 2>/dev/null', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        if (output.includes('"PID"')) return 'launchd';
      } catch { /* not loaded */ }
    }
  }

  // Windows: check Task Scheduler
  if (process.platform === 'win32') {
    try {
      const output = execSync('schtasks /Query /TN "SlyCode-web" /FO CSV /NH', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      if (output.includes('Running')) return 'windows-task';
    } catch { /* not installed */ }
  }

  // Fallback: PID-based background processes
  if (fs.existsSync(stateFile)) {
    try {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const running = state.services?.some((s: { pid: number }) => {
        try { process.kill(s.pid, 0); return true; } catch { return false; }
      });
      if (running) return 'background';
    } catch { /* stale state */ }
  }

  return 'none';
}

/**
 * Detect if service manager units/plists are installed (regardless of active state).
 * Used by start to decide whether to delegate to the service manager.
 */
export function detectInstalledServiceManager(): 'systemd' | 'launchd' | 'none' {
  if (process.platform === 'linux') {
    ensureXdgRuntime();
    const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
    const hasUnits = SERVICES.some(svc =>
      fs.existsSync(path.join(unitDir, `slycode-${svc}.service`))
    );
    if (hasUnits) return 'systemd';
  }

  if (process.platform === 'darwin') {
    const agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    const hasAgents = SERVICES.some(svc =>
      fs.existsSync(path.join(agentDir, `com.slycode.${svc}.plist`))
    );
    if (hasAgents) return 'launchd';
  }

  return 'none';
}
