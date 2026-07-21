/**
 * Skill Status API — GET /api/skill-status?projectId=<id>
 *
 * Returns the freshness state of every shipped (manifest) skill for a single
 * project. Composes existing asset-scanner primitives — no new comparison
 * logic. Drives the per-project SkillUpdateToast.
 *
 * Watch list: all skills present in updates/skills/. That folder is the
 * manifest's faithful projection in both environments — build/sync-updates.ts
 * enforces build/store-manifest.js in the dev repo, and `slycode sync` mirrors
 * the (manifest-filtered) package templates in user workspaces, removing
 * anything unmanifested. The manifest file itself is not shipped in the npm
 * package, so it cannot be read directly here.
 */

import path from 'path';
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
import { hashSkillDir } from '@/lib/skill-dir-digest';
import type {
  AssetInfo,
  SkillStatusResponse,
  SkillUpdateStatus,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

function frontmatterVersion(asset: AssetInfo | undefined): string | null {
  const v = asset?.frontmatter?.version;
  return typeof v === 'string' ? v : null;
}

/**
 * Look up the version in updates/skills/<name>/SKILL.md after applying the
 * ignored-updates filter. If the upstream directory's digest matches what's
 * already been dismissed-or-accepted into the store, we treat the update as
 * absent for State A purposes — matches buildUpdatesMatrix behaviour (same
 * whole-directory digest, see skill-dir-digest.ts).
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

  try {
    const upstreamDir = path.join(getSlycodeRoot(), 'updates', 'skills', skillName);
    if (ignored[ignoreKey] === hashSkillDir(upstreamDir).digest) return null;
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

    // Watch every shipped skill (updates/skills/ mirrors the store manifest)
    const watchedSkills = updatesAssets
      .filter(a => a.type === 'skill')
      .map(a => a.name)
      .sort();

    const skills: SkillUpdateStatus[] = watchedSkills.map(name => {
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
