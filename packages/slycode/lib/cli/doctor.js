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
exports.doctor = doctor;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const child_process_1 = require("child_process");
const workspace_1 = require("./workspace");
function icon(result) {
    switch (result) {
        case 'ok': return '\u2713';
        case 'warn': return '!';
        case 'fail': return '\u2717';
    }
}
function isPortInUse(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(true));
        server.once('listening', () => {
            server.close();
            resolve(false);
        });
        server.listen(port, '127.0.0.1');
    });
}
async function doctor(_args) {
    const checks = [];
    console.log('SlyCode Doctor');
    console.log('==============');
    console.log('');
    // 1. Node.js version
    const [major] = process.versions.node.split('.').map(Number);
    if (major >= 20) {
        checks.push({ name: 'Node.js version', result: 'ok', message: `v${process.versions.node}` });
    }
    else {
        checks.push({
            name: 'Node.js version',
            result: 'fail',
            message: `v${process.versions.node} (requires >= 20.0.0)`,
        });
    }
    // 2. Workspace
    const workspace = (0, workspace_1.resolveWorkspace)();
    if (workspace) {
        checks.push({ name: 'Workspace', result: 'ok', message: workspace });
    }
    else {
        checks.push({
            name: 'Workspace',
            result: 'fail',
            message: 'Not found. Set SLYCODE_HOME or create slycode.config.js',
        });
        // Can't continue many checks without a workspace
        printResults(checks);
        return;
    }
    // 3. Config file
    const configPath = path.join(workspace, 'slycode.config.js');
    if (fs.existsSync(configPath)) {
        try {
            const config = (0, workspace_1.resolveConfig)(workspace);
            checks.push({
                name: 'Config (slycode.config.js)',
                result: 'ok',
                message: `ports: ${config.ports.web}/${config.ports.bridge}/${config.ports.messaging}`,
            });
        }
        catch {
            checks.push({ name: 'Config (slycode.config.js)', result: 'warn', message: 'File exists but could not be loaded' });
        }
    }
    else {
        checks.push({ name: 'Config (slycode.config.js)', result: 'ok', message: 'Not present (using defaults)' });
    }
    const config = (0, workspace_1.resolveConfig)(workspace);
    // 4. .env file
    const envPath = path.join(workspace, '.env');
    if (fs.existsSync(envPath)) {
        checks.push({ name: '.env file', result: 'ok', message: 'Present' });
    }
    else {
        checks.push({ name: '.env file', result: 'warn', message: 'Not found (create from .env.example)' });
    }
    // 5. Port availability
    const ports = [
        { name: 'Web', port: config.ports.web },
        { name: 'Bridge', port: config.ports.bridge },
        { name: 'Messaging', port: config.ports.messaging },
    ];
    for (const p of ports) {
        const inUse = await isPortInUse(p.port);
        if (inUse) {
            // Could be our service running — check state
            const stateFile = path.join((0, workspace_1.getStateDir)(), 'state.json');
            let ours = false;
            if (fs.existsSync(stateFile)) {
                try {
                    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
                    ours = state.services?.some((s) => s.port === p.port);
                }
                catch { /* ignore */ }
            }
            if (ours) {
                checks.push({ name: `Port ${p.port} (${p.name})`, result: 'ok', message: 'In use by SlyCode' });
            }
            else {
                checks.push({ name: `Port ${p.port} (${p.name})`, result: 'warn', message: 'In use by another process' });
            }
        }
        else {
            checks.push({ name: `Port ${p.port} (${p.name})`, result: 'ok', message: 'Available' });
        }
    }
    // 6. Global CLIs
    const cliTools = ['sly-kanban', 'sly-messaging', 'sly-scaffold'];
    for (const tool of cliTools) {
        try {
            (0, child_process_1.execSync)(`command -v ${tool}`, { stdio: 'pipe', windowsHide: true });
            checks.push({ name: tool, result: 'ok', message: 'Found in PATH' });
        }
        catch {
            checks.push({ name: tool, result: 'warn', message: 'Not in PATH (run: slycode service install)' });
        }
    }
    // 7. AI coding agents
    const agents = [
        { name: 'Claude Code', cmd: 'claude --version' },
        { name: 'Codex', cmd: 'codex --version' },
        { name: 'Gemini CLI', cmd: 'gemini --version' },
    ];
    const foundAgents = [];
    for (const agent of agents) {
        try {
            const version = (0, child_process_1.execSync)(`${agent.cmd} 2>/dev/null`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                windowsHide: true,
            }).trim();
            checks.push({ name: agent.name, result: 'ok', message: version });
            foundAgents.push(agent.name);
        }
        catch {
            checks.push({ name: agent.name, result: 'ok', message: 'Not installed' });
        }
    }
    if (foundAgents.length === 0) {
        checks.push({
            name: 'AI coding agents',
            result: 'warn',
            message: 'No coding agents found. Install at least one (claude, codex, or gemini).',
        });
    }
    // 8. Workspace structure
    const expectedDirs = ['.claude/skills', 'data', 'documentation'];
    const missingDirs = expectedDirs.filter(d => !fs.existsSync(path.join(workspace, d)));
    if (missingDirs.length === 0) {
        checks.push({ name: 'Workspace structure', result: 'ok', message: 'All expected directories present' });
    }
    else {
        checks.push({
            name: 'Workspace structure',
            result: 'warn',
            message: `Missing: ${missingDirs.join(', ')}`,
        });
    }
    printResults(checks);
}
function printResults(checks) {
    for (const check of checks) {
        console.log(`  ${icon(check.result)} ${check.name}: ${check.message}`);
    }
    console.log('');
    const fails = checks.filter(c => c.result === 'fail');
    const warns = checks.filter(c => c.result === 'warn');
    const oks = checks.filter(c => c.result === 'ok');
    if (fails.length > 0) {
        console.log(`${oks.length} passed, ${warns.length} warnings, ${fails.length} errors`);
    }
    else if (warns.length > 0) {
        console.log(`${oks.length} passed, ${warns.length} warnings`);
    }
    else {
        console.log(`All ${oks.length} checks passed. SlyCode looks healthy.`);
    }
}
//# sourceMappingURL=doctor.js.map