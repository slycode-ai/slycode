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
exports.SERVICES = void 0;
exports.ensureXdgRuntime = ensureXdgRuntime;
exports.detectRunMode = detectRunMode;
exports.detectInstalledServiceManager = detectInstalledServiceManager;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
exports.SERVICES = ['web', 'bridge', 'messaging'];
/**
 * Ensure XDG_RUNTIME_DIR is set.
 * Required for `systemctl --user` in environments like SSH, code-server, and cron
 * where the variable may not be inherited.
 */
function ensureXdgRuntime() {
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
function detectRunMode(stateFile) {
    // Linux: check systemd units
    if (process.platform === 'linux') {
        ensureXdgRuntime();
        const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
        const hasUnits = exports.SERVICES.some(svc => fs.existsSync(path.join(unitDir, `slycode-${svc}.service`)));
        if (hasUnits) {
            try {
                const output = (0, child_process_1.execSync)('systemctl --user is-active slycode-web', {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                }).trim();
                if (output === 'active')
                    return 'systemd';
            }
            catch { /* not active or systemd unavailable */ }
        }
    }
    // macOS: check launchd agents
    if (process.platform === 'darwin') {
        const agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
        const hasAgents = exports.SERVICES.some(svc => fs.existsSync(path.join(agentDir, `com.slycode.${svc}.plist`)));
        if (hasAgents) {
            try {
                const output = (0, child_process_1.execSync)('launchctl list com.slycode.web 2>/dev/null', {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    windowsHide: true,
                });
                if (output.includes('"PID"'))
                    return 'launchd';
            }
            catch { /* not loaded */ }
        }
    }
    // Windows: check Task Scheduler
    if (process.platform === 'win32') {
        try {
            const output = (0, child_process_1.execSync)('schtasks /Query /TN "SlyCode-web" /FO CSV /NH', {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            });
            if (output.includes('Running'))
                return 'windows-task';
        }
        catch { /* not installed */ }
    }
    // Fallback: PID-based background processes
    if (fs.existsSync(stateFile)) {
        try {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            const running = state.services?.some((s) => {
                try {
                    process.kill(s.pid, 0);
                    return true;
                }
                catch {
                    return false;
                }
            });
            if (running)
                return 'background';
        }
        catch { /* stale state */ }
    }
    return 'none';
}
/**
 * Detect if service manager units/plists are installed (regardless of active state).
 * Used by start to decide whether to delegate to the service manager.
 */
function detectInstalledServiceManager() {
    if (process.platform === 'linux') {
        ensureXdgRuntime();
        const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
        const hasUnits = exports.SERVICES.some(svc => fs.existsSync(path.join(unitDir, `slycode-${svc}.service`)));
        if (hasUnits)
            return 'systemd';
    }
    if (process.platform === 'darwin') {
        const agentDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
        const hasAgents = exports.SERVICES.some(svc => fs.existsSync(path.join(agentDir, `com.slycode.${svc}.plist`)));
        if (hasAgents)
            return 'launchd';
    }
    return 'none';
}
//# sourceMappingURL=service-detect.js.map