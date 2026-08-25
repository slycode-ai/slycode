/**
 * Deploy Plan API — POST /api/cli-assets/sync/plan (feature 084)
 *
 * Read-only twin of POST /api/cli-assets/sync: resolves each PendingChange
 * exactly the way sync does (shared sync-resolve) and returns per-target,
 * per-file deploy fates computed against each project's actual on-disk state.
 * Never writes. The DeployReviewModal renders this before the user confirms.
 */

import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry, getRepoRoot } from '@/lib/registry';
import { planStoreAssetDeploy, planMasterAssetDeploy, getAssetPath } from '@/lib/asset-scanner';
import { getProviderAssetFilePath } from '@/lib/provider-paths';
import { createSyncContext, resolveChange } from '@/lib/sync-resolve';
import type { PendingChange, DeployTargetPlan, DeployPlanResponse } from '@/lib/types';
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
    const ctx = createSyncContext(registry.projects, masterPath);

    const targets: DeployTargetPlan[] = [];

    for (const change of changes) {
      const resolved = resolveChange(change, ctx);
      if (!resolved.ok) {
        targets.push({
          change,
          projectName: ctx.projectMap.get(change.projectId)?.name ?? change.projectId,
          targetDir: '',
          exists: false,
          files: [],
          upToDate: false,
          error: resolved.error,
        });
        continue;
      }
      const { project } = resolved;

      try {
        if (change.assetType === 'mcp') {
          // JSON config merge — nothing file-level to preview
          targets.push({
            change,
            projectName: project.name,
            targetDir: '.mcp.json',
            exists: fs.existsSync(getAssetPath(project.path, 'mcp', change.assetName)),
            files: [],
            upToDate: false,
          });
          continue;
        }

        if (change.action === 'remove') {
          const abs = change.provider && change.provider !== 'claude'
            ? getProviderAssetFilePath(project.path, change.provider, change.assetType, change.assetName)
            : getAssetPath(project.path, change.assetType, change.assetName);
          targets.push({
            change,
            projectName: project.name,
            targetDir: abs ? path.relative(project.path, abs).split(path.sep).join('/') : '',
            exists: abs ? fs.existsSync(abs) : false,
            files: [],
            upToDate: false,
          });
          continue;
        }

        // Deploy (skill/agent): actual per-file fates against the target
        const plan = change.source === 'store' && change.provider
          ? planStoreAssetDeploy(project.path, change.provider, change.assetType, change.assetName)
          : planMasterAssetDeploy(masterPath, project.path, change.assetType, change.assetName);

        const upToDate = plan.files.length > 0 &&
          plan.files.every(f => f.fate === 'unchanged' || f.fate === 'keep' || f.fate === 'skipped');

        targets.push({
          change,
          projectName: project.name,
          targetDir: plan.targetDir,
          exists: plan.exists,
          files: plan.files,
          upToDate,
          conflict: resolved.newerConflict ?? undefined,
        });
      } catch (err) {
        targets.push({
          change,
          projectName: project.name,
          targetDir: '',
          exists: false,
          files: [],
          upToDate: false,
          error: String(err),
        });
      }
    }

    const response: DeployPlanResponse = { targets };
    return NextResponse.json(response);
  } catch (error) {
    console.error('CLI assets sync plan failed:', error);
    return NextResponse.json(
      { error: 'Failed to plan CLI assets sync', details: String(error) },
      { status: 500 },
    );
  }
}
