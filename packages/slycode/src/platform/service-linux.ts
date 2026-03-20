import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { type SlyCodeConfig, resolvePackageDir } from '../cli/workspace';

const SERVICES = ['web', 'bridge', 'messaging'] as const;

function hasSystemd(): boolean {
  try {
    execSync('systemctl --user --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function ensureXdgRuntime(): void {
  if (!process.env.XDG_RUNTIME_DIR) {
    const candidate = `/run/user/${process.getuid!()}`;
    if (fs.existsSync(candidate)) {
      process.env.XDG_RUNTIME_DIR = candidate;
    }
  }
}

function getUnitDir(): string {
  const dir = path.join(os.homedir(), '.config', 'systemd', 'user');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Load .env from the workspace and return key=value pairs.
 * Needed because systemd services don't inherit the user's .env.
 */
function loadEnvFile(workspace: string): Record<string, string> {
  const envFile = path.join(workspace, '.env');
  const vars: Record<string, string> = {};
  if (!fs.existsSync(envFile)) return vars;

  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq);
      const val = trimmed.slice(eq + 1);
      if (val) vars[key] = val; // Only include non-empty values
    }
  }
  return vars;
}

function resolveWrapperScript(workspace: string): string {
  const packageDir = resolvePackageDir(workspace);
  const wrapperPath = packageDir
    ? path.join(packageDir, 'dist', 'scripts', 'slycode-env-wrapper.sh')
    : path.join(workspace, 'packages', 'slycode', 'src', 'platform', 'slycode-env-wrapper.sh');
  return wrapperPath;
}

function generateUnit(
  service: string,
  workspace: string,
  config: SlyCodeConfig,
): string {
  const nodePath = process.execPath;
  const resolvedPackage = resolveEntryPoint(service, workspace);
  const wrapperScript = resolveWrapperScript(workspace);
  const bridgeUrl = `http://127.0.0.1:${config.ports.bridge}`;
  const host = config.host || '127.0.0.1';

  let description: string;
  const envLines: string[] = [];

  switch (service) {
    case 'web':
      description = 'SlyCode Web (Command Center)';
      envLines.push(`Environment="PORT=${config.ports.web}"`);
      envLines.push(`Environment="HOSTNAME=${host}"`);
      envLines.push(`Environment="HOST=${host}"`);
      envLines.push(`Environment="BRIDGE_URL=${bridgeUrl}"`);
      break;
    case 'bridge':
      description = 'SlyCode Bridge (PTY Terminal)';
      envLines.push(`Environment="PORT=${config.ports.bridge}"`);
      envLines.push(`Environment="BRIDGE_PORT=${config.ports.bridge}"`);
      envLines.push(`Environment="BRIDGE_HOST=127.0.0.1"`);
      envLines.push(`Environment="HOST=127.0.0.1"`);
      break;
    case 'messaging':
      description = 'SlyCode Messaging Service';
      envLines.push(`Environment="PORT=${config.ports.messaging}"`);
      envLines.push(`Environment="MESSAGING_SERVICE_PORT=${config.ports.messaging}"`);
      envLines.push(`Environment="HOST=127.0.0.1"`);
      envLines.push(`Environment="BRIDGE_URL=${bridgeUrl}"`);
      break;
    default:
      throw new Error(`Unknown service: ${service}`);
  }

  return `[Unit]
Description=${description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workspace}
ExecStart=${wrapperScript} ${nodePath} ${resolvedPackage}
Restart=always
RestartSec=5
Environment="HOME=${os.homedir()}"
Environment="PATH=${process.env.PATH}"
Environment="NODE_ENV=production"
Environment="SLYCODE_HOME=${workspace}"
${envLines.join('\n')}

[Install]
WantedBy=default.target
`;
}

function resolveEntryPoint(service: string, workspace: string): string {
  const packageDir = resolvePackageDir(workspace);
  const distDir = packageDir ? path.join(packageDir, 'dist') : null;

  // Web uses server.js (Next.js standalone), others use index.js
  const entryFile = service === 'web' ? 'server.js' : 'index.js';

  if (distDir) {
    const distPath = path.join(distDir, service, entryFile);
    if (fs.existsSync(distPath)) return distPath;
  }

  // Fallback to local dev build
  if (service === 'web') {
    return path.join(workspace, 'web', 'node_modules', '.bin', 'next');
  }
  return path.join(workspace, service, 'dist', 'index.js');
}

