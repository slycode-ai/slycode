/**
 * CLI Assets API — GET /api/cli-assets
 *
 * Scans assets and builds cross-project matrix.
 * Uses flat canonical store (store/skills/) as the master source.
 * Provider param controls which provider directories are scanned in projects.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/registry';
import {
  scanProviderAssets,
  buildStoreAssetMatrix,
  findNonImportedForProvider,
  countOutdatedAssets,
} from '@/lib/asset-scanner';
import { scanStore, getStoreAssets } from '@/lib/store-scanner';
import type { ProviderId, AssetType, AssetInfo, CliAssetsData } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PROVIDERS: ProviderId[] = ['claude', 'agents', 'codex', 'gemini'];
const ASSET_TYPES: AssetType[] = ['skill', 'agent'];

export async function GET(request: NextRequest) {
  try {
    const registry = await loadRegistry();
    const provider = request.nextUrl.searchParams.get('provider') as ProviderId | null;

    // Always scan the flat canonical store
    const storeData = scanStore();

    // Use flat store assets as master source for all providers
    const storeAssets = getStoreAssets();
    const storeByType = new Map<AssetType, AssetInfo[]>();
    for (const type of ASSET_TYPES) {
      storeByType.set(type, storeAssets.filter(a => a.type === type));
    }

    // Determine which provider to scan in projects (default: claude)
    const activeProvider = (provider && PROVIDERS.includes(provider)) ? provider : 'claude';

    // All projects scanned with provider-specific paths
    const allProjects = registry.projects;
    const providerAssetsByType = new Map<AssetType, Map<string, AssetInfo[]>>();
    for (const type of ASSET_TYPES) {
      providerAssetsByType.set(type, new Map());
    }

    for (const project of allProjects) {
      const assets = scanProviderAssets(project.path, activeProvider);
      for (const type of ASSET_TYPES) {
        const typeAssets = assets.filter(a => a.type === type);
        providerAssetsByType.get(type)!.set(project.id, typeAssets);
      }
    }

    // Build matrix per type
    const skills = buildStoreAssetMatrix(
      storeByType.get('skill')!, providerAssetsByType.get('skill')!, allProjects, 'skill'
    );
    const agents = buildStoreAssetMatrix(
      storeByType.get('agent')!, providerAssetsByType.get('agent')!, allProjects, 'agent'
    );

    // Non-imported: in projects but not in store
    const nonImported = [
      ...findNonImportedForProvider(storeByType.get('skill')!, providerAssetsByType.get('skill')!, allProjects, 'skill'),
      ...findNonImportedForProvider(storeByType.get('agent')!, providerAssetsByType.get('agent')!, allProjects, 'agent'),
    ];

    const matrix: CliAssetsData = { skills, agents, nonImported };
    const totalOutdated = countOutdatedAssets(matrix);

    return NextResponse.json({
      ...matrix,
      totalOutdated,
      projects: allProjects.map(p => ({ id: p.id, name: p.name })),
      storeData,
      activeProvider,
    });
  } catch (error) {
    console.error('CLI assets scan failed:', error);
    return NextResponse.json(
      { error: 'Failed to scan CLI assets', details: String(error) },
      { status: 500 },
    );
  }
}
