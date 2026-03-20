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
exports.serviceMacos = serviceMacos;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const workspace_1 = require("../cli/workspace");
const SERVICES = ['web', 'bridge', 'messaging'];
function getLaunchAgentsDir() {
    const dir = path.join(os.homedir(), 'Library', 'LaunchAgents');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
function plistPath(service) {
    return path.join(getLaunchAgentsDir(), `com.slycode.${service}.plist`);
}
function resolveEntryPoint(service, workspace) {
    const distPath = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', service, 'index.js');
    if (fs.existsSync(distPath))
        return distPath;
    return path.join(workspace, service, 'dist', 'index.js');
}
function resolveWrapperScript(workspace) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    const wrapperPath = packageDir
        ? path.join(packageDir, 'templates', 'slycode-env-wrapper.sh')
        : path.join(workspace, 'packages', 'slycode', 'templates', 'slycode-env-wrapper.sh');
    return wrapperPath;
}
function generatePlist(service, workspace, config) {
    const nodePath = process.execPath;
    const entryPoint = resolveEntryPoint(service, workspace);
    const wrapperScript = resolveWrapperScript(workspace);
    const label = `com.slycode.${service}`;
    const logDir = path.join(os.homedir(), '.slycode', 'logs');
    const logPath = path.join(logDir, `${service}.log`);
    const bridgeUrl = `http://127.0.0.1:${config.ports.bridge}`;
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }
    let envEntries;
    switch (service) {
        case 'web':
            envEntries = `    <key>PORT</key>
    <string>${config.ports.web}</string>
    <key>BRIDGE_URL</key>
    <string>${bridgeUrl}</string>`;
            break;
        case 'bridge':
            envEntries = `    <key>BRIDGE_PORT</key>
    <string>${config.ports.bridge}</string>`;
            break;
        case 'messaging':
            envEntries = `    <key>MESSAGING_SERVICE_PORT</key>
    <string>${config.ports.messaging}</string>
    <key>BRIDGE_URL</key>
    <string>${bridgeUrl}</string>`;
            break;
        default:
            envEntries = '';
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>WorkingDirectory</key>
  <string>${workspace}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${wrapperScript}</string>
    <string>${nodePath}</string>
    <string>${entryPoint}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key>
    <string>production</string>
    <key>SLYCODE_HOME</key>
    <string>${workspace}</string>
${envEntries}
  </dict>
  <key>KeepAlive</key>
  <true/>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}
async function install(workspace, config) {
    console.log('Installing launchd user agents...');
    // Ensure env wrapper script is executable
    const wrapperScript = resolveWrapperScript(workspace);
    if (!fs.existsSync(wrapperScript)) {
        console.error(`  ✗ env wrapper not found: ${wrapperScript}`);
        console.error('Is slycode installed correctly?');
        return;
    }
    try {
        fs.chmodSync(wrapperScript, 0o755);
    }
    catch { /* ok if already executable */ }
    for (const svc of SERVICES) {
        const plist = generatePlist(svc, workspace, config);
        const dest = plistPath(svc);
        fs.writeFileSync(dest, plist);
        (0, child_process_1.execSync)(`launchctl load "${dest}"`, { stdio: 'inherit' });
        console.log(`  \u2713 Loaded com.slycode.${svc}`);
    }
    console.log('');
    console.log('All launchd agents installed and loaded.');
}
async function remove() {
    console.log('Removing launchd user agents...');
    for (const svc of SERVICES) {
        const dest = plistPath(svc);
        if (fs.existsSync(dest)) {
            try {
                (0, child_process_1.execSync)(`launchctl unload "${dest}"`, { stdio: 'pipe' });
            }
            catch { /* ok */ }
            fs.unlinkSync(dest);
            console.log(`  \u2713 Removed com.slycode.${svc}`);
        }
    }
    console.log('  \u2713 Launchd agents removed');
}
async function status() {
    for (const svc of SERVICES) {
        const dest = plistPath(svc);
        if (!fs.existsSync(dest)) {
            console.log(`  com.slycode.${svc}: not installed`);
            continue;
        }
        try {
            const output = (0, child_process_1.execSync)(`launchctl list com.slycode.${svc} 2>/dev/null`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const pidMatch = output.match(/"PID"\s*=\s*(\d+)/);
            if (pidMatch) {
                console.log(`  com.slycode.${svc}: running (PID ${pidMatch[1]})`);
            }
            else {
                console.log(`  com.slycode.${svc}: loaded but not running`);
            }
        }
        catch {
            console.log(`  com.slycode.${svc}: not loaded`);
        }
    }
}
async function serviceMacos(action, workspace, config) {
    switch (action) {
        case 'install': return install(workspace, config);
        case 'remove': return remove();
        case 'status': return status();
    }
}
//# sourceMappingURL=service-macos.js.map