import * as path from 'path';
import * as fs from 'fs';
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
 * Compare versions in package templates/updates/skills/ vs workspace updates/skills/.
 * Copy when versions differ or skill is missing.
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
    } else {
      result.skipped++;
    }
  }

  return result;
}

/**
 * Replace the providers block in workspace providers.json with the template version.
 * Preserves the defaults block (user preferences).
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

  console.log('Refreshing skill updates...');
  console.log(`  Workspace: ${workspace}`);
  console.log('');

  const result = refreshUpdates(workspace);

  if (result.refreshed === 0) {
    console.log('All skill updates are current.');
  } else {
    for (const d of result.details) {
      const label = d.from === '0.0.0' ? 'new' : `${d.from} → ${d.to}`;
      console.log(`  ✓ ${d.name} (${label})`);
    }
    console.log('');
    console.log(`Refreshed ${result.refreshed} skill update(s).`);
  }

  // Seed terminal-classes.json if missing
  const tcResult = refreshTerminalClasses(workspace);
  if (tcResult.seeded) {
    console.log('  ✓ Seeded terminal-classes.json');
  }
}
