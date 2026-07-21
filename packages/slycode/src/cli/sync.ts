import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { resolveWorkspaceOrExit, resolvePackageDir } from './workspace';

export interface RefreshResult {
  refreshed: number;
  removed: number;
  skipped: number;
  details: { name: string; from: string; to: string }[];
}

function parseVersion(skillMdPath: string): string {
  if (!fs.existsSync(skillMdPath)) return '0.0.0';

  const content = fs.readFileSync(skillMdPath, 'utf-8');
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const vMatch = fmMatch[1].match(/version:\s*(.+)/);
    if (vMatch) return vMatch[1].trim();
  }
  return '0.0.0';
}

/**
 * Whole-directory content digest: sorted '/'-normalized relative paths +
 * per-file sha256 (12 hex) rolled into one sha256, truncated to 12 hex.
 * Detects changes to ANY file in a skill, not just SKILL.md.
 *
 * LOCKSTEP MIRROR of web/src/lib/skill-dir-digest.ts:hashSkillDir (the CLI
 * cannot import from web/). Keep walk order, separator normalization, and
 * roll format identical or the two detection stages will disagree.
 * Exported for the parity test in web/src/lib/skill-dir-digest.test.ts.
 */
export function hashSkillDirDigest(dir: string): string {
  const relPaths: string[] = [];

  function walk(current: string, prefix: string): void {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      // Normalize to '/' so Windows and POSIX produce identical digests.
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), rel);
      } else {
        relPaths.push(rel);
      }
    }
  }

  walk(dir, '');
  relPaths.sort();

  const roll = crypto.createHash('sha256');
  roll.update('');
  for (const rel of relPaths) {
    const buf = fs.readFileSync(path.join(dir, ...rel.split('/')));
    const fileHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
    roll.update(`${rel}\n${fileHash}\n`);
  }
  return roll.digest('hex').slice(0, 12);
}

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

/**
 * Compare package templates/updates/skills/ vs workspace updates/skills/ by
 * whole-directory content digest. Copy when ANY file differs or skill is
 * missing — a reference/script fix without a version bump still propagates.
 */
export function refreshUpdates(workspace: string): RefreshResult {
  const packageDir = resolvePackageDir(workspace);
  if (!packageDir) {
    return { refreshed: 0, removed: 0, skipped: 0, details: [] };
  }

  const templateUpdatesDir = path.join(packageDir, 'templates', 'updates', 'skills');
  const workspaceUpdatesDir = path.join(workspace, 'updates', 'skills');

  if (!fs.existsSync(templateUpdatesDir)) {
    return { refreshed: 0, removed: 0, skipped: 0, details: [] };
  }

  fs.mkdirSync(workspaceUpdatesDir, { recursive: true });

  const result: RefreshResult = { refreshed: 0, removed: 0, skipped: 0, details: [] };

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

    const templateDigest = hashSkillDirDigest(templateSkillDir);
    const workspaceDigest = fs.existsSync(workspaceSkillDir)
      ? hashSkillDirDigest(workspaceSkillDir)
      : null;

    if (templateDigest !== workspaceDigest) {
      // Versions are display-only in the result details
      const templateVersion = parseVersion(path.join(templateSkillDir, 'SKILL.md'));
      const workspaceVersion = fs.existsSync(workspaceSkillDir)
        ? parseVersion(path.join(workspaceSkillDir, 'SKILL.md'))
        : '0.0.0';
      // Full-replace
      if (fs.existsSync(workspaceSkillDir)) {
        fs.rmSync(workspaceSkillDir, { recursive: true, force: true });
      }
      copyDirRecursive(templateSkillDir, workspaceSkillDir);
      result.refreshed++;
      result.details.push({ name: entry.name, from: workspaceVersion, to: templateVersion });
    } else {
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
export function refreshActionUpdates(workspace: string): RefreshResult {
  const packageDir = resolvePackageDir(workspace);
  if (!packageDir) {
    return { refreshed: 0, removed: 0, skipped: 0, details: [] };
  }

  const templateActionsDir = path.join(packageDir, 'templates', 'updates', 'actions');
  const workspaceActionsDir = path.join(workspace, 'updates', 'actions');

  if (!fs.existsSync(templateActionsDir)) {
    return { refreshed: 0, removed: 0, skipped: 0, details: [] };
  }

  fs.mkdirSync(workspaceActionsDir, { recursive: true });

  const result: RefreshResult = { refreshed: 0, removed: 0, skipped: 0, details: [] };

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
    } else {
      result.skipped++;
    }
  }

  return result;
}

/**
 * Replace the providers block in workspace providers.json with the template version.
 * Preserves the defaults block (user preferences).
 *
 * INVARIANT (feature 073): `defaults` is user config — the single global
 * default provider/model (including free-text custom model ids) lives there.
 * It MUST survive the providers-block replacement; never extend this merge
 * to overwrite `defaults`.
 */
export function refreshProviders(workspace: string): { updated: boolean } {
  const packageDir = resolvePackageDir(workspace);
  if (!packageDir) return { updated: false };

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
  } catch {
    return { updated: false };
  }
}

/**
 * Seed terminal-classes.json from package templates if missing in workspace.
 * This ensures existing installations get the file on first sync/update.
 */
export function refreshTerminalClasses(workspace: string): { seeded: boolean } {
  const workspaceFile = path.join(workspace, 'documentation', 'terminal-classes.json');
  if (fs.existsSync(workspaceFile)) {
    return { seeded: false };
  }

  const packageDir = resolvePackageDir(workspace);
  if (!packageDir) return { seeded: false };

  const templateFile = path.join(packageDir, 'templates', 'terminal-classes.json');
  if (!fs.existsSync(templateFile)) return { seeded: false };

  fs.mkdirSync(path.join(workspace, 'documentation'), { recursive: true });
  fs.copyFileSync(templateFile, workspaceFile);
  return { seeded: true };
}

export async function sync(_args: string[]): Promise<void> {
  const workspace = resolveWorkspaceOrExit();

  console.log('Refreshing updates...');
  console.log(`  Workspace: ${workspace}`);
  console.log('');

  const skillResult = refreshUpdates(workspace);
  if (skillResult.refreshed === 0) {
    console.log('All skill updates are current.');
  } else {
    for (const d of skillResult.details) {
      const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
      console.log(`  ✓ ${d.name} (${label})`);
    }
    console.log(`Refreshed ${skillResult.refreshed} skill update(s).`);
  }

  const actionResult = refreshActionUpdates(workspace);
  if (actionResult.refreshed === 0) {
    console.log('All action updates are current.');
  } else {
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
