/**
 * Path resolution for SlyCode
 *
 * Server-side only. Derives paths from process.cwd() or environment variables.
 * Replaces all hardcoded absolute paths.
 */

import path from 'path';
import fs from 'fs';

/**
 * Resolve the SlyCode root directory (workspace).
 *
 * Resolution order:
 * 1. SLYCODE_HOME env var (set by npm package's `slycode start`)
 * 2. Derive from cwd (dev mode)
 */
export function getSlycodeRoot(): string {
  if (process.env.SLYCODE_HOME) {
    return process.env.SLYCODE_HOME;
  }
  // Fallback: derive from cwd. Only reliable in dev — in prod standalone mode,
  // Next.js server.js does process.chdir(__dirname) which overrides cwd to dist/web/.
  const cwd = process.cwd();
  if (process.env.NODE_ENV === 'production') {
    console.warn('[paths] SLYCODE_HOME not set in production — falling back to cwd:', cwd);
  }
  // When started from web/, go up one level
  if (cwd.endsWith('/web') || cwd.endsWith('\\web')) {
    return path.dirname(cwd);
  }
  return cwd;
}

/**
 * Resolve the slycode package directory (where dist/scripts/, dist/data/ etc. live).
 *
 * In dev: same as getSlycodeRoot() (scripts/ is at repo root).
 * In prod: <workspace>/node_modules/slycode/dist/ (scripts are in the package).
 */
export function getPackageDir(): string {
  const root = getSlycodeRoot();
  // Check for installed package
  const pkgDist = path.join(root, 'node_modules', '@slycode', 'slycode', 'dist');
  if (fs.existsSync(pkgDist)) {
    return pkgDist;
  }
  // Dev: package assets are at the repo root
  return root;
}

/**
 * Resolve the projects directory (parent of SlyCode root).
 */
export function getProjectsDir(): string {
  return path.dirname(getSlycodeRoot());
}

/**
 * Resolve a project path from an explicit path or derive from project ID.
 * Projects are assumed to be siblings of the SlyCode directory.
 */
export function getProjectPath(projectId: string, projectPath?: string): string {
  if (projectPath) return projectPath;
  return path.join(getProjectsDir(), projectId.replace(/-/g, '_'));
}

/**
 * Get the bridge URL for server-side HTTP calls.
 *
 * Single source of truth. All server-side code that talks to the bridge
 * should call this instead of reading process.env.BRIDGE_URL directly.
 *
 * In production, startup scripts (sly-start.sh, systemd, slycode CLI)
 * set BRIDGE_URL in the shell environment before starting the web server.
 *
 * In dev, BRIDGE_URL is NOT set in the shell — the bridge runs on its
 * hardcoded default (3004). But the parent .env has BRIDGE_URL=...7592
 * for prod, and various .env loaders can leak that into process.env.
 * So in dev we ignore process.env.BRIDGE_URL and use the known default.
 */
export function getBridgeUrl(): string {
  if (process.env.NODE_ENV === 'production' && process.env.BRIDGE_URL) {
    return process.env.BRIDGE_URL;
  }
  return 'http://127.0.0.1:3004';
}
