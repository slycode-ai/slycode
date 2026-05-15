/**
 * Pure decision logic for the per-project skill-update toast.
 *
 * Compares three frontmatter versions for a single watched skill:
 *   - `updatesVersion`: version in `updates/skills/<name>/SKILL.md` (staged, unaccepted)
 *   - `storeVersion`:   version in `store/skills/<name>/SKILL.md`   (canonical published)
 *   - `projectVersion`: version in `<project>/.claude/skills/<name>/SKILL.md` (installed)
 *
 * Returns the toast state for that skill. Only `accept` and `deploy` should
 * render a toast in the UI; `ahead` and `invalidVersion` are explicit
 * non-toast states.
 *
 * Comparison uses real semver ordering (with light coercion for non-strict
 * inputs like `1.10` or `v1.11`). Pure equality would mis-flag projects that
 * are ahead of the store as outdated.
 */

import type { SkillUpdateState } from './types';

export interface DecideInput {
  updatesVersion: string | null;
  storeVersion: string | null;
  projectVersion: string | null;
}

export interface DecideResult {
  state: SkillUpdateState;
  latestVersion: string | null;
}

// ---------------------------------------------------------------------------
// Tiny local semver helper. Avoids adding a dependency for a 4-function need.
// ---------------------------------------------------------------------------

interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a permissive semver-ish string into MAJOR.MINOR.PATCH. Tolerates a
 * leading `v`, missing components (`1.10` → 1.10.0; `2` → 2.0.0), and
 * pre-release / build suffixes (stripped). Returns null on totally
 * unparsable inputs.
 *
 * NOT a full semver implementation — pre-release ordering is intentionally
 * ignored because skill frontmatters don't use it in practice.
 */
export function parseSemver(input: string | null | undefined): SemVer | null {
  if (!input) return null;
  const cleaned = String(input).trim().replace(/^v/i, '').split(/[-+]/)[0];
  if (!cleaned) return null;
  const parts = cleaned.split('.');
  if (parts.length === 0 || parts.length > 3) return null;

  const nums = parts.map(p => {
    if (!/^\d+$/.test(p)) return NaN;
    return Number.parseInt(p, 10);
  });
  if (nums.some(n => Number.isNaN(n) || n < 0)) return null;

  return {
    major: nums[0] ?? 0,
    minor: nums[1] ?? 0,
    patch: nums[2] ?? 0,
  };
}

/**
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function cmpSemver(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

/**
 * True iff `a` is strictly greater than `b` under permissive semver.
 * Either side unparsable → false (caller decides what to do with unknowns).
 */
export function semverGt(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return false;
  return cmpSemver(pa, pb) > 0;
}

// ---------------------------------------------------------------------------
// State decision
// ---------------------------------------------------------------------------

export function decideSkillState(input: DecideInput): DecideResult {
  const { updatesVersion, storeVersion, projectVersion } = input;

  // State A: updates is genuinely newer than store
  if (semverGt(updatesVersion, storeVersion)) {
    return { state: 'accept', latestVersion: updatesVersion };
  }

  // State B: store is genuinely newer than project
  if (semverGt(storeVersion, projectVersion)) {
    return { state: 'deploy', latestVersion: storeVersion };
  }

  // Project ahead of store — no toast (local dev bump or hand-edited)
  if (semverGt(projectVersion, storeVersion)) {
    return { state: 'ahead', latestVersion: storeVersion };
  }

  // Versions differ as strings but at least one is unparsable — conservative
  // fall-through: don't make claims about who's ahead.
  if (
    storeVersion &&
    projectVersion &&
    storeVersion.trim() !== projectVersion.trim() &&
    (!parseSemver(storeVersion) || !parseSemver(projectVersion))
  ) {
    return { state: 'invalidVersion', latestVersion: storeVersion };
  }

  return { state: 'none', latestVersion: storeVersion ?? null };
}
