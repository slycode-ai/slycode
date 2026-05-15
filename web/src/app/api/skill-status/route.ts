/**
 * Skill Status API — GET /api/skill-status?projectId=<id>
 *
 * Returns the freshness state of the watched skills (kanban, messaging) for a
 * single project. Composes existing asset-scanner primitives — no new
 * comparison logic. Drives the per-project SkillUpdateToast.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/registry';
import {
  scanProviderAssets,
  scanUpdatesFolder,
  getIgnoredUpdates,
} from '@/lib/asset-scanner';
import { getStoreAssets } from '@/lib/store-scanner';
import { getSlycodeRoot } from '@/lib/paths';
import { decideSkillState } from '@/lib/skill-update-status';
import type {
  AssetInfo,
  SkillStatusResponse,
  SkillUpdateStatus,
  WatchedSkillName,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

const WATCHED_SKILLS: WatchedSkillName[] = ['kanban', 'messaging'];

function frontmatterVersion(asset: AssetInfo | undefined): string | null {
  const v = asset?.frontmatter?.version;
  return typeof v === 'string' ? v : null;
}

/**
 * Look up the version in updates/skills/<name>/SKILL.md after applying the
 * ignored-updates filter. If the upstream file's content hash matches what's
 * already been dismissed-or-accepted into the store, we treat the update as
 * absent for State A purposes — matches buildUpdatesMatrix behaviour.
 */
function getActiveUpdatesVersion(
  skillName: string,
  updatesAssets: AssetInfo[],
  ignored: Record<string, string>,
): string | null {
  const updateAsset = updatesAssets.find(a => a.name === skillName);
  if (!updateAsset) return null;

  const ignoreKey = `skills/${skillName}`;
  if (!ignored[ignoreKey]) {
    return frontmatterVersion(updateAsset);
  }

  // Compute current upstream hash; if it matches the dismissed/accepted hash,
  // this update isn't actionable any more. Hash impl matches
  // asset-scanner.ts:hashContent (SHA-256, 12 hex).
  try {
    const upstreamPath = path.join(getSlycodeRoot(), 'updates', 'skills', skillName, 'SKILL.md');
    const content = fs.readFileSync(upstreamPath, 'utf-8');
    const upstreamHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
    if (ignored[ignoreKey] === upstreamHash) return null;
    return frontmatterVersion(updateAsset);
  } catch {
    return frontmatterVersion(updateAsset);
  }
}

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }

    const registry = await loadRegistry();
    const project = registry.projects.find(p => p.id === projectId);
    if (!project) {
      return NextResponse.json({ error: 'project not found' }, { status: 404 });
    }

    const storeSkillAssets = getStoreAssets().filter(a => a.type === 'skill');
    const projectAssets = scanProviderAssets(project.path, 'claude');
    const updatesAssets = scanUpdatesFolder();
    const ignored = getIgnoredUpdates();

    const skills: SkillUpdateStatus[] = WATCHED_SKILLS.map(name => {
      const storeVersion = frontmatterVersion(storeSkillAssets.find(a => a.name === name));
      const projectVersion = frontmatterVersion(projectAssets.find(a => a.name === name));
      const updatesVersion = getActiveUpdatesVersion(name, updatesAssets, ignored);

      const { state, latestVersion } = decideSkillState({
        updatesVersion,
        storeVersion,
        projectVersion,
      });

      return {
        name,
        state,
        latestVersion,
        projectVersion,
      };
    });

    const response: SkillStatusResponse = { skills };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[skill-status] unexpected error:', error);
    return NextResponse.json({ error: 'internal error' }, { status: 500 });
  }
}
