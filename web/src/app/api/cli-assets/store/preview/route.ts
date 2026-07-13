/**
 * Store Import Preview — GET /api/cli-assets/store/preview
 *
 * For skills, returns a per-file diff manifest comparing the project copy
 * (incoming) against the canonical store copy (current): each file carries a
 * status (identical/changed/added/removed), and previewable text files carry
 * their content for a line diff. See buildStoreImportManifest.
 *
 * For agents (single files), returns the legacy { files, isDirectory } shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getProviderAssetFilePath } from '@/lib/provider-paths';
import { buildStoreImportManifest } from '@/lib/asset-scanner';
import { loadRegistry } from '@/lib/registry';
import { validateAssetName } from '@/lib/asset-path-guard';
import type { ProviderId, AssetType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get('provider') as ProviderId;
    const assetType = searchParams.get('assetType') as AssetType;
    const assetName = searchParams.get('assetName');
    const sourceProjectId = searchParams.get('sourceProjectId');

    if (!provider || !assetType || !assetName || !sourceProjectId) {
      return NextResponse.json(
        { error: 'provider, assetType, assetName, and sourceProjectId are required' },
        { status: 400 },
      );
    }

    if (!validateAssetName(assetName)) {
      return NextResponse.json({ error: 'Invalid asset name' }, { status: 400 });
    }

    const registry = await loadRegistry();
    const project = registry.projects.find(p => p.id === sourceProjectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const assetPath = getProviderAssetFilePath(project.path, provider, assetType, assetName);
    if (!assetPath || !fs.existsSync(assetPath)) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // For skills (directories), return the full per-file diff manifest.
    // For agents (single files), keep the legacy filename listing.
    if (assetType === 'skill' && fs.statSync(assetPath).isDirectory()) {
      const manifest = buildStoreImportManifest(project.path, provider, assetName);
      return NextResponse.json(manifest);
    } else {
      return NextResponse.json({ files: [path.basename(assetPath)], isDirectory: false });
    }
  } catch (error) {
    console.error('Store preview failed:', error);
    return NextResponse.json(
      { error: 'Failed to preview', details: String(error) },
      { status: 500 },
    );
  }
}
