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
exports.refreshActionUpdates = refreshActionUpdates;
exports.refreshProviders = refreshProviders;
exports.refreshTerminalClasses = refreshTerminalClasses;
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
 * Sync action updates from package templates/updates/actions/ to workspace updates/actions/.
 * Uses content comparison — copies when file content differs or action is new.
 * Removes workspace actions not in the package template (manifest is authoritative).
 */
function refreshActionUpdates(workspace) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    if (!packageDir) {
        return { refreshed: 0, removed: 0, skipped: 0, details: [] };
    }
    const templateActionsDir = path.join(packageDir, 'templates', 'updates', 'actions');
    const workspaceActionsDir = path.join(workspace, 'updates', 'actions');
    if (!fs.existsSync(templateActionsDir)) {
        return { refreshed: 0, removed: 0, skipped: 0, details: [] };
    }
    fs.mkdirSync(workspaceActionsDir, { recursive: true });
    const result = { refreshed: 0, removed: 0, skipped: 0, details: [] };
    const templateActions = fs.readdirSync(templateActionsDir)
        .filter(f => f.endsWith('.md'));
    // Remove workspace actions not in the template
    const templateSet = new Set(templateActions);
    for (const file of fs.readdirSync(workspaceActionsDir)) {
        if (file.endsWith('.md') && !templateSet.has(file)) {
            fs.unlinkSync(path.join(workspaceActionsDir, file));
            result.removed++;
        }
    }
    for (const file of templateActions) {
        const templatePath = path.join(templateActionsDir, file);
        const workspacePath = path.join(workspaceActionsDir, file);
        const name = file.replace(/\.md$/, '');
        const templateContent = fs.readFileSync(templatePath, 'utf-8');
        const workspaceContent = fs.existsSync(workspacePath)
            ? fs.readFileSync(workspacePath, 'utf-8')
            : '';
        if (templateContent !== workspaceContent) {
            fs.copyFileSync(templatePath, workspacePath);
            const templateVersion = parseVersion(templatePath);
            const workspaceVersion = workspaceContent ? parseVersion(workspacePath) : '0.0.0';
            result.refreshed++;
            result.details.push({ name, from: workspaceVersion, to: templateVersion });
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
/**
 * Seed terminal-classes.json from package templates if missing in workspace.
 * This ensures existing installations get the file on first sync/update.
 */
function refreshTerminalClasses(workspace) {
    const workspaceFile = path.join(workspace, 'documentation', 'terminal-classes.json');
    if (fs.existsSync(workspaceFile)) {
        return { seeded: false };
    }
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    if (!packageDir)
        return { seeded: false };
    const templateFile = path.join(packageDir, 'templates', 'terminal-classes.json');
    if (!fs.existsSync(templateFile))
        return { seeded: false };
    fs.mkdirSync(path.join(workspace, 'documentation'), { recursive: true });
    fs.copyFileSync(templateFile, workspaceFile);
    return { seeded: true };
}
async function sync(_args) {
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    console.log('Refreshing updates...');
    console.log(`  Workspace: ${workspace}`);
    console.log('');
    const skillResult = refreshUpdates(workspace);
    if (skillResult.refreshed === 0) {
        console.log('All skill updates are current.');
    }
    else {
        for (const d of skillResult.details) {
            const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
            console.log(`  ✓ ${d.name} (${label})`);
        }
        console.log(`Refreshed ${skillResult.refreshed} skill update(s).`);
    }
    const actionResult = refreshActionUpdates(workspace);
    if (actionResult.refreshed === 0) {
        console.log('All action updates are current.');
    }
    else {
        for (const d of actionResult.details) {
            const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
            console.log(`  ✓ ${d.name} (${label})`);
        }
        console.log(`Refreshed ${actionResult.refreshed} action update(s).`);
    }
    // Seed terminal-classes.json if missing
    const tcResult = refreshTerminalClasses(workspace);
    if (tcResult.seeded) {
        console.log('  ✓ Seeded terminal-classes.json');
    }
}
//# sourceMappingURL=sync.js.map