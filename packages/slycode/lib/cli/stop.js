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
exports.stop = stop;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const workspace_1 = require("./workspace");
const service_detect_1 = require("../platform/service-detect");
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function findPidOnPort(port) {
    try {
        // Try ss first (Linux)
        const output = (0, child_process_1.execSync)(`ss -tlnp 2>/dev/null | grep ":${port} "`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const match = output.match(/pid=(\d+)/);
        if (match)
            return parseInt(match[1], 10);
    }
    catch {
        // ss not available or no match
    }
    try {
        // Try lsof (macOS / Linux fallback)
        const output = (0, child_process_1.execSync)(`lsof -ti :${port} 2>/dev/null`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });
        const pid = parseInt(output.trim().split('\n')[0], 10);
        if (!isNaN(pid))
            return pid;
    }
    catch {
        // lsof not available or no match
    }
    return null;
}
function killProcess(pid, name) {
    console.log(`  Stopping ${name} (PID ${pid})...`);
    const isWindows = process.platform === 'win32';
    if (isWindows) {
        try {
            (0, child_process_1.execSync)(`taskkill /PID ${pid} /T /F`, { stdio: 'pipe', windowsHide: true });
            return true;
        }
        catch {
            return false;
        }
    }
    // Unix: kill children first, then parent
    try {
        (0, child_process_1.execSync)(`pkill -P ${pid} 2>/dev/null`, { stdio: 'pipe', windowsHide: true });
    }
    catch {
        // No children or pkill not available
    }
    try {
        process.kill(pid, 'SIGTERM');
    }
    catch {
        return false;
    }
    // Wait up to 5 seconds for graceful shutdown
    const start = Date.now();
    while (Date.now() - start < 5000) {
        if (!isProcessAlive(pid))
            return true;
        // Busy-wait in small increments (sync stop command)
        (0, child_process_1.execSync)('sleep 0.5', { stdio: 'pipe', windowsHide: true });
    }
    // Force kill
    if (isProcessAlive(pid)) {
        console.warn(`  ! ${name} didn't stop gracefully, force killing...`);
        try {
            (0, child_process_1.execSync)(`pkill -9 -P ${pid} 2>/dev/null`, { stdio: 'pipe', windowsHide: true });
        }
        catch {
            // ignore
        }
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch {
            // ignore
        }
    }
    return !isProcessAlive(pid);
}
async function stop(_args) {
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    const config = (0, workspace_1.resolveConfig)(workspace);
    const stateDir = (0, workspace_1.getStateDir)();
    const stateFile = path.join(stateDir, 'state.json');
    console.log('Stopping SlyCode...');
    console.log('');
    // Check if services are managed by a platform service manager
    const runMode = (0, service_detect_1.detectRunMode)(stateFile);
    if (runMode === 'systemd') {
        console.log('  Stopping via systemd...');
        (0, service_detect_1.ensureXdgRuntime)();
        let stoppedAny = false;
        for (const svc of service_detect_1.SERVICES) {
            const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `slycode-${svc}.service`);
            if (!fs.existsSync(unitPath))
                continue;
            try {
                (0, child_process_1.execSync)(`systemctl --user stop slycode-${svc}`, {
                    stdio: 'pipe',
                    timeout: 10000,
                    windowsHide: true,
                });
                console.log(`  \u2713 slycode-${svc} stopped`);
                stoppedAny = true;
            }
            catch {
                // Check if it was already inactive
                try {
                    const status = (0, child_process_1.execSync)(`systemctl --user is-active slycode-${svc}`, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'pipe'],
                        windowsHide: true,
                    }).trim();
                    if (status === 'inactive') {
                        console.log(`  slycode-${svc} was not running`);
                    }
                    else {
                        console.error(`  \u2717 slycode-${svc} could not be stopped`);
                    }
                }
                catch {
                    console.log(`  slycode-${svc} was not running`);
                }
            }
        }
        // Clean up any stale state file from previous manual runs
        if (fs.existsSync(stateFile)) {
            fs.unlinkSync(stateFile);
        }
        console.log('');
        console.log(stoppedAny ? 'SlyCode stopped.' : 'Nothing was running.');
        return;
    }
    if (runMode === 'launchd') {
        console.log('  Stopping via launchd...');
        let stoppedAny = false;
        for (const svc of service_detect_1.SERVICES) {
            const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.slycode.${svc}.plist`);
            if (!fs.existsSync(plistPath))
                continue;
            try {
                (0, child_process_1.execSync)(`launchctl unload "${plistPath}"`, {
                    stdio: 'pipe',
                    timeout: 10000,
                    windowsHide: true,
                });
                console.log(`  \u2713 com.slycode.${svc} stopped`);
                stoppedAny = true;
            }
            catch {
                console.log(`  com.slycode.${svc} was not running`);
            }
        }
        if (fs.existsSync(stateFile)) {
            fs.unlinkSync(stateFile);
        }
        console.log('');
        console.log(stoppedAny ? 'SlyCode stopped.' : 'Nothing was running.');
        return;
    }
    // Manual mode: PID-based stopping
    let stoppedAny = false;
    // Strategy 1: Use state file for known PIDs
    if (fs.existsSync(stateFile)) {
        try {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
            for (const svc of state.services) {
                if (isProcessAlive(svc.pid)) {
                    if (killProcess(svc.pid, svc.name)) {
                        console.log(`  \u2713 ${svc.name} stopped`);
                        stoppedAny = true;
                    }
                    else {
                        console.error(`  \u2717 ${svc.name} (PID ${svc.pid}) could not be stopped`);
                    }
                }
                else {
                    console.log(`  ${svc.name} was not running`);
                }
            }
        }
        catch {
            // Corrupted state file, fall through to port-based discovery
        }
    }
    // Strategy 2: Port-based fallback
    if (!stoppedAny) {
        const portMap = [
            { name: 'Web', port: config.ports.web },
            { name: 'Bridge', port: config.ports.bridge },
            { name: 'Messaging', port: config.ports.messaging },
        ];
        for (const svc of portMap) {
            const pid = findPidOnPort(svc.port);
            if (pid) {
                if (killProcess(pid, svc.name)) {
                    console.log(`  \u2713 ${svc.name} stopped (was on port ${svc.port})`);
                    stoppedAny = true;
                }
                else {
                    console.error(`  \u2717 ${svc.name} (PID ${pid}) could not be stopped`);
                }
            }
            else {
                console.log(`  ${svc.name} \u2014 not running (port ${svc.port} free)`);
            }
        }
    }
    // Clean up state file
    if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
    }
    console.log('');
    if (stoppedAny) {
        console.log('SlyCode stopped.');
    }
    else {
        console.log('Nothing was running.');
    }
}
//# sourceMappingURL=stop.js.map