import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import { execSync } from 'child_process';
import { resolveWorkspace, resolveConfig, getStateDir } from './workspace';

type CheckResult = 'ok' | 'warn' | 'fail';

interface Check {
  name: string;
  result: CheckResult;
  message: string;
}

function icon(result: CheckResult): string {
  switch (result) {
    case 'ok': return '\u2713';
    case 'warn': return '!';
    case 'fail': return '\u2717';
  }
}

const PREBUILT_PLATFORMS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'win32-arm64',
  'win32-x64',
  'linux-arm64',
  'linux-x64',
]);

function hasCommand(cmd: string): boolean {
  try {
    if (process.platform === 'win32') {
      execSync(`where ${cmd}`, { stdio: 'ignore', windowsHide: true });
    } else {
      execSync(`command -v ${cmd}`, { stdio: 'ignore', windowsHide: true, shell: '/bin/sh' });
    }
    return true;
  } catch {
    return false;
  }
}

function buildToolsCheck(): Check {
  const key = `${process.platform}-${process.arch}`;
  if (PREBUILT_PLATFORMS.has(key)) {
    return { name: 'Build tools', result: 'ok', message: `No local build tools normally required (${key} prebuild)` };
  }
  const missing: string[] = [];
  const hasC = !!process.env.CC || hasCommand('gcc') || hasCommand('clang') || hasCommand('cc');
  const hasCxx = !!process.env.CXX || hasCommand('g++') || hasCommand('clang++') || hasCommand('c++');
  const hasMake = hasCommand('make');
  const hasPython = hasCommand('python3') || hasCommand('python');
  if (!hasC) missing.push('C compiler');
  if (!hasCxx) missing.push('C++ compiler');
  if (!hasMake) missing.push('make');
  if (!hasPython) missing.push('python3');
  if (missing.length === 0) {
    return { name: 'Build tools', result: 'ok', message: `C/C++ toolchain detected (required on ${key} — no prebuild)` };
  }
  return { name: 'Build tools', result: 'fail', message: `Missing on ${key}: ${missing.join(', ')}` };
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

export async function doctor(_args: string[]): Promise<void> {
  const checks: Check[] = [];

  console.log('SlyCode Doctor');
  console.log('==============');
  console.log('');

  // 1. Node.js version
  const [major] = process.versions.node.split('.').map(Number);
  if (major >= 20) {
    checks.push({ name: 'Node.js version', result: 'ok', message: `v${process.versions.node}` });
  } else {
    checks.push({
      name: 'Node.js version',
      result: 'fail',
      message: `v${process.versions.node} (requires >= 20.0.0)`,
    });
  }

  // 2. Build tools (only matters on platforms with no node-pty prebuild)
  // Keep wording in sync with: packages/slycode/scripts/preinstall.js,
  // packages/slycode/README.md, scripts/setup.sh:check_build_tools().
  checks.push(buildToolsCheck());

  // 3. Workspace
  const workspace = resolveWorkspace();
  if (workspace) {
    checks.push({ name: 'Workspace', result: 'ok', message: workspace });
  } else {
    checks.push({
      name: 'Workspace',
      result: 'fail',
      message: 'Not found. Set SLYCODE_HOME or create slycode.config.js',
    });
    // Can't continue many checks without a workspace
    printResults(checks);
    return;
  }

  // 3. Config file
  const configPath = path.join(workspace, 'slycode.config.js');
  if (fs.existsSync(configPath)) {
    try {
      const config = resolveConfig(workspace);
      checks.push({
        name: 'Config (slycode.config.js)',
        result: 'ok',
        message: `ports: ${config.ports.web}/${config.ports.bridge}/${config.ports.messaging}`,
      });
    } catch {
      checks.push({ name: 'Config (slycode.config.js)', result: 'warn', message: 'File exists but could not be loaded' });
    }
  } else {
    checks.push({ name: 'Config (slycode.config.js)', result: 'ok', message: 'Not present (using defaults)' });
  }

  const config = resolveConfig(workspace);

  // 4. .env file
  const envPath = path.join(workspace, '.env');
  if (fs.existsSync(envPath)) {
    checks.push({ name: '.env file', result: 'ok', message: 'Present' });
  } else {
    checks.push({ name: '.env file', result: 'warn', message: 'Not found (create from .env.example)' });
  }

  // 5. Port availability
  const ports = [
    { name: 'Web', port: config.ports.web },
    { name: 'Bridge', port: config.ports.bridge },
    { name: 'Messaging', port: config.ports.messaging },
  ];

  for (const p of ports) {
    const inUse = await isPortInUse(p.port);
    if (inUse) {
      // Could be our service running — check state
      const stateFile = path.join(getStateDir(), 'state.json');
      let ours = false;
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
          ours = state.services?.some((s: { port: number }) => s.port === p.port);
        } catch { /* ignore */ }
      }
      if (ours) {
        checks.push({ name: `Port ${p.port} (${p.name})`, result: 'ok', message: 'In use by SlyCode' });
      } else {
        checks.push({ name: `Port ${p.port} (${p.name})`, result: 'warn', message: 'In use by another process' });
      }
    } else {
      checks.push({ name: `Port ${p.port} (${p.name})`, result: 'ok', message: 'Available' });
    }
  }

  // 6. Global CLIs
  const cliTools = ['sly-kanban', 'sly-messaging', 'sly-scaffold'];
  for (const tool of cliTools) {
    try {
      execSync(`command -v ${tool}`, { stdio: 'pipe', windowsHide: true });
      checks.push({ name: tool, result: 'ok', message: 'Found in PATH' });
    } catch {
      checks.push({ name: tool, result: 'warn', message: 'Not in PATH (run: slycode service install)' });
    }
  }

  // 7. AI coding agents
  const agents = [
    { name: 'Claude Code', cmd: 'claude --version' },
    { name: 'Codex', cmd: 'codex --version' },
    { name: 'Gemini CLI', cmd: 'gemini --version' },
  ];
  const foundAgents: string[] = [];
  for (const agent of agents) {
    try {
      const version = execSync(`${agent.cmd} 2>/dev/null`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }).trim();
      checks.push({ name: agent.name, result: 'ok', message: version });
      foundAgents.push(agent.name);
    } catch {
      checks.push({ name: agent.name, result: 'ok', message: 'Not installed' });
    }
  }
  if (foundAgents.length === 0) {
    checks.push({
      name: 'AI coding agents',
      result: 'warn',
      message: 'No coding agents found. Install at least one (claude, codex, or gemini).',
    });
  }

  // 8. Workspace structure
  const expectedDirs = ['.claude/skills', 'data', 'documentation'];
  const missingDirs = expectedDirs.filter(d => !fs.existsSync(path.join(workspace, d)));
  if (missingDirs.length === 0) {
    checks.push({ name: 'Workspace structure', result: 'ok', message: 'All expected directories present' });
  } else {
    checks.push({
      name: 'Workspace structure',
      result: 'warn',
      message: `Missing: ${missingDirs.join(', ')}`,
    });
  }

  printResults(checks);
}

function printResults(checks: Check[]): void {
  for (const check of checks) {
    console.log(`  ${icon(check.result)} ${check.name}: ${check.message}`);
  }

  console.log('');
  const fails = checks.filter(c => c.result === 'fail');
  const warns = checks.filter(c => c.result === 'warn');
  const oks = checks.filter(c => c.result === 'ok');

  if (fails.length > 0) {
    console.log(`${oks.length} passed, ${warns.length} warnings, ${fails.length} errors`);
  } else if (warns.length > 0) {
    console.log(`${oks.length} passed, ${warns.length} warnings`);
  } else {
    console.log(`All ${oks.length} checks passed. SlyCode looks healthy.`);
  }
}
