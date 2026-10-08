/**
 * Registry Loader
 *
 * Loads project registry and aggregates backlog data from all managed projects.
 * This runs server-side only (uses Node.js fs).
 */

import { promises as fs } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { atomicWriteFile } from './atomic-write';
import { withRegistryLock } from './registry-lock';
import type {
  AttentionItem,
  UpcomingRun,
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
  detectPlatforms,
  buildStoreAssetMatrix,
  scanProviderAssets,
} from './asset-scanner';
import { getStoreAssets } from './store-scanner';
import { calculateHealthFromAssets } from './health-score';
import { getBridgeUrl } from './paths';
import { ensureProjectSessionKey, sumProjectActivityCounts } from './session-keys';
import { isProjectActive, projectStatus } from './project-status';
import { firesBetween, heldSummary } from './project-held';
import { sortedFolders } from './project-folders';

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
 * The registry exactly as it is on disk right now — no lock, no heal, no
 * write. For read-only status checks that must not see a stale copy (the
 * scheduler's last-moment guard, #0381).
 */
export async function readRegistrySnapshot(): Promise<Registry> {
  return readRegistryFile();
}

async function readRegistryFile(): Promise<Registry> {
  let content: string;
  try {
    content = await fs.readFile(REGISTRY_PATH, 'utf-8');
  } catch (error) {
    console.error('Failed to load registry:', error);
    throw new Error(`Failed to load registry from ${REGISTRY_PATH}`);
  }
  return JSON.parse(content) as Registry;
}

/**
 * Load the registry JSON file. Self-heals missing sessionKey/sessionKeyAliases
 * on each project by computing them from project.path; the heal is persisted
 * through mutateRegistry() (locked, fresh re-read) so it can never overwrite
 * a concurrent status/folder/order write with this stale snapshot — and the
 * FRESH healed registry read under the lock is what gets returned.
 * Safe to run multiple times (idempotent).
 */
export async function loadRegistry(): Promise<Registry> {
  const registry = await readRegistryFile();

  // Self-heal: ensure every project has sessionKey + sessionKeyAliases.
  let dirty = false;
  for (const project of registry.projects) {
    if (ensureProjectSessionKey(project)) dirty = true;
  }

  if (dirty) {
    try {
      // mutateRegistry heals the FRESH copy it reads under the lock, persists
      // it if that changed anything, and hands that fresh copy back.
      const fresh = await mutateRegistry((r) => structuredClone(r));
      console.log(`Registry: backfilled sessionKey on ${fresh.projects.length} project(s) and persisted.`);
      return fresh;
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
 * The ONLY way to write projects/registry.json (card #0381 fix loop): under
 * the registry lock (same advisory lockfile as the board lock, shared with
 * scripts/kanban.js `withRegistryLock`), re-read the file fresh, apply `fn`,
 * and atomically write it back — only if something changed. Every writer
 * (status, folders, reorder, edit, create, delete, session-key heal, CLI)
 * goes through a fresh read under the lock, so two concurrent writers both
 * keep their changes instead of the later one saving a stale snapshot.
 *
 * `fn` may throw to abort (nothing is written). Keep it fast — no network or
 * long-running work under the lock. The lock FAILS CLOSED: contention past
 * the deadline or a lock error throws RegistryLockError (status 503) and
 * `fn` never runs unlocked (fix loop 2).
 *
 * The change check snapshots the file BEFORE the session-key heal, so a
 * heal-only pass persists too.
 */
export async function mutateRegistry<T>(
  fn: (registry: Registry) => T | Promise<T>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  return withRegistryLock(REGISTRY_PATH, async () => {
    const registry = await readRegistryFile();
    const before = JSON.stringify(registry);
    for (const project of registry.projects) ensureProjectSessionKey(project);
    const result = await fn(registry);
    if (JSON.stringify(registry) !== before) {
      registry.lastUpdated = new Date().toISOString();
      if (registry.version === '2.0.0' && (registry.folders || registry.projects.some(p => p.status || p.folderId))) {
        registry.version = '2.1.0'; // marker only — readers never branch on it
      }
      await atomicWriteFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + '\n');
    }
    return result;
  }, opts);
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

  // #0381: archived projects are cold — no fs checks, git, asset or platform
  // scans. The Den shows them as a one-line row from registry data alone.
  if (projectStatus(project) === 'archived') {
    return { ...project, backlog: [], designs: [], features: [], accessible: true, cold: true };
  }

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
  // #0381: archived projects are cold — left out of the asset scan entirely.
  const warmProjects = registry.projects.filter(p => projectStatus(p) !== 'archived');

  for (const provider of providers) {
    for (const assetType of assetTypes) {
      const storeByType = storeAssets.filter(a => a.type === assetType);
      const providerProjectAssets = new Map<string, import('./types').AssetInfo[]>();
      for (const project of warmProjects) {
        const assets = scanProviderAssets(project.path, provider);
        providerProjectAssets.set(project.id, assets.filter(a => a.type === assetType));
      }
      const rows = buildStoreAssetMatrix(storeByType, providerProjectAssets, warmProjects, assetType);
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
    if (!project.accessible || project.cold) continue;

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
  const needsYou: AttentionItem[] = [];
  const upcoming: UpcomingRun[] = [];
  const nowMs = Date.now();
  const dayAheadMs = nowMs + 24 * 60 * 60 * 1000;
  const tz = process.env.TZ || 'UTC'; // same source as the scheduler's CONFIGURED_TIMEZONE
  let heldRunsNext24h = 0;
  for (const project of projects) {
    if (!project.accessible || project.cold) continue;
    const kanbanPath = path.join(project.path, 'documentation', 'kanban.json');
    const board = await loadJsonFile<KanbanBoard>(kanbanPath);
    // #0381: a held project keeps its tile (stage bar) and reports what it is
    // holding, but stays out of every Den aggregate (hero counts, Needs you,
    // Next 24 hours) — those are Active-only.
    if (!isProjectActive(project)) {
      const atlas = await loadJsonFile<{ enabled?: boolean; schedule?: string | null }>(
        path.join(project.path, 'documentation', 'atlas', 'config.json'));
      const since = project.statusChangedAt ? Date.parse(project.statusChangedAt) : NaN;
      project.held = heldSummary(board, atlas, {
        sinceMs: Number.isFinite(since) ? since : undefined,
        nowMs,
        timezone: tz,
      });
      for (const cards of Object.values(board?.stages ?? {})) {
        for (const c of cards || []) {
          const a = c.automation;
          if (!a?.enabled || c.archived || !a.schedule) continue;
          if (a.scheduleType === 'one-shot') {
            const t = Date.parse(a.nextRun || a.schedule);
            if (t > nowMs && t <= dayAheadMs) heldRunsNext24h++;
          } else {
            heldRunsNext24h += firesBetween(a.schedule, nowMs, dayAheadMs, tz);
          }
        }
      }
    }
    if (board?.stages) {
      // Per-project open cards per lane, matching what the board shows
      // (automation cards live outside the lanes).
      const onBoard = (stage: keyof typeof board.stages) =>
        (board.stages[stage] || []).filter(c => !c.archived && !c.automation).length;
      project.stageCounts = {
        backlog: onBoard('backlog'),
        design: onBoard('design'),
        implementation: onBoard('implementation'),
        testing: onBoard('testing'),
        done: onBoard('done'),
      };
      if (!isProjectActive(project)) continue; // tile only — no aggregates (#0381)
      const backlogCards = (board.stages.backlog || []).filter(c => !c.archived);
      totalBacklogItems += backlogCards.length;
      // Count active work (implementation + testing stages)
      const implCards = (board.stages.implementation || []).filter(c => !c.archived);
      const testCards = (board.stages.testing || []).filter(c => !c.archived);
      activeItems += implCards.length + testCards.length;

      const ref = { projectId: project.id, projectName: project.name };
      for (const c of testCards) {
        if (c.automation) continue;
        needsYou.push({ ...ref, cardId: c.id, number: c.number, title: c.title, reason: 'review', at: c.updated_at });
      }
      for (const cards of Object.values(board.stages)) {
        for (const c of cards || []) {
          const a = c.automation;
          if (a && !a.enabled && !c.archived && a.lastResult === 'skipped') {
            // One-shot skipped by the resume fence (#0381) — owner can Run now.
            needsYou.push({ ...ref, cardId: c.id, number: c.number, title: c.title, reason: 'skipped-run', detail: a.lastError, at: a.nextRun || a.schedule });
            continue;
          }
          if (!a?.enabled || c.archived) continue;
          if (a.lastResult === 'error') {
            needsYou.push({ ...ref, cardId: c.id, number: c.number, title: c.title, reason: 'failed-run', detail: a.lastError, at: a.lastRun });
          }
          const next = a.nextRun ? Date.parse(a.nextRun) : NaN;
          if (!isNaN(next) && next >= nowMs - 60_000 && next <= dayAheadMs) {
            upcoming.push({ ...ref, cardId: c.id, number: c.number, title: c.title, nextRun: a.nextRun! });
          }
        }
      }
    }
  }

  // Sum uncommitted across all projects
  const totalUncommitted = projects.reduce((sum, p) => {
    if (!isProjectActive(p)) return sum; // hero counts Active only (#0381)
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
        // Alias-aware: sum across canonical sessionKey + legacy id forms.
        project.activeSessions = sumProjectActivityCounts(project, counts);
      }
    }
  } catch {
    // Bridge not running — leave activeSessions unset
  }

  const repoRoot = getRepoRoot();
  // Failed runs first (something broke), then skipped runs, then reviews,
  // newest first within each.
  const reasonRank = { 'failed-run': 0, 'skipped-run': 1, review: 2 } as const;
  needsYou.sort((x, y) => (x.reason === y.reason ? (y.at ?? '').localeCompare(x.at ?? '') : reasonRank[x.reason] - reasonRank[y.reason]));
  upcoming.sort((x, y) => x.nextRun.localeCompare(y.nextRun));

  return {
    projects,
    needsYou,
    upcoming,
    heldRunsNext24h,
    folders: sortedFolders(registry.folders),
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
