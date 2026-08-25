/**
 * Shared per-change resolution for POST /api/cli-assets/sync and
 * POST /api/cli-assets/sync/plan (feature 084 — deploy review modal).
 *
 * Both endpoints must agree on how a PendingChange maps to a concrete
 * project target, whether the asset exists at its source, and when the
 * newer-copy guard applies. Extracting the logic here keeps the preview and
 * the apply from drifting: the plan route SURFACES a newer-copy conflict for
 * the review modal, the sync route REJECTS the deploy unless the change
 * carries `overwriteNewer: true`.
 */

import { scanProviderAssets } from './asset-scanner';
import { getStoreAssets } from './store-scanner';
import { compareVersions } from './version-compare';
import { validateAssetName } from './asset-path-guard';
import type { AssetInfo, PendingChange, Project, ProviderId } from './types';

export interface SyncContext {
  projectMap: Map<string, Project>;
  masterPath: string;
  /** Per-request provider scan cache (key: `${path}:${provider}`). */
  scanCached: (projectPath: string, provider: ProviderId) => AssetInfo[];
}

export function createSyncContext(projects: Project[], masterPath: string): SyncContext {
  const cache = new Map<string, AssetInfo[]>();
  return {
    projectMap: new Map(projects.map(p => [p.id, p])),
    masterPath,
    scanCached(projectPath, provider) {
      const key = `${projectPath}:${provider}`;
      let assets = cache.get(key);
      if (!assets) {
        assets = scanProviderAssets(projectPath, provider);
        cache.set(key, assets);
      }
      return assets;
    },
  };
}

export type ResolvedChange =
  | {
      ok: true;
      project: Project;
      provider: ProviderId;
      /**
       * Set when the project copy's version is NEWER than the source's
       * (deploy of skill/agent only). Missing/unparsable versions compare
       * equal and never conflict — this is a warn-with-consent guard, not a
       * hard block.
       */
      newerConflict: { projectVersion?: string; storeVersion?: string } | null;
    }
  | { ok: false; error: string };

export function resolveChange(change: PendingChange, ctx: SyncContext): ResolvedChange {
  const project = ctx.projectMap.get(change.projectId);
  if (!project) {
    return { ok: false, error: `Project ${change.projectId} not found` };
  }

  // Traversal guard: every change's assetName feeds copy/remove/plan path
  // joins. mcp names also index a `${assetName}.json` store file, so guard
  // all types.
  if (!validateAssetName(change.assetName)) {
    return { ok: false, error: `Invalid asset name: ${String(change.assetName)}` };
  }

  const provider = change.provider || 'claude';

  // Source existence for store-sourced skill/agent deploys — both routes
  // need a definitive answer before planning/copying.
  if (
    change.action === 'deploy' &&
    change.assetType !== 'mcp' &&
    change.source === 'store' &&
    change.provider
  ) {
    const storeAsset = getStoreAssets().find(
      a => a.name === change.assetName && a.type === change.assetType,
    );
    if (!storeAsset) {
      return { ok: false, error: `Asset '${change.assetName}' not found in store` };
    }
  }

  // Newer-copy comparison (report only — enforcement is the caller's job).
  let newerConflict: { projectVersion?: string; storeVersion?: string } | null = null;
  if (change.action === 'deploy' && (change.assetType === 'skill' || change.assetType === 'agent')) {
    const sourceAssets = change.source === 'store'
      ? getStoreAssets()
      : ctx.scanCached(ctx.masterPath, 'claude');
    const sourceVersion = sourceAssets.find(
      a => a.name === change.assetName && a.type === change.assetType,
    )?.frontmatter?.version as string | undefined;
    const projectVersion = ctx.scanCached(project.path, provider).find(
      a => a.name === change.assetName && a.type === change.assetType,
    )?.frontmatter?.version as string | undefined;

    if (compareVersions(projectVersion, sourceVersion) > 0) {
      newerConflict = { projectVersion, storeVersion: sourceVersion };
    }
  }

  return { ok: true, project, provider, newerConflict };
}

/** The rejection message sync returns for an unconsented newer-copy deploy. */
export function newerCopyError(
  change: PendingChange,
  conflict: { projectVersion?: string; storeVersion?: string },
): string {
  return `Project copy of '${change.assetName}' is newer (v${conflict.projectVersion} > v${conflict.storeVersion ?? '?'}) — deploy requires overwriteNewer consent`;
}
