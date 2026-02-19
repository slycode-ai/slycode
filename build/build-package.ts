#!/usr/bin/env npx ts-node

/**
 * Build script for the slycode npm package.
 *
 * Builds all services, copies artifacts to packages/slycode/dist/,
 * and prepares templates for distribution.
 *
 * Usage: npx ts-node build/build-package.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { syncStoreToUpdates } from './sync-updates';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ROOT = path.resolve(__dirname, '..');
const PKG_DIR = path.join(ROOT, 'packages', 'slycode');
const DIST_DIR = path.join(PKG_DIR, 'dist');
const TEMPLATES_DIR = path.join(PKG_DIR, 'templates');
const TUTORIAL_TEMPLATE_DIR = path.join(TEMPLATES_DIR, 'tutorial-project');

let preservedTutorialTemplateDir: string | null = null;

function run(cmd: string, cwd: string, label: string): void {
  console.log(`  Building ${label}...`);
  try {
    execSync(cmd, { cwd, stdio: 'pipe' });
    console.log(`  \u2713 ${label}`);
  } catch (err) {
    console.error(`  \u2717 ${label} failed`);
    throw err;
  }
}

function copyDirRecursive(src: string, dest: string, opts?: { includeAll?: boolean }): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (!opts?.includeAll) {
        if (entry.name === '.next' || entry.name === 'node_modules') continue;
      }
      copyDirRecursive(srcPath, destPath, opts);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function clean(): void {
  console.log('Cleaning previous build...');

  // Preserve tutorial template source before templates/ is wiped.
  if (fs.existsSync(TUTORIAL_TEMPLATE_DIR)) {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slycode-tutorial-template-'));
    preservedTutorialTemplateDir = path.join(tmpRoot, 'tutorial-project');
    copyDirRecursive(TUTORIAL_TEMPLATE_DIR, preservedTutorialTemplateDir, { includeAll: true });
  } else {
    preservedTutorialTemplateDir = null;
  }

  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(TEMPLATES_DIR)) {
    fs.rmSync(TEMPLATES_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.mkdirSync(TEMPLATES_DIR, { recursive: true });
}

function buildWeb(): void {
  run('npm run build', path.join(ROOT, 'web'), 'web (Next.js standalone)');

  // Copy standalone output
  const standaloneDir = path.join(ROOT, 'web', '.next', 'standalone');
  const staticDir = path.join(ROOT, 'web', '.next', 'static');
  const destDir = path.join(DIST_DIR, 'web');

  if (fs.existsSync(standaloneDir)) {
    // Standalone output is self-contained — include node_modules and .next
    copyDirRecursive(standaloneDir, destDir, { includeAll: true });
    // Copy static assets
    const destStatic = path.join(destDir, '.next', 'static');
    if (fs.existsSync(staticDir)) {
      copyDirRecursive(staticDir, destStatic);
    }
    // The standalone server entry is at web/server.js (relative to standalone)
    // Copy the public directory if it exists
    const publicDir = path.join(ROOT, 'web', 'public');
    if (fs.existsSync(publicDir)) {
      copyDirRecursive(publicDir, path.join(destDir, 'public'));
    }
  } else {
    console.warn('  ! Next.js standalone output not found.');
    console.warn('    Ensure next.config.ts has output: "standalone"');
  }
}

function buildBridge(): void {
  run('npm run build', path.join(ROOT, 'bridge'), 'bridge');

  const destDir = path.join(DIST_DIR, 'bridge');
  fs.mkdirSync(destDir, { recursive: true });

  // Copy compiled JS
  const bridgeDist = path.join(ROOT, 'bridge', 'dist');
  if (fs.existsSync(bridgeDist)) {
    copyDirRecursive(bridgeDist, destDir);
  }
}

function buildMessaging(): void {
  run('npm run build', path.join(ROOT, 'messaging'), 'messaging');

  const destDir = path.join(DIST_DIR, 'messaging');
  fs.mkdirSync(destDir, { recursive: true });

  const messagingDist = path.join(ROOT, 'messaging', 'dist');
  if (fs.existsSync(messagingDist)) {
    copyDirRecursive(messagingDist, destDir);
  }
}

function buildCli(): void {
  run('npm run build', PKG_DIR, 'slycode CLI');
}

function buildCreateSlycode(): void {
  const createDir = path.join(ROOT, 'packages', 'create-slycode');
  const nodeModules = path.join(createDir, 'node_modules');

  // Symlink node_modules from slycode for build (typescript + @types/node)
  // This avoids needing npm install (which fails because slycode isn't published yet)
  if (!fs.existsSync(nodeModules)) {
    fs.symlinkSync(path.join(PKG_DIR, 'node_modules'), nodeModules);
  }

  try {
    run('npm run build', createDir, 'create-slycode');
  } finally {
    // Clean up symlink so it doesn't get committed
    try {
      const stat = fs.lstatSync(nodeModules);
      if (stat.isSymbolicLink()) fs.unlinkSync(nodeModules);
    } catch { /* ok */ }
  }
}

