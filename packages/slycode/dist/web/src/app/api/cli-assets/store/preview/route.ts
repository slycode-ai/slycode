/**
 * Store Import Preview — GET /api/cli-assets/store/preview
 *
 * Lists files in a project skill directory so the user can see what would be imported.
 * Returns { files: string[] } with relative paths like ["SKILL.md", "references/area-index.md", ...]
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getProviderAssetFilePath } from '@/lib/provider-paths';
import { loadRegistry } from '@/lib/registry';
import type { ProviderId, AssetType } from '@/lib/types';

export const dynamic = 'force-dynamic';

function listFilesRecursive(dir: string, base: string = ''): string[] {
  const files: string[] = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

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

    const registry = await loadRegistry();
    const project = registry.projects.find(p => p.id === sourceProjectId);
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const assetPath = getProviderAssetFilePath(project.path, provider, assetType, assetName);
    if (!assetPath || !fs.existsSync(assetPath)) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
    }

    // For skills (directories), list all files
    // For agents (single files), just return the filename
    if (assetType === 'skill' && fs.statSync(assetPath).isDirectory()) {
      const files = listFilesRecursive(assetPath);
      return NextResponse.json({ files, isDirectory: true });
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
