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
exports.refreshUpdates = refreshUpdates;
exports.refreshProviders = refreshProviders;
exports.sync = sync;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const workspace_1 = require("./workspace");
function parseVersion(skillMdPath) {
    if (!fs.existsSync(skillMdPath))
        return '0.0.0';
    const content = fs.readFileSync(skillMdPath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
        const vMatch = fmMatch[1].match(/version:\s*(.+)/);
        if (vMatch)
            return vMatch[1].trim();
    }
    return '0.0.0';
}
function copyDirRecursive(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        }
        else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}
/**
 * Compare versions in package templates/updates/skills/ vs workspace updates/skills/.
 * Copy when versions differ or skill is missing.
 */
function refreshUpdates(workspace) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    if (!packageDir) {
        return { refreshed: 0, removed: 0, skipped: 0, details: [] };
    }
    const templateUpdatesDir = path.join(packageDir, 'templates', 'updates', 'skills');
    const workspaceUpdatesDir = path.join(workspace, 'updates', 'skills');
    if (!fs.existsSync(templateUpdatesDir)) {
        return { refreshed: 0, removed: 0, skipped: 0, details: [] };
    }
    fs.mkdirSync(workspaceUpdatesDir, { recursive: true });
    const result = { refreshed: 0, removed: 0, skipped: 0, details: [] };
    const templateSkills = fs.readdirSync(templateUpdatesDir, { withFileTypes: true })
        .filter(e => e.isDirectory());
    // Remove workspace skills not in the template (manifest is absolute)
    const templateSet = new Set(templateSkills.map(e => e.name));
    for (const entry of fs.readdirSync(workspaceUpdatesDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !templateSet.has(entry.name)) {
            fs.rmSync(path.join(workspaceUpdatesDir, entry.name), { recursive: true, force: true });
            result.removed++;
        }
    }
    for (const entry of templateSkills) {
        const templateSkillDir = path.join(templateUpdatesDir, entry.name);
        const workspaceSkillDir = path.join(workspaceUpdatesDir, entry.name);
        const templateVersion = parseVersion(path.join(templateSkillDir, 'SKILL.md'));
        const workspaceVersion = fs.existsSync(workspaceSkillDir)
            ? parseVersion(path.join(workspaceSkillDir, 'SKILL.md'))
            : '0.0.0';
        if (templateVersion !== workspaceVersion) {
            // Full-replace
            if (fs.existsSync(workspaceSkillDir)) {
                fs.rmSync(workspaceSkillDir, { recursive: true, force: true });
            }
            copyDirRecursive(templateSkillDir, workspaceSkillDir);
            result.refreshed++;
            result.details.push({ name: entry.name, from: workspaceVersion, to: templateVersion });
        }
        else {
            result.skipped++;
        }
    }
    return result;
}
/**
 * Replace the providers block in workspace providers.json with the template version.
 * Preserves the defaults block (user preferences).
 */
function refreshProviders(workspace) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    if (!packageDir)
        return { updated: false };
    const templatePath = path.join(packageDir, 'templates', 'providers.json');
    const workspacePath = path.join(workspace, 'data', 'providers.json');
    if (!fs.existsSync(templatePath) || !fs.existsSync(workspacePath)) {
        return { updated: false };
    }
    try {
        const template = JSON.parse(fs.readFileSync(templatePath, 'utf-8'));
        const current = JSON.parse(fs.readFileSync(workspacePath, 'utf-8'));
        const merged = {
            ...current,
            schemaVersion: template.schemaVersion,
            providers: template.providers,
        };
        if (JSON.stringify(current) === JSON.stringify(merged)) {
            return { updated: false };
        }
        fs.writeFileSync(workspacePath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
        return { updated: true };
    }
    catch {
        return { updated: false };
    }
}
async function sync(_args) {
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    console.log('Refreshing skill updates...');
    console.log(`  Workspace: ${workspace}`);
    console.log('');
    const result = refreshUpdates(workspace);
    if (result.refreshed === 0) {
        console.log('All skill updates are current.');
    }
    else {
        for (const d of result.details) {
            const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
            console.log(`  ✓ ${d.name} (${label})`);
        }
        console.log('');
        console.log(`Refreshed ${result.refreshed} skill update(s).`);
    }
}
//# sourceMappingURL=sync.js.map