function checkLinger(): boolean {
  try {
    const output = execSync(
      `loginctl show-user ${os.userInfo().username} -p Linger --value 2>/dev/null`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return output.trim() === 'yes';
  } catch {
    return false;
  }
}

/**
 * Determine which services should be installed.
 * Skips messaging if no channel tokens are configured.
 */
function getEnabledServices(
  config: SlyCodeConfig,
  envVars: Record<string, string>
): typeof SERVICES[number][] {
  const enabled: typeof SERVICES[number][] = [];
  for (const svc of SERVICES) {
    if (!config.services[svc]) {
      console.log(`  ⊘ ${svc}: disabled in config — skipping`);
      continue;
    }
    if (svc === 'messaging' && !envVars.TELEGRAM_BOT_TOKEN && !envVars.SLACK_TOKEN) {
      console.log(`  ⊘ messaging: no channels configured — skipping`);
      console.log('    (add TELEGRAM_BOT_TOKEN to .env, then run service install again)');
      continue;
    }
    enabled.push(svc);
  }
  return enabled;
}

async function install(workspace: string, config: SlyCodeConfig): Promise<void> {
  if (!hasSystemd()) {
    console.error('systemd is not available on this system.');
    console.error('Use "slycode start" for manual process management.');
    process.exit(1);
  }

  ensureXdgRuntime();
  const unitDir = getUnitDir();
  const envVars = loadEnvFile(workspace);

  console.log('Installing systemd user services...');
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
    console.error(`  ✗ env wrapper not found: ${wrapperScript}`);
    console.error('Is slycode installed correctly?');
    return;
  }
  try { fs.chmodSync(wrapperScript, 0o755); } catch { /* ok if already executable */ }

  for (const svc of installable) {
    const unitContent = generateUnit(svc, workspace, config);
    const unitPath = path.join(unitDir, `slycode-${svc}.service`);
    fs.writeFileSync(unitPath, unitContent);
    console.log(`  Written: slycode-${svc}.service`);
  }

  execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
  execSync(`systemctl --user enable ${installable.map(s => `slycode-${s}`).join(' ')}`, {
    stdio: 'pipe',
  });
  execSync(`systemctl --user restart ${installable.map(s => `slycode-${s}`).join(' ')}`, {
    stdio: 'pipe',
  });

  // Wait a moment for services to either stabilize or crash
  console.log('');
  console.log('Waiting for services to start...');
  await new Promise((r) => setTimeout(r, 3000));

  // Verify
  let allOk = true;
  for (const svc of installable) {
    try {
      const output = execSync(`systemctl --user is-active slycode-${svc}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (output === 'active') {
        console.log(`  \u2713 slycode-${svc} is running`);
      } else {
        console.warn(`  ! slycode-${svc}: ${output}`);
        allOk = false;
      }
    } catch {
      console.warn(`  \u2717 slycode-${svc} failed to start`);
      console.log(`    Check logs: journalctl --user -u slycode-${svc} --no-pager -n 20`);
      allOk = false;
    }
  }

  // Linger check
  if (!checkLinger()) {
    console.log('');
    console.warn('  ! Linger is not enabled for your user.');
    console.log('  Without linger, services stop when you log out.');
    console.log('  Enable with: loginctl enable-linger $USER');
  }

  console.log('');
  if (allOk) {
    console.log('Services installed and started.');
  } else {
    console.log('Some services failed. Use "journalctl --user -u slycode-<service>" to debug.');
  }
}

async function remove(): Promise<void> {
  ensureXdgRuntime();

  console.log('Removing systemd user services...');

  // Disable first (prevents restart loops), then stop with timeout
  for (const svc of SERVICES) {
    try { execSync(`systemctl --user disable slycode-${svc}`, { stdio: 'pipe' }); } catch { /* ok */ }
    try { execSync(`systemctl --user kill slycode-${svc}`, { stdio: 'pipe', timeout: 5000 }); } catch { /* ok */ }
    try { execSync(`systemctl --user stop slycode-${svc}`, { stdio: 'pipe', timeout: 5000 }); } catch { /* ok */ }
    const unitPath = path.join(getUnitDir(), `slycode-${svc}.service`);
    if (fs.existsSync(unitPath)) {
      fs.unlinkSync(unitPath);
    }
  }

  execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
  execSync('systemctl --user reset-failed', { stdio: 'pipe' });
  console.log('  \u2713 Systemd services removed');
}

async function status(): Promise<void> {
  ensureXdgRuntime();

  if (!hasSystemd()) {
    console.log('systemd is not available. Services not installed.');
    return;
  }

  // Check if any unit files exist
  const unitDir = getUnitDir();
  const hasUnits = SERVICES.some(svc =>
    fs.existsSync(path.join(unitDir, `slycode-${svc}.service`))
  );

  if (!hasUnits) {
    console.log('  No services installed.');
    console.log('  Install with: slycode service install');
    return;
  }

  for (const svc of SERVICES) {
    const unitPath = path.join(unitDir, `slycode-${svc}.service`);
    if (!fs.existsSync(unitPath)) {
      console.log(`  slycode-${svc}: not installed`);
      continue;
    }
    try {
      const output = execSync(`systemctl --user is-active slycode-${svc}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      console.log(`  slycode-${svc}: ${output}`);
    } catch {
      console.log(`  slycode-${svc}: inactive`);
    }
  }
}

export async function serviceLinux(
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