function copyStoreSkills(): void {
  // Read the curated skill list from store-manifest.js
  const manifest = require(path.join(ROOT, 'build', 'store-manifest.js'));
  const skillNames: string[] = manifest.skills;

  console.log(`  Packaging ${skillNames.length} store skills...`);

  // Copy curated skills from flat canonical store/skills/
  const srcDir = path.join(ROOT, 'store', 'skills');
  const destDir = path.join(TEMPLATES_DIR, 'store', 'skills');

  if (!fs.existsSync(srcDir)) {
    console.warn('  ! store/skills/ not found — skipping');
    return;
  }

  let count = 0;
  for (const skillName of skillNames) {
    const skillSrc = path.join(srcDir, skillName);
    if (fs.existsSync(skillSrc)) {
      copyDirRecursive(skillSrc, path.join(destDir, skillName));
      count++;
    } else {
      console.warn(`  ! Skill "${skillName}" not found in store/skills/`);
    }
  }
  console.log(`  \u2713 store/skills/ (${count}/${skillNames.length} skills)`);
}

function copyStoreActions(): void {
  const manifest = require(path.join(ROOT, 'build', 'store-manifest.js'));
  const actionNames: string[] = manifest.actions;

  const srcDir = path.join(ROOT, 'store', 'actions');
  const destDir = path.join(TEMPLATES_DIR, 'store', 'actions');

  if (!fs.existsSync(srcDir)) {
    console.warn('  ! store/actions/ not found — skipping');
    return;
  }

  fs.mkdirSync(destDir, { recursive: true });

  let count = 0;
  for (const name of actionNames) {
    const src = path.join(srcDir, `${name}.md`);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, `${name}.md`));
      count++;
    } else {
      console.warn(`  ! Action "${name}" not found in store/actions/`);
    }
  }
  console.log(`  \u2713 store/actions/ (${count}/${actionNames.length} actions)`);
}

