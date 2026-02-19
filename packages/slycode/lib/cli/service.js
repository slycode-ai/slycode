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
exports.service = service;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const workspace_1 = require("./workspace");
const USAGE = `
Usage: slycode service <action>

Actions:
  install    Install SlyCode as a system service (auto-start on boot)
  remove     Remove system service
  status     Check service status

Platform support:
  Linux      systemd user services
  macOS      launchd user agents
  Windows    Task Scheduler tasks
`.trim();
function detectPlatform() {
    switch (process.platform) {
        case 'linux': return 'linux';
        case 'darwin': return 'darwin';
        case 'win32': return 'win32';
        default: return 'unsupported';
    }
}
async function service(args) {
    const action = args[0];
    if (!action || action === '--help' || action === '-h') {
        console.log(USAGE);
        return;
    }
    if (!['install', 'remove', 'status'].includes(action)) {
        console.error(`Unknown action: ${action}`);
        console.error('Run "slycode service --help" for usage.');
        process.exit(1);
    }
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    const config = (0, workspace_1.resolveConfig)(workspace);
    const platform = detectPlatform();
    if (platform === 'unsupported') {
        console.error(`Unsupported platform: ${process.platform}`);
        console.error('SlyCode services are supported on Linux, macOS, and Windows.');
        process.exit(1);
    }
    // Dynamic import for platform-specific module
    switch (platform) {
        case 'linux': {
            const { serviceLinux } = await Promise.resolve().then(() => __importStar(require('../platform/service-linux')));
            await serviceLinux(action, workspace, config);
            break;
        }
        case 'darwin': {
            const { serviceMacos } = await Promise.resolve().then(() => __importStar(require('../platform/service-macos')));
            await serviceMacos(action, workspace, config);
            break;
        }
        case 'win32': {
            console.error('System service management is not yet supported on Windows.');
            console.error('Use "slycode start" and "slycode stop" to manage services manually.');
            process.exit(1);
        }
    }
    // After showing system service status, check for manually running processes
    if (action === 'status') {
        const stateFile = path.join((0, workspace_1.getStateDir)(), 'state.json');
        if (fs.existsSync(stateFile)) {
            try {
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
                const running = (state.services || []).filter((s) => {
                    try {
                        process.kill(s.pid, 0);
                        return true;
                    }
                    catch {
                        return false;
                    }
                });
                if (running.length > 0) {
                    console.log('');
                    console.log('Note: Services are running manually (started via "slycode start"):');
                    for (const s of running) {
                        console.log(`  ${s.name} (PID ${s.pid}, port ${s.port})`);
                    }
                    console.log('Use "slycode stop" to manage these.');
                }
            }
            catch { /* stale state, ignore */ }
        }
    }
}
//# sourceMappingURL=service.js.map