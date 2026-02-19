/**
 * Kanban Path Resolution
 *
 * Resolves kanban file paths for any project by consulting the project registry.
 * This ensures each project's kanban data lives in its own repository.
 */

import path from 'path';
import {
  getRepoRoot,
  loadRegistry,
} from './registry';
import type { Project } from './types';

// Backup tier configuration
export const BACKUP_TIERS = {
  hourly: 60 * 60 * 1000,         // 1 hour
  daily: 24 * 60 * 60 * 1000,     // 24 hours
  weekly: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const;

export type BackupTier = keyof typeof BACKUP_TIERS;

// Cache the registry for the duration of a request to avoid repeated file reads
let registryCache: { projects: Project[] } | null = null;
let registryCacheTime = 0;
const REGISTRY_CACHE_TTL = 5000; // 5 seconds

async function getCachedRegistry(): Promise<{ projects: Project[] }> {
  const now = Date.now();
  if (registryCache && (now - registryCacheTime) < REGISTRY_CACHE_TTL) {
    return registryCache;
  }
  registryCache = await loadRegistry();
  registryCacheTime = now;
  return registryCache;
}

/**
 * Error thrown when a project cannot be resolved
 */
export class ProjectResolutionError extends Error {
  constructor(
    message: string,
    public readonly code: 'NOT_FOUND' | 'UNAVAILABLE_IN_ENV'
  ) {
    super(message);
    this.name = 'ProjectResolutionError';
  }
}

/**
 * Resolve the filesystem root path for a project.
 *
 * For the workspace project, returns the repo root directly.
 * For other projects, looks up the project in the registry and returns
 * the path appropriate for the current environment (home/work).
 *
 * @throws ProjectResolutionError if project not found or unavailable
 */
export async function resolveProjectRoot(projectId: string): Promise<string> {
  // Special case: workspace project is always the repo root
  // Normalize underscores to hyphens (directory names use _ but project IDs use -)
  const workspaceId = path.basename(getRepoRoot()).replace(/_/g, '-');
  if (projectId === workspaceId) {
    return getRepoRoot();
  }

  const registry = await getCachedRegistry();
  const project = registry.projects.find((p) => p.id === projectId);

  if (!project) {
    throw new ProjectResolutionError(
      `Project '${projectId}' not found in registry`,
      'NOT_FOUND'
    );
  }

  return project.path;
}

/**
 * Get the kanban.json file path for a project.
 * All projects use the same relative path: documentation/kanban.json
 */
export async function getKanbanPath(projectId: string): Promise<string> {
  const projectRoot = await resolveProjectRoot(projectId);
  return path.join(projectRoot, 'documentation', 'kanban.json');
}

/**
 * Get the archive directory path for a project's kanban backups.
 */
export async function getArchiveDir(projectId: string): Promise<string> {
  const projectRoot = await resolveProjectRoot(projectId);
  return path.join(projectRoot, 'documentation', 'archive');
}

/**
 * Get the path for a tiered backup file.
 * Format: {archiveDir}/kanban_{tier}_{version}.json
 */
export async function getTieredBackupPath(
  projectId: string,
  tier: BackupTier,
  version: number = 1
): Promise<string> {
  const archiveDir = await getArchiveDir(projectId);
  const versionStr = String(version).padStart(3, '0');
  return path.join(archiveDir, `kanban_${tier}_${versionStr}.json`);
}

/**
 * Get legacy backup file patterns for cleanup.
 * Returns paths to old-style backup files that should be removed.
 */
export async function getLegacyBackupPaths(projectId: string): Promise<string[]> {
  const archiveDir = await getArchiveDir(projectId);
  const legacyFiles: string[] = [];

  // Old numbered backup pattern (kanban_001.json, etc.)
  for (let i = 1; i <= 10; i++) {
    const numStr = String(i).padStart(3, '0');
    legacyFiles.push(path.join(archiveDir, `kanban_${numStr}.json`));
  }

  // Old single-file tiered backups (kanban_hourly.json without version)
  for (const tier of Object.keys(BACKUP_TIERS)) {
    legacyFiles.push(path.join(archiveDir, `kanban_${tier}.json`));
  }

  return legacyFiles;
}

/**
 * Get the documentation directory for watching (used by SSE stream).
 * For specific projects, returns their kanban.json path.
 * For "all projects" mode (null projectId), returns the workspace documentation dir.
 */
export async function getWatchPath(projectId: string | null): Promise<string> {
  if (!projectId) {
    // Watch all kanban files in the workspace documentation dir
    return path.join(getRepoRoot(), 'documentation');
  }
  return getKanbanPath(projectId);
}
