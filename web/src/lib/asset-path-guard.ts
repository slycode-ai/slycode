/**
 * Asset path traversal guard (card-1783205554613).
 *
 * The `cli-assets` route family builds filesystem paths by joining a fixed base
 * directory with an `assetName` (and, historically, a `projectPath`) taken from
 * the request. `path.join` collapses `..`, so an unchecked name like
 * `../../../.slycode` escapes the intended tree and points at arbitrary files.
 *
 * Two layers, used together:
 *   1. `validateAssetName` — reject anything that isn't a plain asset identifier.
 *   2. `assertInside` / `safeAssetJoin` — resolve the final path and confirm it
 *      still lives under the intended base directory. This is the load-bearing
 *      guard; the regex is defense-in-depth.
 *
 * IMPORTANT: a plain `/^[\w.-]+$/` allowlist is NOT enough on its own — `..` is
 * only dot characters, all inside `[\w.-]`, so it passes. `validateAssetName`
 * explicitly rejects `.`, `..`, and any path separator.
 */

import path from 'path';

/**
 * True only for legitimate single-segment asset identifiers (skill/agent/mcp
 * names). Rejects empty strings, `.`, `..`, path separators, NUL bytes, and
 * anything not starting with an alphanumeric.
 */
export function validateAssetName(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  if (/[\\/\0]/.test(name)) return false;
  // Must start alphanumeric, then word chars / dot / hyphen only.
  return /^[A-Za-z0-9][\w.-]*$/.test(name);
}

/**
 * Resolve `candidateName` against `baseDir` and return the absolute path only if
 * it stays within `baseDir` (or is `baseDir` itself). Returns null on escape.
 * Purely lexical — does not touch the filesystem.
 */
export function assertInside(baseDir: string, candidateName: string): string | null {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, candidateName);
  if (resolved === base) return resolved;
  if (resolved.startsWith(base + path.sep)) return resolved;
  return null;
}

/**
 * Convenience: validate the name AND confirm containment in one call.
 * Returns the safe absolute path, or null if the name is invalid or escapes.
 */
export function safeAssetJoin(baseDir: string, assetName: unknown): string | null {
  if (!validateAssetName(assetName)) return null;
  return assertInside(baseDir, assetName);
}
