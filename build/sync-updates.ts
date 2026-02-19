#!/usr/bin/env npx tsx

/**
 * Sync store skills + actions → updates folder.
 *
 * Copies manifest skills from store/skills/ to updates/skills/ and
 * manifest actions from store/actions/ to updates/actions/ so the
 * build step (and local dev) always has fresh update content.
 *
 * Usage: npx tsx build/sync-updates.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ROOT = path.resolve(__dirname, '..');

function copyDirRecursive(src: string, dest: string): void {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

interface SyncResult {
  synced: number;
  removed: number;
  total: number;
}

function syncSkills(skillNames: string[], rootDir: string): SyncResult {
  const storeDir = path.join(rootDir, 'store', 'skills');
  const updatesDir = path.join(rootDir, 'updates', 'skills');

  if (!fs.existsSync(storeDir)) {
    console.warn('  ! store/skills/ not found — skipping skill sync');
    return { synced: 0, removed: 0, total: skillNames.length };
  }

  fs.mkdirSync(updatesDir, { recursive: true });

  // Remove non-manifest skills from updates/
  const manifestSet = new Set(skillNames);
  let removed = 0;
  if (fs.existsSync(updatesDir)) {
    for (const entry of fs.readdirSync(updatesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !manifestSet.has(entry.name)) {
        fs.rmSync(path.join(updatesDir, entry.name), { recursive: true, force: true });
        removed++;
      }
    }
  }

  let synced = 0;
  for (const name of skillNames) {
    const src = path.join(storeDir, name);
    if (!fs.existsSync(src)) {
      console.warn(`  ! Skill "${name}" not found in store/skills/`);
      continue;
    }

    const dest = path.join(updatesDir, name);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    copyDirRecursive(src, dest);
    synced++;
  }

  return { synced, removed, total: skillNames.length };
}

function syncActions(actionNames: string[], rootDir: string): SyncResult {
  const storeDir = path.join(rootDir, 'store', 'actions');
  const updatesDir = path.join(rootDir, 'updates', 'actions');

  if (!fs.existsSync(storeDir)) {
    console.warn('  ! store/actions/ not found — skipping action sync');
    return { synced: 0, removed: 0, total: actionNames.length };
  }

  fs.mkdirSync(updatesDir, { recursive: true });

  // Remove non-manifest actions from updates/
  const manifestSet = new Set(actionNames.map(n => `${n}.md`));
  let removed = 0;
  if (fs.existsSync(updatesDir)) {
    for (const entry of fs.readdirSync(updatesDir)) {
      if (entry.endsWith('.md') && !manifestSet.has(entry)) {
        fs.unlinkSync(path.join(updatesDir, entry));
        removed++;
      }
    }
  }

  let synced = 0;
  for (const name of actionNames) {
    const src = path.join(storeDir, `${name}.md`);
    if (!fs.existsSync(src)) {
      console.warn(`  ! Action "${name}" not found in store/actions/`);
      continue;
    }

    const dest = path.join(updatesDir, `${name}.md`);
    fs.copyFileSync(src, dest);
    synced++;
  }

  return { synced, removed, total: actionNames.length };
}

export function syncStoreToUpdates(rootDir: string = ROOT): { skills: SyncResult; actions: SyncResult } {
  const manifest = require(path.join(rootDir, 'build', 'store-manifest.js'));

  const skillResult = syncSkills(manifest.skills || [], rootDir);
  const actionResult = syncActions(manifest.actions || [], rootDir);

  return { skills: skillResult, actions: actionResult };
}

// Run standalone
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('Syncing store → updates...');
  const result = syncStoreToUpdates();

  console.log(`  ✓ Skills: synced ${result.skills.synced}/${result.skills.total}`);
  if (result.skills.removed > 0) {
    console.log(`    Removed ${result.skills.removed} non-manifest skill(s)`);
  }

  console.log(`  ✓ Actions: synced ${result.actions.synced}/${result.actions.total}`);
  if (result.actions.removed > 0) {
    console.log(`    Removed ${result.actions.removed} non-manifest action(s)`);
  }

  // List contents
  const skillsDir = path.join(ROOT, 'updates', 'skills');
  if (fs.existsSync(skillsDir)) {
    const dirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
    console.log(`  Skills in updates: ${dirs.join(', ')}`);
  }

  const actionsDir = path.join(ROOT, 'updates', 'actions');
  if (fs.existsSync(actionsDir)) {
    const files = fs.readdirSync(actionsDir).filter(f => f.endsWith('.md'));
    console.log(`  Actions in updates: ${files.length} files`);
  }
}
