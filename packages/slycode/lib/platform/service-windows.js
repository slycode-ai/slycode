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
exports.serviceWindows = serviceWindows;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
const SERVICES = ['web', 'bridge', 'messaging'];
function taskName(service) {
    return `SlyCode-${service}`;
}
function resolveEntryPoint(service, workspace) {
    const distPath = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'dist', service, 'index.js');
    if (fs.existsSync(distPath))
        return distPath;
    return path.join(workspace, service, 'dist', 'index.js');
}
function generateTaskXml(service, workspace, config) {
    const nodePath = process.execPath;
    const entryPoint = resolveEntryPoint(service, workspace);
    const bridgeUrl = `http://127.0.0.1:${config.ports.bridge}`;
    let envArgs;
    switch (service) {
        case 'web':
            envArgs = `PORT=${config.ports.web} BRIDGE_URL=${bridgeUrl}`;
            break;
        case 'bridge':
            envArgs = `BRIDGE_PORT=${config.ports.bridge}`;
            break;
        case 'messaging':
            envArgs = `MESSAGING_SERVICE_PORT=${config.ports.messaging} BRIDGE_URL=${bridgeUrl}`;
            break;
        default:
            envArgs = '';
    }
    // Windows Task Scheduler XML
    return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>SlyCode ${service} service</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions>
    <Exec>
      <Command>cmd.exe</Command>
      <Arguments>/c set "${envArgs}" &amp;&amp; set "NODE_ENV=production" &amp;&amp; set "SLYCODE_HOME=${workspace}" &amp;&amp; "${nodePath}" "${entryPoint}"</Arguments>
      <WorkingDirectory>${workspace}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;
}
async function install(workspace, config) {
    console.log('Installing Windows Task Scheduler tasks...');
    const tempDir = os.tmpdir();
    for (const svc of SERVICES) {
        const xml = generateTaskXml(svc, workspace, config);
        const xmlPath = path.join(tempDir, `slycode-${svc}.xml`);
        fs.writeFileSync(xmlPath, xml, { encoding: 'utf16le' });
        try {
            (0, child_process_1.execSync)(`schtasks /Create /TN "${taskName(svc)}" /XML "${xmlPath}" /F`, {
                stdio: 'pipe',
            });
            console.log(`  \u2713 ${taskName(svc)} installed`);
        }
        catch (err) {
            console.error(`  \u2717 Failed to install ${taskName(svc)}: ${err}`);
        }
        // Clean up temp XML
        fs.unlinkSync(xmlPath);
    }
    // Start tasks
    for (const svc of SERVICES) {
        try {
            (0, child_process_1.execSync)(`schtasks /Run /TN "${taskName(svc)}"`, { stdio: 'pipe' });
            console.log(`  \u2713 ${taskName(svc)} started`);
        }
        catch {
            console.warn(`  ! ${taskName(svc)} could not be started`);
        }
    }
    console.log('');
    console.log('Windows tasks installed.');
}
async function remove() {
    console.log('Removing Windows Task Scheduler tasks...');
    for (const svc of SERVICES) {
        try {
            (0, child_process_1.execSync)(`schtasks /Delete /TN "${taskName(svc)}" /F`, { stdio: 'pipe' });
            console.log(`  \u2713 ${taskName(svc)} removed`);
        }
        catch {
            console.log(`  ${taskName(svc)} was not installed`);
        }
    }
}
async function status() {
    for (const svc of SERVICES) {
        try {
            const output = (0, child_process_1.execSync)(`schtasks /Query /TN "${taskName(svc)}" /FO CSV /NH`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const fields = output.trim().split(',').map(f => f.replace(/"/g, ''));
            const state = fields[2] || 'Unknown';
            console.log(`  ${taskName(svc)}: ${state}`);
        }
        catch {
            console.log(`  ${taskName(svc)}: not installed`);
        }
    }
}
async function serviceWindows(action, workspace, config) {
    switch (action) {
        case 'install': return install(workspace, config);
        case 'remove': return remove();
        case 'status': return status();
    }
}
//# sourceMappingURL=service-windows.js.map