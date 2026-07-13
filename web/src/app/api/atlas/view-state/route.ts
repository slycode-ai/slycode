/**
 * POST /api/atlas/view-state  { projectId, action, areaId? }  (feature 079)
 *
 * The UI-owned deterministic side of the catch-up digest:
 *   enter          — Code Mode opened; seeds the digest anchor on first visit
 *   visit-area     — area scene viewed (comprehension-debt input)
 *   digest-read    — Mark read: advance the anchor to the digest's head commit
 *   digest-dismiss — hide the banner without advancing the anchor
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';
import { updateViewState, ViewStateAction } from '@/lib/atlas/store';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['enter', 'visit-area', 'digest-read', 'digest-dismiss']);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const project = await resolveProject(body.projectId ?? null);
    if (typeof body.action !== 'string' || !ACTIONS.has(body.action)) {
      return NextResponse.json({ error: 'action must be enter|visit-area|digest-read|digest-dismiss' }, { status: 400 });
    }
    let act: ViewStateAction;
    if (body.action === 'visit-area') {
      if (typeof body.areaId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(body.areaId)) {
        return NextResponse.json({ error: 'visit-area requires a valid areaId' }, { status: 400 });
      }
      act = { action: 'visit-area', areaId: body.areaId };
    } else {
      act = { action: body.action };
    }
    const state = await updateViewState(project.root, act);
    return NextResponse.json({ ok: true, viewState: state });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/view-state] failed:', error);
    return NextResponse.json({ error: 'Failed to update view state' }, { status: 500 });
  }
}
