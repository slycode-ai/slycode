/**
 * GET  /api/atlas/artifacts?projectId=<id>  → full atlas snapshot
 *      (root + nodes + deterministic freshness/churn for fog-of-war)
 * PATCH /api/atlas/artifacts  { projectId, areaId, name?, pinned? }
 *      → the single web-side mutation: user renames/pins an area.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';
import { loadAtlasSnapshot, updateArea } from '@/lib/atlas/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const snapshot = await loadAtlasSnapshot(project.root);
    return NextResponse.json(snapshot);
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/artifacts] failed:', error);
    return NextResponse.json({ error: 'Failed to load atlas' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const project = await resolveProject(body.projectId ?? null);
    if (typeof body.areaId !== 'string') {
      return NextResponse.json({ error: 'areaId required' }, { status: 400 });
    }
    const patch: { name?: string; pinned?: boolean } = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
    if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
    const result = await updateArea(project.root, body.areaId, patch);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/artifacts] patch failed:', error);
    return NextResponse.json({ error: 'Failed to update area' }, { status: 500 });
  }
}
