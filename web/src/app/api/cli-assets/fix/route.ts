/**
 * Fix API — POST /api/cli-assets/fix
 *
 * Generates a compliance fix prompt for assets with missing or invalid frontmatter.
 * The prompt references the file by path — the terminal LLM reads it.
 */

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';
import { loadRegistry } from '@/lib/registry';
import { getProviderAssetFilePath } from '@/lib/provider-paths';
import { safeAssetJoin } from '@/lib/asset-path-guard';
import type { ProviderId, AssetType } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetName, assetType, provider, projectId } = body as {
      assetName: string;
      assetType: AssetType;
      provider: ProviderId;
      projectId?: string;
    };

    if (!assetName || !assetType || !provider) {
      return NextResponse.json(
        { error: 'assetName, assetType, and provider are required' },
        { status: 400 },
      );
    }

    const root = getSlycodeRoot();

    // Resolve the file path
    let assetPath = '';

    // First try the flat canonical store. safeAssetJoin validates assetName
    // and confirms containment inside store/<type> — reject traversal before
    // any fs access.
    const typeDir = assetType === 'skill' ? 'skills' : 'agents';
    const storeBase = path.join(root, 'store', typeDir);
    const storeAsset = safeAssetJoin(storeBase, assetType === 'skill' ? assetName : `${assetName}.md`);
    if (!storeAsset) {
      return NextResponse.json({ error: 'Invalid asset name' }, { status: 400 });
    }
    const storeFile = assetType === 'skill'
      ? path.join(storeAsset, 'SKILL.md')
      : storeAsset;

    if (fs.existsSync(storeFile)) {
      assetPath = storeFile;
    } else if (projectId) {
      const registry = await loadRegistry();
      const project = registry.projects.find(p => p.id === projectId);
      if (project) {
        const filePath = getProviderAssetFilePath(project.path, provider, assetType, assetName);
        if (filePath) {
          const actualPath = assetType === 'skill'
            ? path.join(filePath, 'SKILL.md')
            : filePath;
          if (fs.existsSync(actualPath)) {
            assetPath = actualPath;
          }
        }
      }
    }

    if (!assetPath) {
      return NextResponse.json(
        { error: `Could not find asset '${assetName}' (${assetType})` },
        { status: 404 },
      );
    }

    const prompt = buildFixPrompt(assetName, assetType, provider, assetPath);

    return NextResponse.json({ prompt, assetPath });
  } catch (error) {
    console.error('Fix prompt generation failed:', error);
    return NextResponse.json(
      { error: 'Failed to generate fix prompt', details: String(error) },
      { status: 500 },
    );
  }
}

function buildFixPrompt(
  assetName: string,
  assetType: AssetType,
  _provider: ProviderId,
  filePath: string,
): string {
  return `Fix the frontmatter compliance of this ${assetType} asset.

**File:** \`${filePath}\`

Read the file, then ensure it has a YAML frontmatter block (delimited by \`---\`) at the very top with ALL of these required fields:

\`\`\`yaml
---
name: ${assetName}
version: 1.0.0
updated: <today's date, YYYY-MM-DD>
description: "<one-line summary of what this ${assetType} does — infer from the content>"
---
\`\`\`

Rules:
- If frontmatter already exists, keep any valid fields and add the missing ones
- If no frontmatter exists, add the complete block at the top
- \`name\` must be \`${assetName}\`
- \`version\` should be \`1.0.0\` if not already set
- \`updated\` should be today's date
- \`description\` should be a concise summary inferred from the file content
- Do NOT modify the body content below the frontmatter

Write the corrected file back to \`${filePath}\`.`;
}
