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
exports.uninstall = uninstall;
const fs = __importStar(require("fs"));
const readline = __importStar(require("readline"));
const workspace_1 = require("./workspace");
const symlinks_1 = require("../platform/symlinks");
async function confirm(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${question} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}
async function uninstall(_args) {
    const workspace = (0, workspace_1.resolveWorkspace)();
    const stateDir = (0, workspace_1.getStateDir)();
    console.log('SlyCode Uninstall');
    console.log('=================');
    console.log('');
    console.log('This will:');
    console.log('  - Stop any running services');
    console.log('  - Remove system services (if installed)');
    console.log('  - Remove global CLI links (slycode, sly-kanban, sly-messaging, sly-scaffold)');
    console.log(`  - Remove state directory (~/.slycode)`);
    console.log('');
    console.log('Note: ~/.slycode contains the workspace pointer used by global CLI commands.');
    console.log('Removing it means global commands won\'t find your workspace until you');
    console.log('re-run create-slycode or set the SLYCODE_HOME environment variable.');
    console.log('');
    if (workspace) {
        console.log(`Your workspace at ${workspace} will NOT be removed.`);
        console.log('Your skills, commands, kanban data, and other files are preserved.');
    }
    console.log('');
    const ok = await confirm('Continue with uninstall?');
    if (!ok) {
        console.log('Cancelled.');
        return;
    }
    console.log('');
    // 1. Stop services
    try {
        const { stop } = await Promise.resolve().then(() => __importStar(require('./stop')));
        await stop([]);
    }
    catch {
        // May fail if nothing is running
    }
    // 2. Remove system services (not applicable on Windows — services are never installed there)
    if (process.platform !== 'win32') {
        try {
            const { service } = await Promise.resolve().then(() => __importStar(require('./service')));
            await service(['remove']);
        }
        catch {
            // May fail if not installed
        }
    }
    // 3. Remove global CLI links
    try {
        (0, symlinks_1.unlinkClis)();
    }
    catch {
        console.log('  Could not remove CLI links (may not be installed)');
    }
    // 4. Remove state directory
    if (fs.existsSync(stateDir)) {
        fs.rmSync(stateDir, { recursive: true, force: true });
        console.log(`  \u2713 Removed ${stateDir}`);
    }
    console.log('');
    console.log('SlyCode uninstalled.');
    if (workspace) {
        console.log(`Your workspace at ${workspace} is intact.`);
        console.log(`To fully remove, delete the workspace: rm -rf ${workspace}`);
    }
}
//# sourceMappingURL=uninstall.js.map