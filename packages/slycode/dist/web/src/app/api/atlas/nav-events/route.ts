/**
 * GET /api/atlas/nav-events?projectId=<id>[&after=<ISO>]
 *
 * AI navigation directives (Phase 3). The sly-atlas CLI appends validated
 * events; the Code Mode UI polls with a timestamp cursor and renders new
 * ones (navigate / highlight / result deck). One-shot by design — the agent
 * is never in the interaction loop.
 *
 * The response carries `serverNow` so the client can seed its cursor from
 * the SERVER clock — events are stamped server-side (makeEvent in
 * scripts/atlas.js), and a browser clock running ahead would otherwise
 * silently drop every directive fired in the first N seconds of skew.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';
import { readNavEvents } from '@/lib/atlas/store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const events = await readNavEvents(project.root, searchParams.get('after') ?? undefined);
    return NextResponse.json({ events, serverNow: new Date().toISOString() });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/nav-events] failed:', error);
    return NextResponse.json({ error: 'Failed to read nav events' }, { status: 500 });
  }
}
