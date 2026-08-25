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
import crypto from 'crypto';
import { copyFileNoFollow } from './copy-guard';
import type { DeployFileFate } from './types';

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

/** One file in a gated-deploy plan. Mirrors DeployPlanFile (types.ts). */
export interface GatedPlanEntry {
  path: string;          // '/'-separated, relative to the skill root
  fate: DeployFileFate;
  updatable: boolean;
}

function sha256File(abs: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

/** Byte-identity check; any read/stat failure counts as "different". */
export function filesIdentical(a: string, b: string): boolean {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return sha256File(a) === sha256File(b);
  } catch {
    return false;
  }
}

/**
 * Read-only plan of what copySkillDirGated would do: walk the SOURCE tree and
 * classify each file against the destination's actual on-disk state. Never
 * writes. Fates:
 * - updatable + dst missing            → 'seed'   (new file)
 * - updatable + dst identical          → 'unchanged'
 * - updatable + dst differs            → 'overwrite'
 * - not updatable + dst missing        → 'seed'
 * - not updatable + dst exists         → 'keep'   (never touched)
 * - symlinked source entry             → 'skipped' (copy-guard refuses it)
 *
 * Output is sorted SKILL.md-first, then by path (matches the changedFiles
 * convention). copySkillDirGated executes exactly this plan, so a preview
 * rendered from it cannot drift from what the copy does.
 */
export function planSkillDirGated(srcDir: string, dstDir: string): GatedPlanEntry[] {
  const updatable = readUpdatableList(srcDir);
  const entries: GatedPlanEntry[] = [];

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
      const isUp = isUpdatable(entryRel, updatable);
      if (entry.isSymbolicLink()) {
        entries.push({ path: entryRel, fate: 'skipped', updatable: isUp });
        continue;
      }
      const dstExists = fs.existsSync(dstFile);
      let fate: DeployFileFate;
      if (!dstExists) {
        fate = 'seed';
      } else if (isUp) {
        fate = filesIdentical(srcFile, dstFile) ? 'unchanged' : 'overwrite';
      } else {
        fate = 'keep';
      }
      entries.push({ path: entryRel, fate, updatable: isUp });
    }
  };

  walk('');
  entries.sort((a, b) =>
    a.path === 'SKILL.md' ? -1 : b.path === 'SKILL.md' ? 1 : a.path.localeCompare(b.path));
  return entries;
}

/**
 * Copy a skill directory respecting the source's `updatable:` declaration:
 * SKILL.md + declared files always copy; everything else copies only when
 * missing at the destination. Never deletes destination files.
 *
 * Implemented as plan-then-execute over planSkillDirGated so preview and
 * apply agree by construction. Result buckets keep their historical
 * semantics: `updated` = files the copy owns (updatable — overwritten,
 * rewritten-identical, or freshly written), `seeded` = undeclared files
 * created because they were missing, `kept` = undeclared files left alone.
 */
export function copySkillDirGated(srcDir: string, dstDir: string): GatedCopyResult {
  const plan = planSkillDirGated(srcDir, dstDir);
  const result: GatedCopyResult = { updated: [], seeded: [], kept: [] };

  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of plan) {
    if (entry.fate === 'skipped') continue;
    if (entry.fate === 'keep') {
      result.kept.push(entry.path);
      continue;
    }
    // overwrite | unchanged | seed → copy
    const srcFile = path.join(srcDir, ...entry.path.split('/'));
    const dstFile = path.join(dstDir, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    if (!copyFileNoFollow(srcFile, dstFile)) continue;
    (entry.updatable ? result.updated : result.seeded).push(entry.path);
  }
  return result;
}
