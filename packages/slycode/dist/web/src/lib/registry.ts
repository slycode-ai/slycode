/**
 * Registry Loader
 *
 * Loads project registry and aggregates backlog data from all managed projects.
 * This runs server-side only (uses Node.js fs).
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import type {
  Registry,
  Project,
  ProjectWithBacklog,
  BacklogItem,
  DesignEntry,
  FeatureEntry,
  DashboardData,
  KanbanBoard,
} from './types';
import {
  scanProjectAssets,
  scanMasterAssets,
  buildAssetMatrix,
  detectPlatforms,
  countOutdatedAssets,
  buildStoreAssetMatrix,
  scanProviderAssets,
} from './asset-scanner';
import { getStoreAssets } from './store-scanner';
import { calculateHealthFromAssets } from './health-score';
import { getBridgeUrl } from './paths';
import { ensureProjectSessionKey } from './session-keys';

// Path to the registry file
// Resolution: SLYCODE_HOME → derive from cwd
export function getRepoRoot(): string {
  if (process.env.SLYCODE_HOME) {
    return process.env.SLYCODE_HOME;
  }
  // In dev, cwd is web/, in production it depends on deployment
  // Check if we're in the web directory
  const cwd = process.cwd();
  if (cwd.endsWith('/web') || cwd.endsWith('\\web')) {
    return path.dirname(cwd);
  }
  // Otherwise assume cwd is the repo root
  return cwd;
}

const REPO_ROOT = getRepoRoot();
const REGISTRY_PATH = path.join(REPO_ROOT, 'projects', 'registry.json');

/**
 * Load the registry JSON file. Self-heals missing sessionKey/sessionKeyAliases
 * on each project by computing them from project.path; persists once via
 * atomic write if anything changed. Safe to run multiple times (idempotent).
 */
export async function loadRegistry(): Promise<Registry> {
  let content: string;
  try {
    content = await fs.readFile(REGISTRY_PATH, 'utf-8');
  } catch (error) {
    console.error('Failed to load registry:', error);
    throw new Error(`Failed to load registry from ${REGISTRY_PATH}`);
  }

  const registry = JSON.parse(content) as Registry;

  // Self-heal: ensure every project has sessionKey + sessionKeyAliases.
  let dirty = false;
  for (const project of registry.projects) {
    if (ensureProjectSessionKey(project)) dirty = true;
  }

  if (dirty) {
    // Persist the migration. Use a temp-file + rename pattern so a crash
    // mid-write can't corrupt the registry.
    try {
      const tmpPath = `${REGISTRY_PATH}.tmp.${process.pid}.${Date.now()}`;
      const out = JSON.stringify(registry, null, 2) + '\n';
      await fs.writeFile(tmpPath, out, 'utf-8');
      await fs.rename(tmpPath, REGISTRY_PATH);
      console.log(`Registry: backfilled sessionKey on ${registry.projects.length} project(s) and persisted.`);
    } catch (err) {
      // Persistence failure is non-fatal — the migration will retry next load.
      // We still return the in-memory migrated registry so the current request
      // gets correct sessionKeys.
      console.warn('Registry sessionKey migration: write failed, will retry next load', err);
    }
  }

  return registry;
}

/**
 * Save the registry JSON file
 */
export async function saveRegistry(registry: Registry): Promise<void> {
  const content = JSON.stringify(registry, null, 2) + '\n';
  await fs.writeFile(REGISTRY_PATH, content, 'utf-8');
}

/**
 * Count uncommitted files in a git repository
 */
function getUncommittedCount(projectPath: string): number {
  try {
    const output = execSync('git status --porcelain', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
      windowsHide: true,
    });
    return output.split('\n').filter(line => line.trim().length > 0).length;
  } catch {
    return -1;
  }
}

/**
 * Check if a directory exists and is accessible
 */
async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Load JSON file safely, returning null if not found or invalid
 */
async function loadJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Load backlog items from a project's documentation/backlog.json
 */
async function loadProjectBacklog(
  projectPath: string,
  projectId: string,
  projectName: string
): Promise<BacklogItem[]> {
  const backlogPath = path.join(projectPath, 'documentation', 'backlog.json');
  const items = await loadJsonFile<BacklogItem[]>(backlogPath);

  if (!items) return [];

  // Enrich items with project info
  return items.map((item) => ({
    ...item,
    projectId,
    projectName,
  }));
}

/**
 * Load designs index from a project
 */
async function loadProjectDesigns(
  projectPath: string,
  projectId: string
): Promise<DesignEntry[]> {
  const designsPath = path.join(projectPath, 'documentation', 'designs.json');
  const items = await loadJsonFile<DesignEntry[]>(designsPath);

  if (!items) return [];

  return items.map((item) => ({
    ...item,
    projectId,
  }));
}

/**
 * Load features index from a project
 */
async function loadProjectFeatures(
  projectPath: string,
  projectId: string
): Promise<FeatureEntry[]> {
  const featuresPath = path.join(projectPath, 'documentation', 'features.json');
  const items = await loadJsonFile<FeatureEntry[]>(featuresPath);

  if (!items) return [];

  return items.map((item) => ({
    ...item,
    projectId,
  }));
}

/**
 * Load full project data including backlog, designs, and features
 */
