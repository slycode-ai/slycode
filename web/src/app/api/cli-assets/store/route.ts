/**
 * Store API — GET/POST/DELETE /api/cli-assets/store
 *
 * GET: Returns flat canonical store contents
 * POST: Import an asset from a project into the flat store
 * DELETE: Remove an asset from the flat store
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { scanStore } from '@/lib/store-scanner';
import { importAssetToStore } from '@/lib/asset-scanner';
import { getSlycodeRoot } from '@/lib/paths';
import { loadRegistry } from '@/lib/registry';
import { appendEvent } from '@/lib/event-log';
import { validateAssetName, safeAssetJoin } from '@/lib/asset-path-guard';
import type { ProviderId, AssetType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storeData = scanStore();
    return NextResponse.json(storeData);
  } catch (error) {
    console.error('Store scan failed:', error);
    return NextResponse.json(
      { error: 'Failed to scan store', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { provider, assetType, assetName, sourceProjectId, skillMainOnly } = body as {
      provider: ProviderId;
      assetType: AssetType;
      assetName: string;
      sourceProjectId?: string;
      skillMainOnly?: boolean;
    };

    if (!provider || !assetType || !assetName) {
      return NextResponse.json(
        { error: 'provider, assetType, and assetName are required' },
        { status: 400 },
      );
    }

    if (!validateAssetName(assetName)) {
      return NextResponse.json({ error: 'Invalid asset name' }, { status: 400 });
    }

    // Resolve the source project via the registry ONLY. A body-supplied
    // projectPath was previously trusted here — that let a caller read from any
    // directory (arbitrary-file-copy). Source now must be a known project id.
    if (!sourceProjectId) {
      return NextResponse.json(
        { error: 'sourceProjectId is required' },
        { status: 400 },
      );
    }
    const registry = await loadRegistry();
    const project = registry.projects.find(p => p.id === sourceProjectId);
    if (!project) {
      return NextResponse.json(
        { error: `Source project '${sourceProjectId}' not found` },
        { status: 404 },
      );
    }
    const resolvedPath = project.path;

    // Import to flat canonical store (provider only used for source project path)
    importAssetToStore(resolvedPath, provider, assetType, assetName, {
      skillMainOnly: skillMainOnly ?? true,
    });

    appendEvent({
      type: 'skill_imported',
      project: sourceProjectId || 'unknown',
      detail: `Imported ${assetType} '${assetName}' to store`,
      timestamp: new Date().toISOString(),
    });

    const storeData = scanStore();
    return NextResponse.json({ success: true, storeData });
  } catch (error) {
    console.error('Store import failed:', error);
    return NextResponse.json(
      { error: 'Failed to import to store', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetType, assetName } = body as {
      assetType: AssetType;
      assetName: string;
    };

    if (!assetType || !assetName) {
      return NextResponse.json(
        { error: 'assetType and assetName are required' },
        { status: 400 },
      );
    }

    if (!validateAssetName(assetName)) {
      return NextResponse.json({ error: 'Invalid asset name' }, { status: 400 });
    }

    const root = getSlycodeRoot();

    // safeAssetJoin re-validates the name AND confirms the resolved path stays
    // inside the store subtree — a null return means an escape attempt, so we
    // reject before any fs.rmSync/unlinkSync can touch a sibling directory.
    if (assetType === 'skill') {
      const assetPath = safeAssetJoin(path.join(root, 'store', 'skills'), assetName);
      if (!assetPath) {
        return NextResponse.json({ error: 'Invalid asset name' }, { status: 400 });
      }
      if (fs.existsSync(assetPath)) {
        fs.rmSync(assetPath, { recursive: true, force: true });
      }
    } else if (assetType === 'mcp') {
      const jsonPath = safeAssetJoin(path.join(root, 'store', 'mcp'), `${assetName}.json`);
      if (!jsonPath) {
        return NextResponse.json({ error: 'Invalid asset name' }, { status: 400 });
      }
      if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
    } else {
      const mdPath = safeAssetJoin(path.join(root, 'store', 'agents'), `${assetName}.md`);
      if (!mdPath) {
        return NextResponse.json({ error: 'Invalid asset name' }, { status: 400 });
      }
      if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);
    }

    appendEvent({
      type: 'skill_removed',
      project: 'store',
      detail: `Deleted ${assetType} '${assetName}' from store`,
      timestamp: new Date().toISOString(),
    });

    const storeData = scanStore();
    return NextResponse.json({ success: true, storeData });
  } catch (error) {
    console.error('Store delete failed:', error);
    return NextResponse.json(
      { error: 'Failed to delete from store', details: String(error) },
      { status: 500 },
    );
  }
}
