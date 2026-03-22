import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import type { SlyCodeConfig } from '../cli/workspace';
import {
  SERVICES,
  resolveEntryPoint,
  resolveWrapperScript,
  loadEnvFile,
  getEnabledServices,
} from './service-common';

function getLaunchAgentsDir(): string {
  const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function plistPath(service: string): string {
  return path.join(getLaunchAgentsDir(), `com.slycode.${service}.plist`);
}

function generatePlist(
  service: string,
  workspace: string,
  config: SlyCodeConfig
): string {
  const nodePath = process.execPath;
  const entryPoint = resolveEntryPoint(service, workspace);
  const wrapperScript = resolveWrapperScript(workspace);
  const label = `com.slycode.${service}`;
  const logDir = path.join(os.homedir(), '.slycode', 'logs');
  const logPath = path.join(logDir, `${service}.log`);
  const bridgeUrl = `http://127.0.0.1:${config.ports.bridge}`;
  const host = config.host || '127.0.0.1';

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Build service-specific env entries matching Linux systemd units
  let envEntries: string;
  switch (service) {
    case 'web':
      envEntries = `    <key>PORT</key>
    <string>${config.ports.web}</string>
    <key>HOST</key>
    <string>${host}</string>
    <key>HOSTNAME</key>
    <string>${host}</string>
    <key>BRIDGE_URL</key>
    <string>${bridgeUrl}</string>`;
      break;
    case 'bridge':
      envEntries = `    <key>PORT</key>
    <string>${config.ports.bridge}</string>
    <key>BRIDGE_PORT</key>
    <string>${config.ports.bridge}</string>
    <key>BRIDGE_HOST</key>
    <string>127.0.0.1</string>
    <key>HOST</key>
    <string>127.0.0.1</string>`;
      break;
    case 'messaging':
      envEntries = `    <key>PORT</key>
    <string>${config.ports.messaging}</string>
    <key>MESSAGING_SERVICE_PORT</key>
    <string>${config.ports.messaging}</string>
    <key>HOST</key>
    <string>127.0.0.1</string>
    <key>BRIDGE_URL</key>
    <string>${bridgeUrl}</string>`;
      break;
    default:
      envEntries = '';
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>WorkingDirectory</key>
  <string>${workspace}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${wrapperScript}</string>
    <string>${nodePath}</string>
    <string>${entryPoint}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${os.homedir()}</string>
    <key>PATH</key>
    <string>${process.env.PATH}</string>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>SLYCODE_HOME</key>
    <string>${workspace}</string>
${envEntries}
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

/**
 * Check if a launchd agent is loaded (regardless of whether it's running).
 */
function isAgentLoaded(service: string): boolean {
  try {
    execSync(`launchctl list com.slycode.${service} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a launchd agent is running (has a PID).
 */
function getAgentPid(service: string): number | null {
  try {
    const output = execSync(`launchctl list com.slycode.${service} 2>/dev/null`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
    return pidMatch ? parseInt(pidMatch[1], 10) : null;
  } catch {
    return null;
  }
}

async function install(workspace: string, config: SlyCodeConfig): Promise<void> {
  const envVars = loadEnvFile(workspace);

  console.log('Installing launchd user agents...');
  console.log('');

  const enabled = getEnabledServices(config, envVars);
  if (enabled.length === 0) {
    console.error('No services to install.');
    return;
  }

  console.log('');

  // Validate entry points before installing
  const installable: typeof SERVICES[number][] = [];
  for (const svc of enabled) {
    const entryPoint = resolveEntryPoint(svc, workspace);
    if (!fs.existsSync(entryPoint)) {
      console.warn(`  \u2717 ${svc}: entry point not found: ${entryPoint}`);
      continue;
    }
    installable.push(svc);
  }

  if (installable.length === 0) {
    console.error('No services have valid entry points. Is slycode installed?');
    console.error('Try: cd ' + workspace + ' && npm install');
    return;
  }

  // Ensure env wrapper script is executable
  const wrapperScript = resolveWrapperScript(workspace);
  if (!fs.existsSync(wrapperScript)) {
    console.error(`  \u2717 env wrapper not found: ${wrapperScript}`);
    console.error('Is slycode installed correctly?');
    return;
  }
  try { fs.chmodSync(wrapperScript, 0o755); } catch { /* ok if already executable */ }

  for (const svc of installable) {
    const plist = generatePlist(svc, workspace, config);
    const dest = plistPath(svc);

    // Unload first for idempotency (ignore errors — may not be loaded)
    try { execSync(`launchctl unload "${dest}"`, { stdio: 'pipe' }); } catch { /* ok */ }

    fs.writeFileSync(dest, plist);
    try {
      execSync(`launchctl load "${dest}"`, { stdio: 'pipe' });
      console.log(`  \u2713 Loaded com.slycode.${svc}`);
    } catch (e: any) {
      console.error(`  \u2717 Failed to load com.slycode.${svc}: ${e.message || e}`);
    }
  }

  // Clean up stale plists for services not in the enabled set
  for (const svc of SERVICES) {
    if (!installable.includes(svc)) {
      const dest = plistPath(svc);
      if (fs.existsSync(dest)) {
        try { execSync(`launchctl unload "${dest}"`, { stdio: 'pipe' }); } catch { /* ok */ }
        fs.unlinkSync(dest);
        console.log(`  \u2298 Removed stale plist for ${svc}`);
      }
    }
  }

  // Wait for services to stabilize
  console.log('');
  console.log('Waiting for services to start...');
  await new Promise((r) => setTimeout(r, 3000));

  // Verify each service
  let allOk = true;
  for (const svc of installable) {
    const pid = getAgentPid(svc);
    if (pid) {
      console.log(`  \u2713 com.slycode.${svc} is running (PID ${pid})`);
    } else if (isAgentLoaded(svc)) {
      console.warn(`  \u2717 com.slycode.${svc} loaded but not running (crashed?)`);
      console.log(`    Check logs: ~/.slycode/logs/${svc}.log`);
      allOk = false;
    } else {
      console.warn(`  \u2717 com.slycode.${svc} failed to load`);
      console.log(`    Check logs: ~/.slycode/logs/${svc}.log`);
      allOk = false;
    }
  }

  console.log('');
  if (allOk) {
    console.log('All launchd agents installed and running.');
  } else {
    console.log('Some services failed. Check ~/.slycode/logs/<service>.log for details.');
  }
}

async function remove(): Promise<void> {
  console.log('Removing launchd user agents...');

  let removedAny = false;
  for (const svc of SERVICES) {
    const dest = plistPath(svc);
    if (!fs.existsSync(dest)) continue;

    // Unload first, then delete plist
    try {
      execSync(`launchctl unload "${dest}"`, { stdio: 'pipe' });
    } catch (e: any) {
      console.warn(`  ! Could not unload com.slycode.${svc}: ${e.message || 'unknown error'}`);
    }

    fs.unlinkSync(dest);
    console.log(`  \u2713 Removed com.slycode.${svc}`);
    removedAny = true;
  }

  if (removedAny) {
    console.log('');
    console.log('Launchd agents removed.');
  } else {
    console.log('  No agents were installed.');
  }
}

async function status(): Promise<void> {
  const logDir = path.join(os.homedir(), '.slycode', 'logs');

  // Check if any plists exist
  const hasAny = SERVICES.some(svc => fs.existsSync(plistPath(svc)));
  if (!hasAny) {
    console.log('  No services installed.');
    console.log('  Install with: slycode service install');
    return;
  }

  for (const svc of SERVICES) {
    const dest = plistPath(svc);
    if (!fs.existsSync(dest)) {
      console.log(`  com.slycode.${svc}: not installed`);
      continue;
    }

    const pid = getAgentPid(svc);
    if (pid) {
      console.log(`  com.slycode.${svc}: running (PID ${pid})`);
    } else if (isAgentLoaded(svc)) {
      console.log(`  com.slycode.${svc}: loaded but not running`);
      console.log(`    Check logs: ${path.join(logDir, `${svc}.log`)}`);
    } else {
      console.log(`  com.slycode.${svc}: not loaded`);
    }
  }
}

export async function serviceMacos(
  action: 'install' | 'remove' | 'status',
  workspace: string,
  config: SlyCodeConfig
): Promise<void> {
  switch (action) {
    case 'install': return install(workspace, config);
    case 'remove': return remove();
    case 'status': return status();
  }
}
