/**
 * CLI Assets Sync API — POST /api/cli-assets/sync
 *
 * Deploy or remove assets to/from projects in a batch.
 * Accepts { changes: PendingChange[] } and executes copy/remove operations.
 * Skill deploys are always gated by the skill's `updatable:` allowlist —
 * preview what a batch will do via POST /api/cli-assets/sync/plan.
 * Emits events for each action and returns the updated CLI assets matrix.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry, getRepoRoot } from '@/lib/registry';
import {
  copyAsset,
  removeAsset,
  countOutdatedAssets,
  copyStoreAssetToProject,
  buildStoreAssetMatrix,
  scanProviderAssets,
  findNonImportedForProvider,
} from '@/lib/asset-scanner';
import { getStoreAssets } from '@/lib/store-scanner';
import { getProviderAssetFilePath } from '@/lib/provider-paths';
import { createSyncContext, resolveChange, newerCopyError } from '@/lib/sync-resolve';
import { parseMcpFromStore, activateMcp, deactivateMcp } from '@/lib/mcp-common';
import { getSlycodeRoot } from '@/lib/paths';
import { appendEvent } from '@/lib/event-log';
import type { PendingChange, AssetType, AssetInfo, ProviderId, CliAssetsData } from '@/lib/types';
import fs from 'fs';
import path from 'path';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const changes: PendingChange[] = body.changes;

    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json(
        { error: 'changes array is required and must not be empty' },
        { status: 400 },
      );
    }

    const registry = await loadRegistry();
    const masterPath = getRepoRoot();
    // Shared with /api/cli-assets/sync/plan so preview and apply agree
    const ctx = createSyncContext(registry.projects, masterPath);

    const results: { change: PendingChange; success: boolean; error?: string }[] = [];

    for (const change of changes) {
      const resolved = resolveChange(change, ctx);
      if (!resolved.ok) {
        results.push({ change, success: false, error: resolved.error });
        continue;
      }
      const { project } = resolved;

      // Newer-copy guard: a deploy must not silently overwrite a project copy
      // whose version is newer than the source. The review modal sets
      // `overwriteNewer: true` on explicitly included targets; anything else
      // is rejected here.
      if (resolved.newerConflict && change.overwriteNewer !== true) {
        results.push({ change, success: false, error: newerCopyError(change, resolved.newerConflict) });
        continue;
      }

      try {
        if (change.action === 'deploy' && change.assetType === 'mcp') {
          // MCP deploy: JSON merge via mcp-common (not file copy)
          const storePath = path.join(getSlycodeRoot(), 'store', 'mcp', `${change.assetName}.json`);
          const mcpConfig = parseMcpFromStore(storePath);
          if (!mcpConfig) {
            throw new Error(`MCP '${change.assetName}' not found in store`);
          }
          const activateResult = activateMcp(project.path, change.provider || 'claude', mcpConfig);
          if (activateResult === 'already_exists') {
            results.push({ change, success: true, error: `MCP '${change.assetName}' already present in ${project.name} — skipped` });
            continue;
          }
          appendEvent({
            type: 'skill_deployed',
            project: change.projectId,
            detail: `Deployed MCP '${change.assetName}' (${change.provider || 'claude'}) to ${project.name}`,
            timestamp: new Date().toISOString(),
          });
        } else if (change.action === 'remove' && change.assetType === 'mcp') {
          // MCP remove: JSON splice via mcp-common
          deactivateMcp(project.path, change.provider || 'claude', change.assetName);
          appendEvent({
            type: 'skill_removed',
            project: change.projectId,
            detail: `Removed MCP '${change.assetName}' from ${project.name}`,
            timestamp: new Date().toISOString(),
          });
        } else if (change.action === 'deploy') {
          if (change.source === 'store' && change.provider) {
            // Deploy from flat canonical store to project using provider-
            // specific paths. Always gated by the skill's `updatable:`
            // allowlist (feature 084 removed the SKILL.md-only mode); source
            // existence was verified by resolveChange.
            copyStoreAssetToProject(
              project.path,
              change.provider,
              change.assetType,
              change.assetName,
            );
          } else {
            // Deploy from master (existing behavior), same gating
            copyAsset(masterPath, project.path, change.assetType, change.assetName);
          }
          const providerLabel = change.provider ? ` (${change.provider})` : '';
          appendEvent({
            type: 'skill_deployed',
            project: change.projectId,
            detail: `Deployed ${change.assetType} '${change.assetName}'${providerLabel} to ${project.name}`,
            timestamp: new Date().toISOString(),
          });
        } else if (change.action === 'remove') {
          if (change.provider && change.provider !== 'claude') {
            // Remove from provider-specific path
            const filePath = getProviderAssetFilePath(
              project.path, change.provider, change.assetType, change.assetName
            );
            if (filePath && fs.existsSync(filePath)) {
              if (change.assetType === 'skill') {
                fs.rmSync(filePath, { recursive: true, force: true });
              } else {
                fs.unlinkSync(filePath);
              }
            }
          } else {
            removeAsset(project.path, change.assetType, change.assetName);
          }
          appendEvent({
            type: 'skill_removed',
            project: change.projectId,
            detail: `Removed ${change.assetType} '${change.assetName}' from ${project.name}`,
            timestamp: new Date().toISOString(),
          });
        }
        results.push({ change, success: true });
      } catch (err) {
        results.push({ change, success: false, error: String(err) });
      }
    }

    // Re-scan using store-based matrix (flat canonical store as master)
    const allStoreAssets = getStoreAssets();
    const ASSET_TYPES: AssetType[] = ['skill', 'agent'];
    const activeProvider: ProviderId = 'claude';

    const storeByType = new Map<AssetType, AssetInfo[]>();
    for (const type of ASSET_TYPES) {
      storeByType.set(type, allStoreAssets.filter(a => a.type === type));
    }

    const providerAssetsByType = new Map<AssetType, Map<string, AssetInfo[]>>();
    for (const type of ASSET_TYPES) {
      providerAssetsByType.set(type, new Map());
    }

    for (const project of registry.projects) {
      const assets = scanProviderAssets(project.path, activeProvider);
      for (const type of ASSET_TYPES) {
        const typeAssets = assets.filter(a => a.type === type);
        providerAssetsByType.get(type)!.set(project.id, typeAssets);
      }
    }

    const skills = buildStoreAssetMatrix(
      storeByType.get('skill')!, providerAssetsByType.get('skill')!, registry.projects, 'skill'
    );
    const agents = buildStoreAssetMatrix(
      storeByType.get('agent')!, providerAssetsByType.get('agent')!, registry.projects, 'agent'
    );
    const nonImported = [
      ...findNonImportedForProvider(storeByType.get('skill')!, providerAssetsByType.get('skill')!, registry.projects, 'skill'),
      ...findNonImportedForProvider(storeByType.get('agent')!, providerAssetsByType.get('agent')!, registry.projects, 'agent'),
    ];
    const matrix: CliAssetsData = { skills, agents, nonImported };
    const totalOutdated = countOutdatedAssets(matrix);

    return NextResponse.json({
      results,
      cliAssets: { ...matrix, totalOutdated },
    });
  } catch (error) {
    console.error('CLI assets sync failed:', error);
    return NextResponse.json(
      { error: 'Failed to sync CLI assets', details: String(error) },
      { status: 500 },
    );
  }
}
