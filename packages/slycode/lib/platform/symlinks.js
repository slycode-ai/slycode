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
exports.linkClis = linkClis;
exports.unlinkClis = unlinkClis;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const CLI_TOOLS = ['slycode', 'sly-kanban', 'sly-messaging', 'sly-scaffold'];
function getTargetBinDir() {
    if (process.platform === 'win32') {
        // Windows: use a directory in LOCALAPPDATA
        const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
        return path.join(appData, 'SlyCode', 'bin');
    }
    // Unix: ~/.local/bin (XDG standard)
    return path.join(os.homedir(), '.local', 'bin');
}
function resolvePackageBin(workspace, tool) {
    // Prefer the installed package's bin
    const pkgBin = path.join(workspace, 'node_modules', '.bin', tool);
    if (fs.existsSync(pkgBin))
        return pkgBin;
    // Fallback: the bin directory in the slycode package
    const slycodePackageBin = path.join(workspace, 'node_modules', '@slycode', 'slycode', 'bin', `${tool}.js`);
    if (fs.existsSync(slycodePackageBin))
        return slycodePackageBin;
    // Dev fallback
    const devBin = path.join(__dirname, '..', '..', 'bin', `${tool}.js`);
    return devBin;
}
/**
 * Create global CLI symlinks/shims for sly-kanban, sly-messaging, sly-scaffold.
 */
function linkClis(workspace) {
    const binDir = getTargetBinDir();
    if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
    }
    console.log(`Linking CLI tools to ${binDir}...`);
    if (process.platform === 'win32') {
        // Windows: create .cmd shim files
        for (const tool of CLI_TOOLS) {
            const target = resolvePackageBin(workspace, tool);
            const shimPath = path.join(binDir, `${tool}.cmd`);
            const content = `@echo off\r\n"${process.execPath}" "${target}" %*\r\n`;
            fs.writeFileSync(shimPath, content);
            console.log(`  \u2713 ${tool}.cmd`);
        }
        // Check if binDir is in PATH
        const pathEnv = process.env.PATH || '';
        if (!pathEnv.split(';').some(p => p.toLowerCase() === binDir.toLowerCase())) {
            console.log('');
            console.log(`  Add this directory to your PATH to use the CLI tools:`);
            console.log(`  ${binDir}`);
            console.log('');
            console.log('  Run in PowerShell (as administrator):');
            console.log(`  [Environment]::SetEnvironmentVariable("Path", $env:Path + ";${binDir}", "User")`);
        }
    }
    else {
        // Unix: create symlinks
        for (const tool of CLI_TOOLS) {
            const target = resolvePackageBin(workspace, tool);
            const linkPath = path.join(binDir, tool);
            // Remove existing symlink or file
            try {
                const stat = fs.lstatSync(linkPath);
                if (stat)
                    fs.unlinkSync(linkPath);
            }
            catch {
                // Doesn't exist, that's fine
            }
            fs.symlinkSync(target, linkPath);
            // Ensure executable
            try {
                fs.chmodSync(target, 0o755);
            }
            catch {
                // May not be able to chmod if it's in node_modules
            }
            console.log(`  \u2713 ${tool}`);
        }
        // Check if binDir is in PATH
        const pathEnv = process.env.PATH || '';
        if (!pathEnv.split(':').includes(binDir)) {
            console.log('');
            console.log(`  Note: ${binDir} is not in your PATH.`);
            console.log('  Add to your shell profile:');
            console.log(`  export PATH="$PATH:${binDir}"`);
        }
    }
    console.log('');
    console.log('CLI tools linked.');
}
/**
 * Remove global CLI symlinks/shims.
 */
function unlinkClis() {
    const binDir = getTargetBinDir();
    console.log('Removing CLI tool links...');
    for (const tool of CLI_TOOLS) {
        if (process.platform === 'win32') {
            const shimPath = path.join(binDir, `${tool}.cmd`);
            if (fs.existsSync(shimPath)) {
                fs.unlinkSync(shimPath);
                console.log(`  \u2713 Removed ${tool}.cmd`);
            }
        }
        else {
            const linkPath = path.join(binDir, tool);
            try {
                const stat = fs.lstatSync(linkPath);
                if (stat.isSymbolicLink()) {
                    fs.unlinkSync(linkPath);
                    console.log(`  \u2713 Removed ${tool}`);
                }
            }
            catch {
                // Link doesn't exist
            }
        }
    }
}
//# sourceMappingURL=symlinks.js.map