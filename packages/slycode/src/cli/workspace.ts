import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

export interface SlyCodeConfig {
  host: string;
  ports: {
    web: number;
    bridge: number;
    messaging: number;
  };
  services: {
    web: boolean;
    bridge: boolean;
    messaging: boolean;
  };
}

const DEFAULTS: SlyCodeConfig = {
  host: '0.0.0.0',
  ports: { web: 7591, bridge: 7592, messaging: 7593 },
  services: { web: true, bridge: true, messaging: true },
};

const SLYCODE_DIR = path.join(os.homedir(), '.slycode');
const CONFIG_FILE = path.join(SLYCODE_DIR, 'config.json');

/**
 * Resolve the SlyCode workspace directory.
 *
 * Resolution order:
 * 1. SLYCODE_HOME environment variable
 * 2. ~/.slycode/config.json → { "home": "/path/to/workspace" }
 * 3. Walk up from cwd looking for slycode.config.js or package.json with slycode dep
 */
export function resolveWorkspace(): string | null {
  // 1. Environment variable
  const envHome = process.env.SLYCODE_HOME;
  if (envHome && fs.existsSync(envHome)) {
    return path.resolve(envHome);
  }

  // 2. Config file at ~/.slycode/config.json
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (config.home && fs.existsSync(config.home)) {
        return path.resolve(config.home);
      }
    } catch {
      // Corrupted config, continue to fallback
    }
  }

  // 3. Walk up from cwd
  let dir = process.cwd();
  const root = path.parse(dir).root;
  while (dir !== root) {
    // Check for slycode.config.js
    if (fs.existsSync(path.join(dir, 'slycode.config.js'))) {
      return dir;
    }
    // Check for package.json with slycode dependency
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.dependencies?.slycode || pkg.devDependencies?.slycode) {
          return dir;
        }
      } catch {
        // Ignore malformed package.json
      }
    }
    dir = path.dirname(dir);
  }

  return null;
}

/**
 * Resolve workspace or exit with an error message.
 */
export function resolveWorkspaceOrExit(): string {
  const workspace = resolveWorkspace();
  if (!workspace) {
    console.error('Error: Could not find SlyCode workspace.');
    console.error('');
    console.error('Looked for:');
    console.error('  1. SLYCODE_HOME environment variable');
    console.error('  2. ~/.slycode/config.json');
    console.error('  3. slycode.config.js in current or parent directories');
    console.error('');
    console.error('Run "npx create-slycode" to create a new workspace.');
    process.exit(1);
  }
  return workspace;
}

/**
 * Load slycode.config.js from the workspace, merged with defaults.
 */
export function resolveConfig(workspace: string): SlyCodeConfig {
  const configPath = path.join(workspace, 'slycode.config.js');
  let userConfig: Partial<SlyCodeConfig> = {};

  if (fs.existsSync(configPath)) {
    try {
      // Clear require cache to pick up changes
      delete require.cache[require.resolve(configPath)];
      userConfig = require(configPath);
    } catch (err) {
      console.warn(`Warning: Could not load slycode.config.js: ${err}`);
    }
  }

  return {
    host: userConfig.host || DEFAULTS.host,
    ports: { ...DEFAULTS.ports, ...userConfig.ports },
    services: { ...DEFAULTS.services, ...userConfig.services },
  };
}

/**
 * Get the path to the .slycode state directory (in home dir).
 */
export function getStateDir(): string {
  return SLYCODE_DIR;
}

/**
 * Ensure the .slycode state directory exists.
 */
export function ensureStateDir(): string {
  const dirs = [
    SLYCODE_DIR,
    path.join(SLYCODE_DIR, 'logs'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  return SLYCODE_DIR;
}

/**
 * Save workspace path to ~/.slycode/config.json
 */
export function saveWorkspacePath(workspacePath: string): void {
  ensureStateDir();
  const config: Record<string, unknown> = {};

  if (fs.existsSync(CONFIG_FILE)) {
    try {
      Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
    } catch {
      // Start fresh if corrupted
    }
  }

  config.home = path.resolve(workspacePath);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}

/**
 * Resolve the path to the slycode package (in node_modules).
 */
export function resolvePackageDir(workspace: string): string | null {
  const candidate = path.join(workspace, 'node_modules', '@slycode', 'slycode');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  // Fallback: resolve from this file's location (we ARE the package)
  return path.resolve(__dirname, '..', '..');
}
