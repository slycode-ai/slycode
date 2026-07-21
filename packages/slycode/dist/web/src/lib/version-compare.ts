/**
 * Shared semver-ish comparison for asset deploy guards.
 *
 * Extracted from AssetMatrix so the push-to-all overwrite warning (client)
 * and the sync API's newer-copy guard (server) use identical semantics:
 * missing/unparsable versions compare as equal (0) — never treated as newer.
 */

/**
 * Compare two version strings. Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareVersions(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const va = partsA[i] || 0;
    const vb = partsB[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}
