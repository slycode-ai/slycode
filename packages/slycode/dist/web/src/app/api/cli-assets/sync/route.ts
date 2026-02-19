/**
 * CLI Assets Sync API — POST /api/cli-assets/sync
 *
 * Deploy or remove assets to/from projects in a batch.
 * Accepts { changes: PendingChange[] } and executes copy/remove operations.
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
import { appendEvent } from '@/lib/event-log';
import type { PendingChange, AssetType, AssetInfo, ProviderId, CliAssetsData } from '@/lib/types';
import fs from 'fs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const changes: PendingChange[] = body.changes;
    const fullSkillFolder: boolean = body.fullSkillFolder === true;

    if (!Array.isArray(changes) || changes.length === 0) {
      return NextResponse.json(
        { error: 'changes array is required and must not be empty' },
        { status: 400 },
      );
    }

    const registry = await loadRegistry();
    const projectMap = new Map(registry.projects.map(p => [p.id, p]));
    const masterPath = getRepoRoot();

    const results: { change: PendingChange; success: boolean; error?: string }[] = [];

    for (const change of changes) {
      const project = projectMap.get(change.projectId);
      if (!project) {
        results.push({ change, success: false, error: `Project ${change.projectId} not found` });
        continue;
      }

      try {
        if (change.action === 'deploy') {
          if (change.source === 'store' && change.provider) {
            // Deploy from flat canonical store to project using provider-specific paths
            const allStoreAssets = getStoreAssets();
            const storeAsset = allStoreAssets.find(
              a => a.name === change.assetName && a.type === change.assetType
            );
            if (storeAsset) {
              const skillMainOnly = change.assetType === 'skill' && !fullSkillFolder;
              copyStoreAssetToProject(
                project.path,
                change.provider,
                change.assetType,
                change.assetName,
                { skillMainOnly },
              );
            } else {
              throw new Error(`Asset '${change.assetName}' not found in store`);
            }
          } else {
            // Deploy from master (existing behavior)
            const skillMainOnly = change.assetType === 'skill' && !fullSkillFolder;
            copyAsset(masterPath, project.path, change.assetType, change.assetName, { skillMainOnly });
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
