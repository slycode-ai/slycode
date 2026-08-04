/**
 * Opt-in push gating for skill files (`updatable:` frontmatter allowlist).
 *
 * Files inside a skill directory have different ownership. SKILL.md and
 * anything the skill declares under `updatable:` in its frontmatter belong to
 * the store and may be overwritten on deploy. Everything else is seeded —
 * copied when missing at the destination, never overwritten once it exists —
 * because it may be project-owned living data (e.g. context-priming's area
 * references). Default-deny: a forgotten declaration means an update silently
 * doesn't propagate (visible, recoverable), never that curated project data
 * gets clobbered (unrecoverable).
 *
 * Declaration format in SKILL.md frontmatter (exact paths or `dir/**`
 * prefixes; '/'-separated):
 *
 *   updatable:
 *     - references/maintenance.md
 *     - scripts/**
 */

import fs from 'fs';
import path from 'path';

/**
 * Parse the `updatable:` list from SKILL.md content. Returns [] when absent.
 * Hand-rolled because the shared parseFrontmatter only handles scalar values.
 */
export function parseUpdatableList(skillMdContent: string): string[] {
  const fmMatch = skillMdContent.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) return [];

  const lines = fmMatch[1].split('\n');
  const entries: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (/^updatable:\s*$/.test(line)) {
      inList = true;
      continue;
    }
    if (inList) {
      const item = line.match(/^\s+-\s+(.+)$/);
      if (item) {
        let value = item[1].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (value) entries.push(value.replace(/\\/g, '/'));
      } else if (line.trim() !== '') {
        // Next frontmatter key — list ended
        inList = false;
      }
    }
  }

  return entries;
}

/**
 * Read the `updatable:` list from a skill directory's SKILL.md.
 */
export function readUpdatableList(skillDir: string): string[] {
  try {
    const content = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
    return parseUpdatableList(content);
  } catch {
    return [];
  }
}

/**
 * True when `relPath` ('/'-separated, relative to the skill root) may be
 * OVERWRITTEN at a destination. SKILL.md is always updatable — it is the
 * skill. Declared entries match exactly, or by directory prefix for `dir/**`.
 */
export function isUpdatable(relPath: string, updatable: string[]): boolean {
  if (relPath === 'SKILL.md') return true;
  for (const entry of updatable) {
    if (entry.endsWith('/**')) {
      if (relPath.startsWith(entry.slice(0, -2))) return true;
    } else if (relPath === entry) {
      return true;
    }
  }
  return false;
}

export interface GatedCopyResult {
  /** Overwritten (or freshly written) updatable files. */
  updated: string[];
  /** Non-updatable files copied because they were missing at the destination. */
  seeded: string[];
  /** Non-updatable files left untouched because a destination copy exists. */
  kept: string[];
}

/**
 * Copy a skill directory respecting the source's `updatable:` declaration:
 * SKILL.md + declared files always copy; everything else copies only when
 * missing at the destination. Never deletes destination files.
 */
export function copySkillDirGated(srcDir: string, dstDir: string): GatedCopyResult {
  const updatable = readUpdatableList(srcDir);
  const result: GatedCopyResult = { updated: [], seeded: [], kept: [] };

  const walk = (rel: string): void => {
    const srcAbs = rel ? path.join(srcDir, ...rel.split('/')) : srcDir;
    for (const entry of fs.readdirSync(srcAbs, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(entryRel);
        continue;
      }
      const srcFile = path.join(srcAbs, entry.name);
      const dstFile = path.join(dstDir, ...entryRel.split('/'));
      if (isUpdatable(entryRel, updatable)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
        result.updated.push(entryRel);
      } else if (!fs.existsSync(dstFile)) {
        fs.mkdirSync(path.dirname(dstFile), { recursive: true });
        fs.copyFileSync(srcFile, dstFile);
        result.seeded.push(entryRel);
      } else {
        result.kept.push(entryRel);
      }
    }
  };

  fs.mkdirSync(dstDir, { recursive: true });
  walk('');
  return result;
}
