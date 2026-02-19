import * as path from 'path';
import * as fs from 'fs';
import { resolveWorkspaceOrExit, resolveConfig, getStateDir } from './workspace';

const USAGE = `
Usage: slycode service <action>

Actions:
  install    Install SlyCode as a system service (auto-start on boot)
  remove     Remove system service
  status     Check service status

Platform support:
  Linux      systemd user services
  macOS      launchd user agents
  Windows    Task Scheduler tasks
`.trim();

function detectPlatform(): 'linux' | 'darwin' | 'win32' | 'unsupported' {
  switch (process.platform) {
    case 'linux': return 'linux';
    case 'darwin': return 'darwin';
    case 'win32': return 'win32';
    default: return 'unsupported';
  }
}

export async function service(args: string[]): Promise<void> {
  const action = args[0];

  if (!action || action === '--help' || action === '-h') {
    console.log(USAGE);
    return;
  }

  if (!['install', 'remove', 'status'].includes(action)) {
    console.error(`Unknown action: ${action}`);
    console.error('Run "slycode service --help" for usage.');
    process.exit(1);
  }

  const workspace = resolveWorkspaceOrExit();
  const config = resolveConfig(workspace);
  const platform = detectPlatform();

  if (platform === 'unsupported') {
    console.error(`Unsupported platform: ${process.platform}`);
    console.error('SlyCode services are supported on Linux, macOS, and Windows.');
    process.exit(1);
  }

  // Dynamic import for platform-specific module
  switch (platform) {
    case 'linux': {
      const { serviceLinux } = await import('../platform/service-linux');
      await serviceLinux(action as 'install' | 'remove' | 'status', workspace, config);
      break;
    }
    case 'darwin': {
      const { serviceMacos } = await import('../platform/service-macos');
      await serviceMacos(action as 'install' | 'remove' | 'status', workspace, config);
      break;
    }
    case 'win32': {
      console.error('System service management is not yet supported on Windows.');
      console.error('Use "slycode start" and "slycode stop" to manage services manually.');
      process.exit(1);
    }
  }

  // After showing system service status, check for manually running processes
  if (action === 'status') {
    const stateFile = path.join(getStateDir(), 'state.json');
    if (fs.existsSync(stateFile)) {
      try {
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        const running = (state.services || []).filter((s: { pid: number }) => {
          try { process.kill(s.pid, 0); return true; } catch { return false; }
        });
        if (running.length > 0) {
          console.log('');
          console.log('Note: Services are running manually (started via "slycode start"):');
          for (const s of running) {
            console.log(`  ${s.name} (PID ${s.pid}, port ${s.port})`);
          }
          console.log('Use "slycode stop" to manage these.');
        }
      } catch { /* stale state, ignore */ }
    }
  }
}
