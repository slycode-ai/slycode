"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWorkspace = resolveWorkspace;
exports.resolveWorkspaceOrExit = resolveWorkspaceOrExit;
exports.resolveConfig = resolveConfig;
exports.getStateDir = getStateDir;
exports.ensureStateDir = ensureStateDir;
exports.saveWorkspacePath = saveWorkspacePath;
exports.resolvePackageDir = resolvePackageDir;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const DEFAULTS = {
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
function resolveWorkspace() {
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
        }
        catch {
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
            }
            catch {
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
function resolveWorkspaceOrExit() {
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
function resolveConfig(workspace) {
    const configPath = path.join(workspace, 'slycode.config.js');
    let userConfig = {};
    if (fs.existsSync(configPath)) {
        try {
            // Clear require cache to pick up changes
            delete require.cache[require.resolve(configPath)];
            userConfig = require(configPath);
        }
        catch (err) {
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
function getStateDir() {
    return SLYCODE_DIR;
}
/**
 * Ensure the .slycode state directory exists.
 */
function ensureStateDir() {
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
function saveWorkspacePath(workspacePath) {
    ensureStateDir();
    const config = {};
    if (fs.existsSync(CONFIG_FILE)) {
        try {
            Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
        }
        catch {
            // Start fresh if corrupted
        }
    }
    config.home = path.resolve(workspacePath);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
}
/**
 * Resolve the path to the slycode package (in node_modules).
 */
function resolvePackageDir(workspace) {
    const candidate = path.join(workspace, 'node_modules', '@slycode', 'slycode');
    if (fs.existsSync(candidate)) {
        return candidate;
    }
    // Fallback: resolve from this file's location (we ARE the package)
    return path.resolve(__dirname, '..', '..');
}
//# sourceMappingURL=workspace.js.map