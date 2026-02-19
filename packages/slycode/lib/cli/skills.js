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
exports.skills = skills;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const readline = __importStar(require("readline"));
const workspace_1 = require("./workspace");
const USAGE = `
Usage: slycode skills <action>

Actions:
  list           List installed and available skills
  check          Check for new or updated skills
  add <name>     Add a skill to your workspace (--all for all new skills)
  reset <name>   Reset a skill to the upstream version (overwrites customizations)
`.trim();
function parseSkillMeta(skillDir) {
    const skillFile = path.join(skillDir, 'SKILL.md');
    if (!fs.existsSync(skillFile))
        return null;
    const content = fs.readFileSync(skillFile, 'utf-8');
    const name = path.basename(skillDir);
    // Parse frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let version = '0.0.0';
    let updated = 'unknown';
    if (fmMatch) {
        const fm = fmMatch[1];
        const vMatch = fm.match(/version:\s*(.+)/);
        const uMatch = fm.match(/updated:\s*(.+)/);
        if (vMatch)
            version = vMatch[1].trim();
        if (uMatch)
            updated = uMatch[1].trim();
    }
    return { name, version, updated };
}
function getInstalledSkills(workspace) {
    const skillsDir = path.join(workspace, '.claude', 'skills');
    const map = new Map();
    if (!fs.existsSync(skillsDir))
        return map;
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const meta = parseSkillMeta(path.join(skillsDir, entry.name));
        if (meta)
            map.set(meta.name, meta);
    }
    return map;
}
function getTemplateSkills(workspace) {
    const map = new Map();
    // Check the workspace store (store/skills/) as the upstream source
    const storeDir = path.join(workspace, 'store', 'skills');
    if (fs.existsSync(storeDir)) {
        for (const entry of fs.readdirSync(storeDir, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const meta = parseSkillMeta(path.join(storeDir, entry.name));
            if (meta)
                map.set(meta.name, meta);
        }
    }
    // Fallback: check the package templates (for cases where store isn't populated)
    if (map.size === 0) {
        const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
        if (packageDir) {
            const templatesDir = path.join(packageDir, 'templates', 'store', 'skills');
            if (fs.existsSync(templatesDir)) {
                for (const entry of fs.readdirSync(templatesDir, { withFileTypes: true })) {
                    if (!entry.isDirectory())
                        continue;
                    const meta = parseSkillMeta(path.join(templatesDir, entry.name));
                    if (meta)
                        map.set(meta.name, meta);
                }
            }
        }
    }
    return map;
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
async function confirm(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(`${question} [y/N] `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y');
        });
    });
}
async function listSkills(workspace) {
    const installed = getInstalledSkills(workspace);
    const templates = getTemplateSkills(workspace);
    // Merge all skill names
    const allNames = new Set([...installed.keys(), ...templates.keys()]);
    if (allNames.size === 0) {
        console.log('No skills found.');
        return;
    }
    console.log('Skills:');
    console.log('');
    // Header
    const nameWidth = 25;
    const verWidth = 12;
    console.log(`  ${'Name'.padEnd(nameWidth)} ${'Installed'.padEnd(verWidth)} ${'Available'.padEnd(verWidth)} Status`);
    console.log(`  ${'─'.repeat(nameWidth)} ${'─'.repeat(verWidth)} ${'─'.repeat(verWidth)} ──────────────`);
    for (const name of [...allNames].sort()) {
        const inst = installed.get(name);
        const tmpl = templates.get(name);
        const instVer = inst?.version || '—';
        const tmplVer = tmpl?.version || '—';
        let status;
        if (inst && !tmpl) {
            status = 'custom';
        }
        else if (!inst && tmpl) {
            status = 'new (available)';
        }
        else if (inst && tmpl && inst.version === tmpl.version) {
            status = 'up to date';
        }
        else if (inst && tmpl) {
            status = 'update available';
        }
        else {
            status = 'unknown';
        }
        console.log(`  ${name.padEnd(nameWidth)} ${instVer.padEnd(verWidth)} ${tmplVer.padEnd(verWidth)} ${status}`);
    }
}
async function checkSkills(workspace) {
    const installed = getInstalledSkills(workspace);
    const templates = getTemplateSkills(workspace);
    let newCount = 0;
    let updateCount = 0;
    for (const [name, tmpl] of templates) {
        const inst = installed.get(name);
        if (!inst) {
            newCount++;
        }
        else if (inst.version !== tmpl.version) {
            updateCount++;
        }
    }
    if (newCount === 0 && updateCount === 0) {
        console.log('All skills are up to date.');
    }
    else {
        if (newCount > 0) {
            console.log(`${newCount} new skill(s) available.`);
        }
        if (updateCount > 0) {
            console.log(`${updateCount} skill(s) have updates available.`);
        }
        console.log('');
        console.log('Run "slycode skills list" for details.');
        console.log('Run "slycode skills add <name>" to add a new skill.');
        console.log('Run "slycode skills reset <name>" to update an existing skill.');
    }
}
async function addSkill(workspace, name, all) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    if (!packageDir) {
        console.error('Could not find slycode package directory.');
        process.exit(1);
    }
    const templatesDir = path.join(packageDir, 'templates', 'store', 'skills');
    const skillsDir = path.join(workspace, '.claude', 'skills');
    if (all) {
        const templates = getTemplateSkills(workspace);
        const installed = getInstalledSkills(workspace);
        let added = 0;
        for (const [skillName] of templates) {
            if (!installed.has(skillName)) {
                const src = path.join(templatesDir, skillName);
                const dest = path.join(skillsDir, skillName);
                copyDirRecursive(src, dest);
                console.log(`  \u2713 Added ${skillName}`);
                added++;
            }
        }
        if (added === 0) {
            console.log('All available skills are already installed.');
        }
        else {
            console.log(`\n${added} skill(s) added.`);
        }
        return;
    }
    const src = path.join(templatesDir, name);
    if (!fs.existsSync(src)) {
        console.error(`Skill "${name}" not found in available templates.`);
        console.error('Run "slycode skills list" to see available skills.');
        process.exit(1);
    }
    const dest = path.join(skillsDir, name);
    if (fs.existsSync(dest)) {
        console.error(`Skill "${name}" is already installed.`);
        console.error('Use "slycode skills reset" to overwrite with the upstream version.');
        process.exit(1);
    }
    copyDirRecursive(src, dest);
    console.log(`\u2713 Added skill: ${name}`);
}
async function resetSkill(workspace, name) {
    const packageDir = (0, workspace_1.resolvePackageDir)(workspace);
    if (!packageDir) {
        console.error('Could not find slycode package directory.');
        process.exit(1);
    }
    const templatesDir = path.join(packageDir, 'templates', 'store', 'skills');
    const skillsDir = path.join(workspace, '.claude', 'skills');
    const src = path.join(templatesDir, name);
    if (!fs.existsSync(src)) {
        console.error(`Skill "${name}" not found in available templates.`);
        process.exit(1);
    }
    const dest = path.join(skillsDir, name);
    if (fs.existsSync(dest)) {
        const ok = await confirm(`This will overwrite your customized "${name}" skill with the upstream version. Continue?`);
        if (!ok) {
            console.log('Cancelled.');
            return;
        }
        // Remove existing
        fs.rmSync(dest, { recursive: true, force: true });
    }
    copyDirRecursive(src, dest);
    console.log(`\u2713 Reset skill: ${name}`);
}
async function skills(args) {
    const action = args[0];
    if (!action || action === '--help' || action === '-h') {
        console.log(USAGE);
        return;
    }
    const workspace = (0, workspace_1.resolveWorkspaceOrExit)();
    switch (action) {
        case 'list':
            await listSkills(workspace);
            break;
        case 'check':
            await checkSkills(workspace);
            break;
        case 'add': {
            const name = args[1];
            if (!name && !args.includes('--all')) {
                console.error('Usage: slycode skills add <name> [--all]');
                process.exit(1);
            }
            await addSkill(workspace, name, args.includes('--all'));
            break;
        }
        case 'reset': {
            const name = args[1];
            if (!name) {
                console.error('Usage: slycode skills reset <name>');
                process.exit(1);
            }
            await resetSkill(workspace, name);
            break;
        }
        default:
            console.error(`Unknown action: ${action}`);
            console.error('Run "slycode skills --help" for usage.');
            process.exit(1);
    }
}
//# sourceMappingURL=skills.js.map