function copyTemplates(): void {
  console.log('  Copying templates...');

  // Store skills (curated subset from store-manifest.js)
  copyStoreSkills();

  // Store actions (curated subset from store-manifest.js)
  copyStoreActions();

  // Tutorial project template (full standalone project, includes dot-directories)
  if (preservedTutorialTemplateDir && fs.existsSync(preservedTutorialTemplateDir)) {
    copyDirRecursive(preservedTutorialTemplateDir, TUTORIAL_TEMPLATE_DIR, { includeAll: true });
    console.log('  \u2713 tutorial-project');
  } else {
    console.warn('  ! tutorial-project not found — skipping');
  }

  // Updates folder (flat canonical updates/skills/ → templates/updates/skills/)
  const updatesSkillsSrc = path.join(ROOT, 'updates', 'skills');
  if (fs.existsSync(updatesSkillsSrc)) {
    const updatesSkillsDest = path.join(TEMPLATES_DIR, 'updates', 'skills');
    copyDirRecursive(updatesSkillsSrc, updatesSkillsDest);
    const updateCount = fs.readdirSync(updatesSkillsSrc, { withFileTypes: true })
      .filter(e => e.isDirectory()).length;
    console.log(`  \u2713 updates/skills/ (${updateCount} skills)`);
  } else {
    console.warn('  ! updates/skills/ not found — skipping');
  }

  // Updates folder (updates/actions/ → templates/updates/actions/)
  const updatesActionsSrc = path.join(ROOT, 'updates', 'actions');
  if (fs.existsSync(updatesActionsSrc)) {
    const updatesActionsDest = path.join(TEMPLATES_DIR, 'updates', 'actions');
    copyDirRecursive(updatesActionsSrc, updatesActionsDest);
    const actionCount = fs.readdirSync(updatesActionsSrc).filter(f => f.endsWith('.md')).length;
    console.log(`  \u2713 updates/actions/ (${actionCount} actions)`);
  } else {
    console.warn('  ! updates/actions/ not found — skipping');
  }

  // Data templates — sourced from scaffold-templates/, NOT data/.
  // The scaffold-templates/ versions are the blessed defaults for new workspaces.
  // Your working data/ copies may have local changes you don't want to propagate.
  // To update templates: manually copy data/*.json → data/scaffold-templates/*.json
  const dataTemplates = [
    { src: 'data/commands.json', dest: 'commands.json' },
    { src: 'data/scaffold-templates/providers.json', dest: 'providers.json' },
  ];

  for (const t of dataTemplates) {
    const srcPath = path.join(ROOT, t.src);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(TEMPLATES_DIR, t.dest));
    }
  }

  // Kanban seed (empty/minimal template)
  const kanbanSeed = {
    schemaVersion: 1,
    cards: [],
    lastUpdated: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(TEMPLATES_DIR, 'kanban-seed.json'),
    JSON.stringify(kanbanSeed, null, 2) + '\n'
  );

  // Release CLAUDE.md
  const releaseMd = path.join(ROOT, 'CLAUDE.release.md');
  if (fs.existsSync(releaseMd)) {
    fs.copyFileSync(releaseMd, path.join(TEMPLATES_DIR, 'CLAUDE.md'));
    console.log('  \u2713 Release CLAUDE.md');
  } else {
    console.warn('  ! CLAUDE.release.md not found — skipping');
  }

  // Scripts (kanban.js, scaffold.js)
  const scriptsDir = path.join(DIST_DIR, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptsToCopy = ['kanban.js', 'scaffold.js'];
  for (const script of scriptsToCopy) {
    const srcPath = path.join(ROOT, 'scripts', script);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, path.join(scriptsDir, script));
    }
  }
  console.log('  \u2713 Scripts');

  // Scaffold templates (used by scaffold.js at runtime)
  const scaffoldTemplatesSrc = path.join(ROOT, 'data', 'scaffold-templates');
  if (fs.existsSync(scaffoldTemplatesSrc)) {
    const scaffoldTemplatesDest = path.join(DIST_DIR, 'data', 'scaffold-templates');
    copyDirRecursive(scaffoldTemplatesSrc, scaffoldTemplatesDest);
    console.log('  \u2713 Scaffold templates');
  } else {
    console.warn('  ! data/scaffold-templates/ not found — skipping');
  }

  // Copy manifest-filtered store to dist/ for runtime access
  // IMPORTANT: Only ship skills/actions listed in store-manifest.js — unmanifested
  // skills are internal-only and must never reach the published package.
  const storeSrc = path.join(ROOT, 'store');
  if (fs.existsSync(storeSrc)) {
    const storeDest = path.join(DIST_DIR, 'store');
    const storeManifest = require(path.join(ROOT, 'build', 'store-manifest.js'));

    // Skills — filtered by manifest
    const skillsSrc = path.join(storeSrc, 'skills');
    const skillsDest = path.join(storeDest, 'skills');
    if (fs.existsSync(skillsSrc)) {
      let skillCount = 0;
      for (const name of storeManifest.skills) {
        const src = path.join(skillsSrc, name);
        if (fs.existsSync(src)) {
          copyDirRecursive(src, path.join(skillsDest, name));
          skillCount++;
        }
      }
      console.log(`  \u2713 dist/store/skills/ (${skillCount}/${storeManifest.skills.length})`);
    }

    // Actions — filtered by manifest
    const actionsSrc = path.join(storeSrc, 'actions');
    const actionsDest = path.join(storeDest, 'actions');
    if (fs.existsSync(actionsSrc)) {
      fs.mkdirSync(actionsDest, { recursive: true });
      let actionCount = 0;
      for (const name of storeManifest.actions) {
        const src = path.join(actionsSrc, `${name}.md`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(actionsDest, `${name}.md`));
          actionCount++;
        }
      }
      console.log(`  \u2713 dist/store/actions/ (${actionCount}/${storeManifest.actions.length})`);
    }

    // Agents — filtered by manifest
    const agentsSrc = path.join(storeSrc, 'agents');
    const agentsDest = path.join(storeDest, 'agents');
    const agentManifest: string[] = storeManifest.agents || [];
    if (fs.existsSync(agentsSrc) && agentManifest.length > 0) {
      fs.mkdirSync(agentsDest, { recursive: true });
      let agentCount = 0;
      for (const name of agentManifest) {
        const src = path.join(agentsSrc, `${name}.md`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(agentsDest, `${name}.md`));
          agentCount++;
        }
      }
      console.log(`  \u2713 dist/store/agents/ (${agentCount}/${agentManifest.length})`);
    }

    // MCP — filtered by manifest
    const mcpSrc = path.join(storeSrc, 'mcp');
    const mcpDest = path.join(storeDest, 'mcp');
    const mcpManifest: string[] = storeManifest.mcp || [];
    if (fs.existsSync(mcpSrc) && mcpManifest.length > 0) {
      fs.mkdirSync(mcpDest, { recursive: true });
      let mcpCount = 0;
      for (const name of mcpManifest) {
        const src = path.join(mcpSrc, `${name}.json`);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, path.join(mcpDest, `${name}.json`));
          mcpCount++;
        }
      }
      console.log(`  \u2713 dist/store/mcp/ (${mcpCount}/${mcpManifest.length})`);
    }
  }

  console.log('  \u2713 Data templates');
}

async function main(): Promise<void> {
  console.log('Building SlyCode npm package');
  console.log('============================');
  console.log('');

  clean();

  console.log('Building services:');
  buildCli();
  buildCreateSlycode();
  buildBridge();
  buildMessaging();
  buildWeb();

  console.log('');
  console.log('Syncing store → updates:');
  const syncResult = syncStoreToUpdates(ROOT);
  console.log(`  ✓ Skills: synced ${syncResult.skills.synced}/${syncResult.skills.total}`);
  console.log(`  ✓ Actions: synced ${syncResult.actions.synced}/${syncResult.actions.total}`);

  console.log('');
  console.log('Preparing templates:');
  copyTemplates();

  console.log('');
  console.log('Build complete!');
  console.log('');
  console.log('Next steps:');
  console.log('  cd packages/slycode && npm publish');
  console.log('  cd packages/create-slycode && npm publish');
}

main().catch((err) => {
  console.error('Build failed:', err);
  process.exit(1);
});
