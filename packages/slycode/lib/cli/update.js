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
exports.update = update;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const workspace_1 = require("./workspace");
const sync_1 = require("./sync");
const service_detect_1 = require("../platform/service-detect");
function restartSystemd() {
    console.log('  Restarting systemd services...');
    try {
        (0, child_process_1.execSync)('systemctl --user daemon-reload', { stdio: 'pipe', windowsHide: true });
    }
    catch { /* ok */ }
    for (const svc of service_detect_1.SERVICES) {
        const unitPath = path.join(os.homedir(), '.config', 'systemd', 'user', `slycode-${svc}.service`);
        if (!fs.existsSync(unitPath))
            continue;
        try {
            (0, child_process_1.execSync)(`systemctl --user restart slycode-${svc}`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
            console.log(`    ✓ slycode-${svc} restarted`);
        }
        catch {
            console.warn(`    ! slycode-${svc} failed to restart`);
        }
    }
}
function restartLaunchd() {
    console.log('  Restarting launchd agents...');
    const uid = process.getuid?.() ?? 0;
    for (const svc of service_detect_1.SERVICES) {
        const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `com.slycode.${svc}.plist`);
        if (!fs.existsSync(plistPath))
            continue;
        try {
            (0, child_process_1.execSync)(`launchctl kickstart -k gui/${uid}/com.slycode.${svc}`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
            console.log(`    ✓ com.slycode.${svc} restarted`);
        }
        catch {
            console.warn(`    ! com.slycode.${svc} failed to restart`);
        }
    }
}
function restartWindowsTasks() {
    console.log('  Restarting Windows tasks...');
    for (const svc of service_detect_1.SERVICES) {
        const name = `SlyCode-${svc}`;
        try {
            (0, child_process_1.execSync)(`schtasks /End /TN "${name}"`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
        }
        catch { /* may not be running */ }
        try {
            (0, child_process_1.execSync)(`schtasks /Run /TN "${name}"`, { stdio: 'pipe', timeout: 10000, windowsHide: true });
            console.log(`    ✓ ${name} restarted`);
        }
        catch {
            console.warn(`    ! ${name} failed to restart`);
        }
    }
}
async function restartBackground() {
    console.log('  Restarting background services...');
    const { stop } = await Promise.resolve().then(() => __importStar(require('./stop')));
    await stop([]);
    console.log('');
    const { start } = await Promise.resolve().then(() => __importStar(require('./start')));
    await start([]);
}
async function update(_args) {
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    const stateFile = path.join((0, workspace_1.getStateDir)(), 'state.json');
    // Detect how services are running before we update anything
    const runMode = (0, service_detect_1.detectRunMode)(stateFile);
    // Step 1: npm update @slycode/slycode
    console.log('Updating SlyCode...');
    console.log('');
    try {
        console.log('  Running npm update...');
        (0, child_process_1.execSync)('npm update @slycode/slycode', { cwd: workspace, stdio: 'inherit' });
        console.log('');
    }
    catch {
        console.error('  npm update failed. Check your network connection and try again.');
        process.exit(1);
    }
    // Step 2: Refresh updates from new templates
    const result = (0, sync_1.refreshUpdates)(workspace);
    if (result.refreshed > 0) {
        console.log(`  Refreshed ${result.refreshed} skill update(s):`);
        for (const d of result.details) {
            const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
            console.log(`    ✓ ${d.name} (${label})`);
        }
        console.log('');
    }
    // Step 2b: Refresh providers.json
    const providersResult = (0, sync_1.refreshProviders)(workspace);
    if (providersResult.updated) {
        console.log('  ✓ Providers updated');
        console.log('');
    }
    // Step 3: Restart services using the detected run mode
    if (runMode !== 'none') {
        switch (runMode) {
            case 'systemd':
                restartSystemd();
                break;
            case 'launchd':
                restartLaunchd();
                break;
            case 'windows-task':
                restartWindowsTasks();
                break;
            case 'background':
                await restartBackground();
                break;
        }
        console.log('');
    }
    // Summary
    const pkgPath = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'package.json');
    let version = 'unknown';
    if (fs.existsSync(pkgPath)) {
        try {
            version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
        }
        catch { /* ignore */ }
    }
    console.log(`SlyCode updated to v${version}.`);
    if (result.refreshed > 0) {
        console.log(`  ${result.refreshed} skill update(s) refreshed.`);
    }
    if (providersResult.updated) {
        console.log('  Providers refreshed.');
    }
    if (runMode !== 'none') {
        console.log(`  Services restarted (${runMode}).`);
    }
}
//# sourceMappingURL=update.js.map