import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import type { SlyCodeConfig } from '../cli/workspace';

const SERVICES = ['web', 'bridge', 'messaging'] as const;

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

function resolveEntryPoint(service: string, workspace: string): string {
  const distPath = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', service, 'index.js');
  if (fs.existsSync(distPath)) return distPath;
  return path.join(workspace, service, 'dist', 'index.js');
}

function generatePlist(
  service: string,
  workspace: string,
  config: SlyCodeConfig
): string {
  const nodePath = process.execPath;
  const entryPoint = resolveEntryPoint(service, workspace);
  const label = `com.slycode.${service}`;
  const logDir = path.join(os.homedir(), '.slycode', 'logs');
  const logPath = path.join(logDir, `${service}.log`);
  const bridgeUrl = `http://127.0.0.1:${config.ports.bridge}`;

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  let envEntries: string;
  switch (service) {
    case 'web':
      envEntries = `    <key>PORT</key>
    <string>${config.ports.web}</string>
    <key>BRIDGE_URL</key>
    <string>${bridgeUrl}</string>`;
      break;
    case 'bridge':
      envEntries = `    <key>BRIDGE_PORT</key>
    <string>${config.ports.bridge}</string>`;
      break;
    case 'messaging':
      envEntries = `    <key>MESSAGING_SERVICE_PORT</key>
    <string>${config.ports.messaging}</string>
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
    <string>${nodePath}</string>
    <string>${entryPoint}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
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
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

async function install(workspace: string, config: SlyCodeConfig): Promise<void> {
  console.log('Installing launchd user agents...');

  for (const svc of SERVICES) {
    const plist = generatePlist(svc, workspace, config);
    const dest = plistPath(svc);
    fs.writeFileSync(dest, plist);
    execSync(`launchctl load "${dest}"`, { stdio: 'inherit' });
    console.log(`  \u2713 Loaded com.slycode.${svc}`);
  }

  console.log('');
  console.log('All launchd agents installed and loaded.');
}

async function remove(): Promise<void> {
  console.log('Removing launchd user agents...');

  for (const svc of SERVICES) {
    const dest = plistPath(svc);
    if (fs.existsSync(dest)) {
      try { execSync(`launchctl unload "${dest}"`, { stdio: 'pipe' }); } catch { /* ok */ }
      fs.unlinkSync(dest);
      console.log(`  \u2713 Removed com.slycode.${svc}`);
    }
  }

  console.log('  \u2713 Launchd agents removed');
}

async function status(): Promise<void> {
  for (const svc of SERVICES) {
    const dest = plistPath(svc);
    if (!fs.existsSync(dest)) {
      console.log(`  com.slycode.${svc}: not installed`);
      continue;
    }

    try {
      const output = execSync(`launchctl list com.slycode.${svc} 2>/dev/null`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
      if (pidMatch) {
        console.log(`  com.slycode.${svc}: running (PID ${pidMatch[1]})`);
      } else {
        console.log(`  com.slycode.${svc}: loaded but not running`);
      }
    } catch {
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
