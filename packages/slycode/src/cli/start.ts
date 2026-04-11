import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import { spawn, execSync } from 'child_process';
import { resolveWorkspaceOrExit, resolveConfig, ensureStateDir, getStateDir, resolvePackageDir } from './workspace';
import { refreshUpdates } from './sync';
import { SERVICES, detectInstalledServiceManager, ensureXdgRuntime } from '../platform/service-detect';

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

function startService(
  name: string,
  entryPoint: string,
  port: number,
  env: Record<string, string>,
  logFile: string,
  workspace: string
): number | null {
  if (!fs.existsSync(entryPoint)) {
    console.error(`  ✗ ${name}: entry point not found: ${entryPoint}`);
    return null;
  }

  const logStream = fs.openSync(logFile, 'a');
  const child = spawn('node', [entryPoint], {
    env: { ...process.env, ...env, PORT: String(port) },
    cwd: workspace,
    stdio: ['ignore', logStream, logStream],
    detached: true,
  });

  child.unref();
  fs.closeSync(logStream);

  return child.pid ?? null;
}

export async function start(_args: string[]): Promise<void> {
  const workspace = resolveWorkspaceOrExit();
  const config = resolveConfig(workspace);
  const stateDir = ensureStateDir();
  const logsDir = path.join(stateDir, 'logs');
  const stateFile = path.join(stateDir, 'state.json');
  const packageDir = resolvePackageDir(workspace);

  console.log('Starting SlyCode services...');
  console.log(`  Workspace: ${workspace}`);
  console.log('');

  // Refresh skill updates from package templates
  const updateResult = refreshUpdates(workspace);
  if (updateResult.refreshed > 0) {
    console.log(`  Refreshed ${updateResult.refreshed} skill update(s)`);
    console.log('');
  }

  // Check for newer version on npm (non-blocking, 3-second timeout)
  try {
    const latest = execSync('npm view @slycode/slycode version', {
      encoding: 'utf-8',
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }).trim();

    let current = '0.0.0';
    const pkgPath = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        current = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
      } catch { /* ignore */ }
    }

    if (latest && latest !== current) {
      console.log(`  A newer version of SlyCode is available (current: ${current}, latest: ${latest})`);
      console.log('  Run "slycode update" to upgrade.');
      console.log('');
    }
  } catch {
    // npm unreachable or timeout — fail silently
  }

  const host = config.host || '127.0.0.1';

  // Check if services should be managed by a platform service manager
  const serviceManager = detectInstalledServiceManager();

  if (serviceManager === 'systemd') {
    console.log('  Starting via systemd...');
    ensureXdgRuntime();
    const startedPorts: { name: string; port: number }[] = [];
    for (const svc of SERVICES) {
      const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `slycode-${svc}.service`);
      if (!fs.existsSync(unitPath)) continue;
      try {
        execSync(`systemctl --user start slycode-${svc}`, {
          stdio: 'pipe',
          timeout: 10000,
          windowsHide: true,
        });
        const port = config.ports[svc as keyof typeof config.ports] as number;
        console.log(`  \u2713 slycode-${svc} started`);
        startedPorts.push({ name: svc, port });
      } catch {
        // Check if already active
        try {
          const status = execSync(`systemctl --user is-active slycode-${svc}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
          }).trim();
          if (status === 'active') {
            console.log(`  slycode-${svc} is already running`);
          } else {
            console.error(`  \u2717 slycode-${svc} failed to start`);
            console.log(`    Check logs: journalctl --user -u slycode-${svc} --no-pager -n 20`);
          }
        } catch {
          console.error(`  \u2717 slycode-${svc} failed to start`);
          console.log(`    Check logs: journalctl --user -u slycode-${svc} --no-pager -n 20`);
        }
      }
    }

    // Health check — reuse waitForPort
    if (startedPorts.length > 0) {
      console.log('');
      console.log('Waiting for services to be ready...');
      let healthy = 0;
      for (const svc of startedPorts) {
        const ready = await waitForPort(svc.port, '127.0.0.1');
        if (ready) {
          console.log(`  \u2713 ${svc.name} ready on port ${svc.port}`);
          healthy++;
        } else {
          console.warn(`  \u26a0 ${svc.name} not responding on port ${svc.port}`);
        }
      }
      console.log('');
      if (healthy > 0) {
        const displayHost = host === '0.0.0.0' ? 'localhost' : host;
        console.log(`All services running.`);
        console.log(`  Web UI: http://${displayHost}:${config.ports.web}`);
      }
    }
    return;
  }

  if (serviceManager === 'launchd') {
    console.log('  Starting via launchd...');
    const uid = process.getuid?.() ?? 501;
    const startedPorts: { name: string; port: number }[] = [];
    for (const svc of SERVICES) {
      const plistFile = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.slycode.${svc}.plist`);
      if (!fs.existsSync(plistFile)) continue;
      const port = config.ports[svc as keyof typeof config.ports] as number;

      // Check if already loaded
      let isLoaded = false;
      try {
        execSync(`launchctl list com.slycode.${svc} 2>/dev/null`, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        isLoaded = true;
      } catch { /* not loaded */ }

      if (isLoaded) {
        // Already loaded — use kickstart to ensure it's running (handles crashed agents)
        try {
          execSync(`launchctl kickstart -k gui/${uid}/com.slycode.${svc}`, {
            stdio: 'pipe',
            timeout: 10000,
            windowsHide: true,
          });
          console.log(`  \u2713 com.slycode.${svc} restarted`);
        } catch {
          console.log(`  com.slycode.${svc} is already running`);
        }
      } else {
        // Not loaded — load the plist
        try {
          execSync(`launchctl load "${plistFile}"`, {
            stdio: 'pipe',
            timeout: 10000,
            windowsHide: true,
          });
          console.log(`  \u2713 com.slycode.${svc} loaded`);
        } catch {
          console.error(`  \u2717 com.slycode.${svc} failed to load`);
        }
      }
      startedPorts.push({ name: svc, port });
    }

    if (startedPorts.length > 0) {
      console.log('');
      console.log('Waiting for services to be ready...');
      let healthy = 0;
      for (const svc of startedPorts) {
        const ready = await waitForPort(svc.port, '127.0.0.1');
        if (ready) {
          console.log(`  \u2713 ${svc.name} ready on port ${svc.port}`);
          healthy++;
        } else {
          console.warn(`  \u26a0 ${svc.name} not responding on port ${svc.port}`);
        }
      }
      console.log('');
      if (healthy > 0) {
        const displayHost = host === '0.0.0.0' ? 'localhost' : host;
        console.log(`All services running.`);
        console.log(`  Web UI: http://${displayHost}:${config.ports.web}`);
      }
    }
    return;
  }

  // Manual mode: spawn detached processes

  // Check for already-running services
  if (fs.existsSync(stateFile)) {
    try {
      const existing: State = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      const running = existing.services.filter((s) => {
        try { process.kill(s.pid, 0); return true; } catch { return false; }
      });
      if (running.length > 0) {
        console.log('Services are already running:');
        for (const s of running) {
          console.log(`  ${s.name} (PID ${s.pid}, port ${s.port})`);
        }
        console.log('');
        console.log('Run "slycode stop" first, or use "slycode service status" to check.');
        return;
      }
    } catch {
      // Stale state file, continue
    }
  }

  const services: ServiceState[] = [];
  const baseEnv: Record<string, string> = {
    SLYCODE_HOME: workspace,
    NODE_ENV: 'production',
  };

  // Load .env to check channel configuration
  const envFile = path.join(workspace, '.env');
  const envVars: Record<string, string> = {};
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) envVars[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  const hasMessagingChannel = !!(envVars.TELEGRAM_BOT_TOKEN || envVars.SLACK_TOKEN);

  // Determine entry points
  // In packaged mode: node_modules/slycode/dist/{service}
  // In dev mode: {workspace}/{service}/
  const distDir = packageDir ? path.join(packageDir, 'dist') : null;

  // Only web binds to config.host — bridge and messaging are internal-only (localhost)
  const serviceConfigs = [
    {
      name: 'Web',
      enabled: config.services.web,
      port: config.ports.web,
      bindHost: host,
      // Standalone Next.js server or dev server
      // Standalone output nests under web/web/ due to outputFileTracingRoot
      entryPoint: distDir
        ? path.join(distDir, 'web', 'web', 'server.js')
        : path.join(workspace, 'web', 'node_modules', '.bin', 'next'),
      extraEnv: {
        HOSTNAME: host,
        HOST: host,
        BRIDGE_URL: `http://127.0.0.1:${config.ports.bridge}`,
      } as Record<string, string>,
    },
    {
      name: 'Bridge',
      enabled: config.services.bridge,
      port: config.ports.bridge,
      bindHost: '127.0.0.1',
      entryPoint: distDir
        ? path.join(distDir, 'bridge', 'index.js')
        : path.join(workspace, 'bridge', 'dist', 'index.js'),
      extraEnv: { ...envVars, BRIDGE_HOST: '127.0.0.1', HOST: '127.0.0.1' } as Record<string, string>,
    },
    {
      name: 'Messaging',
      enabled: config.services.messaging,
      port: config.ports.messaging,
      bindHost: '127.0.0.1',
      entryPoint: distDir
        ? path.join(distDir, 'messaging', 'index.js')
        : path.join(workspace, 'messaging', 'dist', 'index.js'),
      extraEnv: { ...envVars, HOST: '127.0.0.1' } as Record<string, string>,
    },
  ];

  for (const svc of serviceConfigs) {
    if (!svc.enabled) {
      console.log(`  ⊘ ${svc.name}: disabled in config`);
      continue;
    }

    // Skip messaging if no channels are configured
    if (svc.name === 'Messaging' && !hasMessagingChannel) {
      console.log(`  ⊘ ${svc.name}: skipped (no channels configured — add TELEGRAM_BOT_TOKEN to .env)`);
      continue;
    }

    // Check port availability
    if (await isPortInUse(svc.port, svc.bindHost)) {
      console.error(`  ✗ ${svc.name}: port ${svc.port} is already in use`);
      continue;
    }

    const logFile = path.join(logsDir, `${svc.name.toLowerCase()}.log`);
    const pid = startService(
      svc.name,
      svc.entryPoint,
      svc.port,
      { ...baseEnv, ...svc.extraEnv },
      logFile,
      workspace
    );

    if (pid) {
      console.log(`  ◉ ${svc.name}: starting (PID ${pid}, port ${svc.port})`);
      services.push({
        pid,
        port: svc.port,
        name: svc.name,
        startedAt: new Date().toISOString(),
      });
    }
  }

  // Save state
  const state: State = {
    workspace,
    services,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

  // Health check
  console.log('');
  console.log('Waiting for services to be ready...');
  let healthy = 0;
  let failed = 0;
  for (const svc of services) {
    // Always check on 127.0.0.1 — services bound to 0.0.0.0 are reachable here too
    const ready = await waitForPort(svc.port, '127.0.0.1');
    if (ready) {
      console.log(`  ✓ ${svc.name} ready on port ${svc.port}`);
      healthy++;
    } else {
      // Check if the process is still alive
      let alive = false;
      try { process.kill(svc.pid, 0); alive = true; } catch { /* dead */ }
      if (alive) {
        console.warn(`  ⚠ ${svc.name} is running but not responding on port ${svc.port}`);
      } else {
        console.error(`  ✗ ${svc.name} exited — check logs: ${path.join(logsDir, svc.name.toLowerCase() + '.log')}`);
      }
      failed++;
    }
  }

  console.log('');
  if (failed > 0 && healthy === 0) {
    console.error('All services failed to start. Check the logs above for details.');
    // Clean up state since nothing is actually running
    const aliveServices = services.filter((s) => {
      try { process.kill(s.pid, 0); return true; } catch { return false; }
    });
    if (aliveServices.length === 0) {
      try { fs.unlinkSync(stateFile); } catch { /* ok */ }
    }
  } else if (failed > 0) {
    console.warn(`${healthy}/${services.length} services started. Check logs for failed services.`);
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`  Web UI: http://${displayHost}:${config.ports.web}`);
  } else if (healthy > 0) {
    console.log(`All services running.`);
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`  Web UI: http://${displayHost}:${config.ports.web}`);
  }
}
