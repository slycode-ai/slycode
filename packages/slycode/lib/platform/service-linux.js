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
exports.serviceLinux = serviceLinux;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const service_common_1 = require("./service-common");
function hasSystemd() {
    try {
        (0, child_process_1.execSync)('systemctl --user --version', { stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
function ensureXdgRuntime() {
    if (!process.env.XDG_RUNTIME_DIR) {
        const candidate = `/run/user/${process.getuid()}`;
        if (fs.existsSync(candidate)) {
            process.env.XDG_RUNTIME_DIR = candidate;
        }
    }
}
function getUnitDir() {
    const dir = path.join(os.homedir(), '.config', 'systemd', 'user');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function generateUnit(service, workspace, config) {
    const nodePath = process.execPath;
    const resolvedPackage = (0, service_common_1.resolveEntryPoint)(service, workspace);
    const wrapperScript = (0, service_common_1.resolveWrapperScript)(workspace);
    const bridgeUrl = `http://127.0.0.1:${config.ports.bridge}`;
    const host = config.host || '127.0.0.1';
    let description;
    const envLines = [];
    switch (service) {
        case 'web':
            description = 'SlyCode Web (Command Center)';
            envLines.push(`Environment="PORT=${config.ports.web}"`);
            envLines.push(`Environment="HOSTNAME=${host}"`);
            envLines.push(`Environment="HOST=${host}"`);
            envLines.push(`Environment="BRIDGE_URL=${bridgeUrl}"`);
            break;
        case 'bridge':
            description = 'SlyCode Bridge (PTY Terminal)';
            envLines.push(`Environment="PORT=${config.ports.bridge}"`);
            envLines.push(`Environment="BRIDGE_PORT=${config.ports.bridge}"`);
            envLines.push(`Environment="BRIDGE_HOST=127.0.0.1"`);
            envLines.push(`Environment="HOST=127.0.0.1"`);
            break;
        case 'messaging':
            description = 'SlyCode Messaging Service';
            envLines.push(`Environment="PORT=${config.ports.messaging}"`);
            envLines.push(`Environment="MESSAGING_SERVICE_PORT=${config.ports.messaging}"`);
            envLines.push(`Environment="HOST=127.0.0.1"`);
            envLines.push(`Environment="BRIDGE_URL=${bridgeUrl}"`);
            break;
        default:
            throw new Error(`Unknown service: ${service}`);
    }
    return `[Unit]
Description=${description}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${workspace}
ExecStart=${wrapperScript} ${nodePath} ${resolvedPackage}
Restart=always
RestartSec=5
Environment="HOME=${os.homedir()}"
Environment="PATH=${process.env.PATH}"
Environment="NODE_ENV=production"
Environment="SLYCODE_HOME=${workspace}"
${envLines.join('\n')}

[Install]
WantedBy=default.target
`;
}
function checkLinger() {
    try {
        const output = (0, child_process_1.execSync)(`loginctl show-user ${os.userInfo().username} -p Linger --value 2>/dev/null`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
        return output.trim() === 'yes';
    }
    catch {
        return false;
    }
}
async function install(workspace, config) {
    if (!hasSystemd()) {
        console.error('systemd is not available on this system.');
        console.error('Use "slycode start" for manual process management.');
        process.exit(1);
    }
    ensureXdgRuntime();
    const unitDir = getUnitDir();
    const envVars = (0, service_common_1.loadEnvFile)(workspace);
    console.log('Installing systemd user services...');
    console.log('');
    const enabled = (0, service_common_1.getEnabledServices)(config, envVars);
    if (enabled.length === 0) {
        console.error('No services to install.');
        return;
    }
    console.log('');
    // Validate entry points before installing
    const installable = [];
    for (const svc of enabled) {
        const entryPoint = (0, service_common_1.resolveEntryPoint)(svc, workspace);
        if (!fs.existsSync(entryPoint)) {
            console.warn(`  \u2717 ${svc}: entry point not found: ${entryPoint}`);
            continue;
        }
        installable.push(svc);
    }
    if (installable.length === 0) {
        console.error('No services have valid entry points. Is slycode installed?');
        console.error('Try: cd ' + workspace + ' && npm install');
        return;
    }
    // Ensure env wrapper script is executable
    const wrapperScript = (0, service_common_1.resolveWrapperScript)(workspace);
    if (!fs.existsSync(wrapperScript)) {
        console.error(`  ✗ env wrapper not found: ${wrapperScript}`);
        console.error('Is slycode installed correctly?');
        return;
    }
    try {
        fs.chmodSync(wrapperScript, 0o755);
    }
    catch { /* ok if already executable */ }
    for (const svc of installable) {
        const unitContent = generateUnit(svc, workspace, config);
        const unitPath = path.join(unitDir, `slycode-${svc}.service`);
        fs.writeFileSync(unitPath, unitContent);
        console.log(`  Written: slycode-${svc}.service`);
    }
    (0, child_process_1.execSync)('systemctl --user daemon-reload', { stdio: 'pipe' });
    (0, child_process_1.execSync)(`systemctl --user enable ${installable.map(s => `slycode-${s}`).join(' ')}`, {
        stdio: 'pipe',
    });
    (0, child_process_1.execSync)(`systemctl --user restart ${installable.map(s => `slycode-${s}`).join(' ')}`, {
        stdio: 'pipe',
    });
    // Wait a moment for services to either stabilize or crash
    console.log('');
    console.log('Waiting for services to start...');
    await new Promise((r) => setTimeout(r, 3000));
    // Verify
    let allOk = true;
    for (const svc of installable) {
        try {
            const output = (0, child_process_1.execSync)(`systemctl --user is-active slycode-${svc}`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            if (output === 'active') {
                console.log(`  \u2713 slycode-${svc} is running`);
            }
            else {
                console.warn(`  ! slycode-${svc}: ${output}`);
                allOk = false;
            }
        }
        catch {
            console.warn(`  \u2717 slycode-${svc} failed to start`);
            console.log(`    Check logs: journalctl --user -u slycode-${svc} --no-pager -n 20`);
            allOk = false;
        }
    }
    // Linger check
    if (!checkLinger()) {
        console.log('');
        console.warn('  ! Linger is not enabled for your user.');
        console.log('  Without linger, services stop when you log out.');
        console.log('  Enable with: loginctl enable-linger $USER');
    }
    console.log('');
    if (allOk) {
        console.log('Services installed and started.');
    }
    else {
        console.log('Some services failed. Use "journalctl --user -u slycode-<service>" to debug.');
    }
}
async function remove() {
    ensureXdgRuntime();
    console.log('Removing systemd user services...');
    // Disable first (prevents restart loops), then stop with timeout
    for (const svc of service_common_1.SERVICES) {
        try {
            (0, child_process_1.execSync)(`systemctl --user disable slycode-${svc}`, { stdio: 'pipe' });
        }
        catch { /* ok */ }
        try {
            (0, child_process_1.execSync)(`systemctl --user kill slycode-${svc}`, { stdio: 'pipe', timeout: 5000 });
        }
        catch { /* ok */ }
        try {
            (0, child_process_1.execSync)(`systemctl --user stop slycode-${svc}`, { stdio: 'pipe', timeout: 5000 });
        }
        catch { /* ok */ }
        const unitPath = path.join(getUnitDir(), `slycode-${svc}.service`);
        if (fs.existsSync(unitPath)) {
            fs.unlinkSync(unitPath);
        }
    }
    (0, child_process_1.execSync)('systemctl --user daemon-reload', { stdio: 'pipe' });
    (0, child_process_1.execSync)('systemctl --user reset-failed', { stdio: 'pipe' });
    console.log('  \u2713 Systemd services removed');
}
async function status() {
    ensureXdgRuntime();
    if (!hasSystemd()) {
        console.log('systemd is not available. Services not installed.');
        return;
    }
    // Check if any unit files exist
    const unitDir = getUnitDir();
    const hasUnits = service_common_1.SERVICES.some(svc => fs.existsSync(path.join(unitDir, `slycode-${svc}.service`)));
    if (!hasUnits) {
        console.log('  No services installed.');
        console.log('  Install with: slycode service install');
        return;
    }
    for (const svc of service_common_1.SERVICES) {
        const unitPath = path.join(unitDir, `slycode-${svc}.service`);
        if (!fs.existsSync(unitPath)) {
            console.log(`  slycode-${svc}: not installed`);
            continue;
        }
        try {
            const output = (0, child_process_1.execSync)(`systemctl --user is-active slycode-${svc}`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            console.log(`  slycode-${svc}: ${output}`);
        }
        catch {
            console.log(`  slycode-${svc}: inactive`);
        }
    }
}
async function serviceLinux(action, workspace, config) {
    switch (action) {
        case 'install': return install(workspace, config);
        case 'remove': return remove();
        case 'status': return status();
    }
}
//# sourceMappingURL=service-linux.js.map