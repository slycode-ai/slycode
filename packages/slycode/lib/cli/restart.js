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
exports.restart = restart;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const workspace_1 = require("./workspace");
const service_detect_1 = require("../platform/service-detect");
const USAGE = `
Usage: slycode restart [service]

Restart all services, or a specific one.

  slycode restart              Restart all services
  slycode restart web          Restart only the web service
  slycode restart bridge       Restart only the bridge service
  slycode restart messaging    Restart only the messaging service

Useful after editing .env to pick up new environment variables.
`.trim();
function isValidService(name) {
    return service_detect_1.SERVICES.includes(name);
}
async function restart(args) {
    if (args[0] === '--help' || args[0] === '-h') {
        console.log(USAGE);
        return;
    }
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    const config = (0, workspace_1.resolveConfig)(workspace);
    const stateDir = (0, workspace_1.getStateDir)();
    const stateFile = path.join(stateDir, 'state.json');
    // Determine which services to restart
    const target = args[0];
    if (target && !isValidService(target)) {
        console.error(`Unknown service: ${target}`);
        console.error(`Valid services: ${service_detect_1.SERVICES.join(', ')}`);
        process.exit(1);
    }
    const servicesToRestart = target ? [target] : service_detect_1.SERVICES;
    const runMode = (0, service_detect_1.detectRunMode)(stateFile);
    console.log(`Restarting ${target || 'all services'}...`);
    console.log('');
    if (runMode === 'systemd') {
        (0, service_detect_1.ensureXdgRuntime)();
        for (const svc of servicesToRestart) {
            const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `slycode-${svc}.service`);
            if (!fs.existsSync(unitPath)) {
                console.log(`  ⊘ slycode-${svc}: not installed`);
                continue;
            }
            try {
                (0, child_process_1.execSync)(`systemctl --user restart slycode-${svc}`, {
                    stdio: 'pipe',
                    timeout: 15000,
                    windowsHide: true,
                });
                console.log(`  ✓ slycode-${svc} restarted`);
            }
            catch {
                console.error(`  ✗ slycode-${svc} failed to restart`);
                console.log(`    Check logs: journalctl --user -u slycode-${svc} --no-pager -n 20`);
            }
        }
        console.log('');
        console.log('Done.');
        return;
    }
    if (runMode === 'launchd') {
        const uid = process.getuid?.() ?? 501;
        for (const svc of servicesToRestart) {
            const plistFile = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.slycode.${svc}.plist`);
            if (!fs.existsSync(plistFile)) {
                console.log(`  \u2298 com.slycode.${svc}: not installed`);
                continue;
            }
            try {
                (0, child_process_1.execSync)(`launchctl kickstart -k gui/${uid}/com.slycode.${svc}`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
                console.log(`  \u2713 com.slycode.${svc} restarted`);
            }
            catch {
                console.error(`  \u2717 com.slycode.${svc} failed to restart`);
            }
        }
        console.log('');
        console.log('Done.');
        return;
    }
    if (runMode === 'background') {
        // Manual mode: stop then start
        console.log('  Services are running in manual mode.');
        console.log('  Use "slycode stop" then "slycode start" to restart.');
        console.log('');
        console.log('  Tip: Install as a service for easier restart:');
        console.log('    slycode service install');
        return;
    }
    console.log('No running services found.');
    console.log('Start services with "slycode start" or "slycode service install".');
}
//# sourceMappingURL=restart.js.map