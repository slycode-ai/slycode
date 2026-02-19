/**
 * CLI Assets Import API — POST /api/cli-assets/import
 *
 * Import an asset from a project into the SlyCode workspace.
 * Accepts { assetName, assetType, sourceProjectId }.
 * Copies the asset file(s) into the workspace's .claude/ directory.
 */

import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry, getRepoRoot } from '@/lib/registry';
import {
  copyAsset,
  parseFrontmatter,
  validateFrontmatter,
  getAssetPath,
} from '@/lib/asset-scanner';
import { appendEvent } from '@/lib/event-log';
import type { AssetType } from '@/lib/types';
import fs from 'fs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetName, assetType, sourceProjectId } = body as {
      assetName: string;
      assetType: AssetType;
      sourceProjectId: string;
    };

    if (!assetName || !assetType || !sourceProjectId) {
      return NextResponse.json(
        { error: 'assetName, assetType, and sourceProjectId are required' },
        { status: 400 },
      );
    }

    if (!['skill', 'agent', 'mcp'].includes(assetType)) {
      return NextResponse.json(
        { error: 'assetType must be skill, agent, or mcp' },
        { status: 400 },
      );
    }

    const registry = await loadRegistry();
    const sourceProject = registry.projects.find(p => p.id === sourceProjectId);
    const masterPath = getRepoRoot();

    if (!sourceProject) {
      return NextResponse.json(
        { error: `Source project '${sourceProjectId}' not found` },
        { status: 404 },
      );
    }

    // Copy asset from source project to workspace
    copyAsset(sourceProject.path, masterPath, assetType, assetName);

    // Read the imported asset to check its frontmatter validity
    const importedPath = getAssetPath(masterPath, assetType, assetName);
    let isValid = false;
    let frontmatter = null;

    try {
      const filePath = assetType === 'skill'
        ? `${importedPath}/SKILL.md`
        : importedPath;

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        frontmatter = parseFrontmatter(content);
        isValid = validateFrontmatter(frontmatter);
      }
    } catch {
      // Non-critical — frontmatter check is informational
    }

    // Emit event
    appendEvent({
      type: 'skill_imported',
      project: path.basename(masterPath),
      detail: `Imported ${assetType} '${assetName}' from ${sourceProject.name}`,
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      asset: {
        name: assetName,
        type: assetType,
        source: sourceProjectId,
        frontmatter,
        isValid,
      },
    });
  } catch (error) {
    console.error('CLI assets import failed:', error);
    return NextResponse.json(
      { error: 'Failed to import asset', details: String(error) },
      { status: 500 },
    );
  }
}
