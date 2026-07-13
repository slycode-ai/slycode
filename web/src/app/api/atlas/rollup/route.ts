/**
 * GET /api/atlas/rollup  (feature 079)
 *
 * Workspace-level atlas rollup: one light summary per registered project —
 * overview snippet, area chips with staleness, coverage-ish stats, digest
 * headline. Read-only; per-project atlases stay the source of truth. 60s
 * cached (snapshot loading hashes every described file per project).
 */

import { NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/registry';
import { loadAtlasSnapshot } from '@/lib/atlas/store';

export const dynamic = 'force-dynamic';

export interface RollupArea {
  id: string;
  name: string;
  color?: string;
  summary?: string;
  stale: boolean;
}

export interface ProjectRollup {
  projectId: string;
  name: string;
  hasAtlas: boolean;
  overview?: string;
  updatedAt?: string;
  areas: RollupArea[];
  staleCount: number;
  tourCount: number;
  digestHeadline?: string;
  digestGeneratedAt?: string;
  error?: string;
}

const CACHE_KEY = '__slycode_atlas_rollup__';
function rollupCache(): { at: number; data: ProjectRollup[] } | null {
  return (globalThis as Record<string, unknown>)[CACHE_KEY] as { at: number; data: ProjectRollup[] } | null;
}

export async function GET() {
  try {
    const hit = rollupCache();
    if (hit && Date.now() - hit.at < 60_000) {
      return NextResponse.json({ projects: hit.data, cachedAt: hit.at });
    }
    const registry = await loadRegistry();
    const projects: ProjectRollup[] = [];
    for (const project of registry.projects) {
      try {
        const snap = await loadAtlasSnapshot(project.path);
        if (!snap.exists || !snap.root) {
          projects.push({ projectId: project.id, name: project.name, hasAtlas: false, areas: [], staleCount: 0, tourCount: 0 });
          continue;
        }
        const areas: RollupArea[] = snap.root.areas.map(a => {
          const fresh = snap.freshness[a.id];
          return { id: a.id, name: a.name, color: a.color, summary: a.summary, stale: !fresh || !fresh.hasNode || fresh.stale };
        });
        projects.push({
          projectId: project.id,
          name: project.name,
          hasAtlas: true,
          overview: snap.root.project_overview,
          updatedAt: snap.root.updated_at,
          areas,
          staleCount: areas.filter(a => a.stale).length,
          tourCount: snap.tours?.length ?? 0,
          digestHeadline: snap.digest?.headline,
          digestGeneratedAt: snap.digest?.generated_at,
        });
      } catch (e) {
        projects.push({
          projectId: project.id, name: project.name, hasAtlas: false, areas: [],
          staleCount: 0, tourCount: 0, error: String((e as Error).message ?? e),
        });
      }
    }
    (globalThis as Record<string, unknown>)[CACHE_KEY] = { at: Date.now(), data: projects };
    return NextResponse.json({ projects });
  } catch (error) {
    console.error('[atlas/rollup] failed:', error);
    return NextResponse.json({ error: 'Failed to build rollup' }, { status: 500 });
  }
}