async function loadProjectWithBacklog(
  project: Project
): Promise<ProjectWithBacklog> {
  const projectPath = project.path;

  // Check if path exists
  const exists = await directoryExists(projectPath);
  if (!exists) {
    return {
      ...project,
      backlog: [],
      designs: [],
      features: [],
      accessible: false,
      error: `Path not accessible: ${projectPath}`,
    };
  }

  // Load all project data in parallel
  const [backlog, designs, features] = await Promise.all([
    loadProjectBacklog(projectPath, project.id, project.name),
    loadProjectDesigns(projectPath, project.id),
    loadProjectFeatures(projectPath, project.id),
  ]);

  // Scan assets, detect platforms, and check git status (sync, fast enough for dashboard)
  const assets = scanProjectAssets(projectPath, project.id);
  const platforms = detectPlatforms(projectPath);
  const uncommitted = getUncommittedCount(projectPath);

  return {
    ...project,
    backlog,
    designs,
    features,
    assets,
    platforms,
    gitUncommitted: uncommitted >= 0 ? uncommitted : undefined,
    accessible: true,
  };
}

/**
 * Load all projects with their backlog data
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const registry = await loadRegistry();

  // Backfill order for projects that don't have one yet
  for (let i = 0; i < registry.projects.length; i++) {
    if (registry.projects[i].order === undefined) {
      registry.projects[i].order = i;
    }
  }

  // Sort projects by order
  registry.projects.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  // Load all projects in parallel
  const projectPromises = registry.projects.map((project) =>
    loadProjectWithBacklog(project)
  );
  const projects = await Promise.all(projectPromises);

  // Build store-based CLI assets matrix for outdated counts and health scoring
  // Uses flat canonical store/ as the master source
  const storeAssets = getStoreAssets();
  const providers: Array<'claude' | 'agents'> = ['claude', 'agents'];
  const assetTypes: Array<'skill' | 'agent'> = ['skill', 'agent'];
  let totalOutdatedAssets = 0;

  // Collect all rows across providers for per-project health scoring
  const allMatrixRows: import('./types').AssetRow[] = [];

  for (const provider of providers) {
    for (const assetType of assetTypes) {
      const storeByType = storeAssets.filter(a => a.type === assetType);
      const providerProjectAssets = new Map<string, import('./types').AssetInfo[]>();
      for (const project of registry.projects) {
        const assets = scanProviderAssets(project.path, provider);
        providerProjectAssets.set(project.id, assets.filter(a => a.type === assetType));
      }
      const rows = buildStoreAssetMatrix(storeByType, providerProjectAssets, registry.projects, assetType);
      allMatrixRows.push(...rows);
    }
  }

  for (const row of allMatrixRows) {
    for (const cell of row.cells) {
      if (cell.status === 'outdated') totalOutdatedAssets++;
    }
  }

  // Calculate per-project health scores with per-project outdated counts
  for (const project of projects) {
    if (!project.accessible) continue;

    let projectOutdated = 0;
    for (const row of allMatrixRows) {
      for (const cell of row.cells) {
        if (cell.projectId === project.id && cell.status === 'outdated') {
          projectOutdated++;
        }
      }
    }

    project.healthScore = calculateHealthFromAssets(
      project,
      project.assets,
      projectOutdated,
    );
  }

  // Count kanban backlog cards across all projects
  let totalBacklogItems = 0;
  let activeItems = 0;
  for (const project of projects) {
    if (!project.accessible) continue;
    const kanbanPath = path.join(project.path, 'documentation', 'kanban.json');
    const board = await loadJsonFile<KanbanBoard>(kanbanPath);
    if (board?.stages) {
      const backlogCards = (board.stages.backlog || []).filter(c => !c.archived);
      totalBacklogItems += backlogCards.length;
      // Count active work (implementation + testing stages)
      const implCards = (board.stages.implementation || []).filter(c => !c.archived);
      const testCards = (board.stages.testing || []).filter(c => !c.archived);
      activeItems += implCards.length + testCards.length;
    }
  }

  // Sum uncommitted across all projects
  const totalUncommitted = projects.reduce((sum, p) => {
    return sum + (p.gitUncommitted && p.gitUncommitted > 0 ? p.gitUncommitted : 0);
  }, 0);

  // Fetch bridge session counts (best-effort, don't fail if bridge is down)
  const bridgeUrl = getBridgeUrl();
  try {
    const resp = await fetch(`${bridgeUrl}/stats`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      const data = await resp.json() as { sessions: Array<{ name: string; status: string; isActive: boolean }> };
      const counts: Record<string, number> = {};
      for (const s of data.sessions || []) {
        // Only count sessions with sustained recent output (not just running/idle)
        if (s.isActive) {
          const group = s.name.split(':')[0];
          counts[group] = (counts[group] || 0) + 1;
        }
      }
      for (const project of projects) {
        project.activeSessions = counts[project.id] ?? 0;
      }
    }
  } catch {
    // Bridge not running — leave activeSessions unset
  }

  const repoRoot = getRepoRoot();
  return {
    projects,
    totalBacklogItems,
    activeItems,
    totalOutdatedAssets,
    totalUncommitted,
    lastRefresh: new Date().toISOString(),
    slycodeRoot: repoRoot,
    projectsDir: path.dirname(repoRoot),
  };
}

/**
 * Get all projects
 */
export async function getAllProjects(): Promise<Project[]> {
  const registry = await loadRegistry();
  return registry.projects;
}

/**
 * Get a single project by ID
 */
export async function getProject(id: string): Promise<ProjectWithBacklog | null> {
  const registry = await loadRegistry();

  const project = registry.projects.find((p) => p.id === id);
  if (!project) return null;

  return loadProjectWithBacklog(project);
}
