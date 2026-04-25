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
const net = __importStar(require("net"));
const child_process_1 = require("child_process");
const workspace_1 = require("./workspace");
const sync_1 = require("./sync");
const service_detect_1 = require("../platform/service-detect");
const symlinks_1 = require("../platform/symlinks");
const service_common_1 = require("../platform/service-common");
function isPortInUse(port, host = '127.0.0.1') {
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
async function waitForPort(port, host = '127.0.0.1', timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await isPortInUse(port, host))
            return true;
        await new Promise((r) => setTimeout(r, 500));
    }
    return false;
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
function logHintFor(service, runMode) {
    switch (runMode) {
        case 'systemd': return `journalctl --user -u slycode-${service} --no-pager -n 40`;
        case 'launchd': return `~/.slycode/logs/${service}.log`;
        case 'windows-task': return `Event Viewer → Task Scheduler history, task "SlyCode-${service}"`;
        case 'background': return `~/.slycode/logs/${service}.log`;
        default: return 'check service logs';
    }
}
async function verifyServicesUp(workspace, config, runMode) {
    const envVars = (0, service_common_1.loadEnvFile)(workspace);
    // Mirror install-time enablement logic so we don't warn on services that were
    // intentionally skipped (e.g. messaging without a channel token).
    const enabled = [];
    for (const svc of service_detect_1.SERVICES) {
        if (!config.services[svc])
            continue;
        if (svc === 'messaging' && !envVars.TELEGRAM_BOT_TOKEN && !envVars.SLACK_TOKEN)
            continue;
        enabled.push({ name: svc, port: config.ports[svc] });
    }
    const failures = [];
    for (const svc of enabled) {
        const ready = await waitForPort(svc.port, '127.0.0.1', 15000);
        if (!ready)
            failures.push(svc.name);
    }
    if (failures.length > 0) {
        console.log('');
        for (const name of failures) {
            console.error(`  ✗ ${name} did not come up on its port after restart`);
            console.error(`    Logs: ${logHintFor(name, runMode)}`);
        }
    }
}
async function update(_args) {
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    const config = (0, workspace_1.resolveConfig)(workspace);
    const stateFile = path.join((0, workspace_1.getStateDir)(), 'state.json');
    // Detect how services are running before we update anything
    const runMode = (0, service_detect_1.detectRunMode)(stateFile);
    // On Windows background mode, the running node.exe holds file locks on dist/*.js.
    // npm update cannot overwrite those files while the service is running — so stop
    // first, then update, then restart (instead of the usual restart-after-update).
    if (runMode === 'background' && process.platform === 'win32') {
        console.log('Stopping services before update (Windows file locks)...');
        const { stop } = await Promise.resolve().then(() => __importStar(require('./stop')));
        await stop([]);
        console.log('');
    }
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
    // Step 1b: Re-link CLI commands to pick up updated binaries
    (0, symlinks_1.linkClis)(workspace);
    // Step 2: Refresh skill updates from new templates
    const result = (0, sync_1.refreshUpdates)(workspace);
    if (result.refreshed > 0) {
        console.log(`  Refreshed ${result.refreshed} skill update(s):`);
        for (const d of result.details) {
            const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
            console.log(`    ✓ ${d.name} (${label})`);
        }
        console.log('');
    }
    // Step 2a: Refresh action updates from new templates
    const actionResult = (0, sync_1.refreshActionUpdates)(workspace);
    if (actionResult.refreshed > 0) {
        console.log(`  Refreshed ${actionResult.refreshed} action update(s):`);
        for (const d of actionResult.details) {
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
    // Step 2c: Seed terminal-classes.json if missing
    const tcResult = (0, sync_1.refreshTerminalClasses)(workspace);
    if (tcResult.seeded) {
        console.log('  ✓ Seeded terminal-classes.json');
        console.log('');
    }
    // Step 3: Restart services using the detected run mode.
    // For systemd/launchd we call the platform install function instead of a plain
    // restart: it regenerates the unit/plist with current binary paths, so a stale
    // unit pointing at an old dist layout can't leave the service broken.
    if (runMode !== 'none') {
        switch (runMode) {
            case 'systemd': {
                const { serviceLinux } = await Promise.resolve().then(() => __importStar(require('../platform/service-linux')));
                await serviceLinux('install', workspace, config);
                break;
            }
            case 'launchd': {
                const { serviceMacos } = await Promise.resolve().then(() => __importStar(require('../platform/service-macos')));
                await serviceMacos('install', workspace, config);
                break;
            }
            case 'windows-task':
                restartWindowsTasks();
                break;
            case 'background': {
                console.log('  Restarting background services...');
                // On Windows we already stopped before npm update to release file locks.
                // Everywhere else, stop now.
                if (process.platform !== 'win32') {
                    const { stop } = await Promise.resolve().then(() => __importStar(require('./stop')));
                    await stop([]);
                    console.log('');
                }
                const { start } = await Promise.resolve().then(() => __importStar(require('./start')));
                await start([]);
                break;
            }
        }
        console.log('');
        // Step 4: Verify services actually came up. Silent on success; prints one
        // error line per failed service with a log pointer.
        await verifyServicesUp(workspace, config, runMode);
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
    if (actionResult.refreshed > 0) {
        console.log(`  ${actionResult.refreshed} action update(s) refreshed.`);
    }
    if (providersResult.updated) {
        console.log('  Providers refreshed.');
    }
    if (tcResult.seeded) {
        console.log('  Terminal classes seeded.');
    }
    if (runMode !== 'none') {
        console.log(`  Services restarted (${runMode}).`);
    }
}
//# sourceMappingURL=update.js.map