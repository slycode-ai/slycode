/**
 * Whole-directory digest for skill change detection.
 *
 * One digest string covers every file in a skill directory, so reference and
 * script edits are detected the same way SKILL.md edits are. State shape is
 * unchanged from the old SKILL.md-only hashing: a single 12-hex string stored
 * per asset in store/.ignored-updates.json.
 *
 * LOCKSTEP MIRROR: packages/slycode/src/cli/sync.ts carries a byte-identical
 * hashSkillDirDigest() (the CLI cannot import from web/). Keep the walk order,
 * separator normalization, and roll format identical or the two detection
 * stages will disagree about what "changed" means.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface SkillDirDigest {
  /** Rolled digest over all files (12 hex chars, matches hashContent convention). */
  digest: string;
  /** Per-file sha256 (12 hex) keyed by '/'-separated relative path. */
  fileHashes: Record<string, string>;
}

const EMPTY_DIGEST_INPUT = '';

function walkFiles(dir: string, prefix: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Normalize to '/' so Windows and POSIX produce identical digests.
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      walkFiles(path.join(dir, entry.name), rel, out);
    } else {
      out.push(rel);
    }
  }
}

/**
 * Hash every file under `dir` into one deterministic digest.
 * Missing or empty directory yields the digest of the empty roll.
 */
export function hashSkillDir(dir: string): SkillDirDigest {
  const relPaths: string[] = [];
  walkFiles(dir, '', relPaths);
  relPaths.sort();

  const fileHashes: Record<string, string> = {};
  const roll = crypto.createHash('sha256');
  roll.update(EMPTY_DIGEST_INPUT);
  for (const rel of relPaths) {
    const buf = fs.readFileSync(path.join(dir, ...rel.split('/')));
    const fileHash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
    fileHashes[rel] = fileHash;
    roll.update(`${rel}\n${fileHash}\n`);
  }

  return { digest: roll.digest('hex').slice(0, 12), fileHashes };
}

/**
 * Relative paths that differ between two digests: content changed, present in
 * only one side (added/removed). Sorted, SKILL.md first when present.
 */
export function diffSkillDirs(a: SkillDirDigest, b: SkillDirDigest): string[] {
  const paths = new Set([...Object.keys(a.fileHashes), ...Object.keys(b.fileHashes)]);
  const changed: string[] = [];
  for (const rel of paths) {
    if (a.fileHashes[rel] !== b.fileHashes[rel]) changed.push(rel);
  }
  return changed.sort((x, y) => {
    if (x === 'SKILL.md') return -1;
    if (y === 'SKILL.md') return 1;
    return x.localeCompare(y);
  });
}
