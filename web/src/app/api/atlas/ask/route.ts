/**
 * POST /api/atlas/ask  { projectId, prompt }  (feature 079, test-review fix)
 *
 * Deliver a prompt to the project's Atlas session in ANY state — created if
 * missing, resumed if stopped, verified-submitted if running. Used by the
 * Code Mode flows that talk to the Atlas (create/refresh tour, ask-about-step,
 * ✦ Explain); the previous client-side submit-verified path hard-failed with
 * a 404 whenever no session was live.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';
import { deliverAtlasPrompt } from '@/lib/atlas/refresh';

export const dynamic = 'force-dynamic';

const MAX_PROMPT = 8000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const project = await resolveProject(body.projectId ?? null);
    if (typeof body.prompt !== 'string' || !body.prompt.trim()) {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 });
    }
    const result = await deliverAtlasPrompt(project.id, project.root, body.prompt.slice(0, MAX_PROMPT));
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true, sessionName: result.sessionName });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/ask] failed:', error);
    return NextResponse.json({ error: 'Failed to reach the Atlas session' }, { status: 500 });
  }
}
