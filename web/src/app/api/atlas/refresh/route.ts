/**
 * Atlas refresh control (feature 076).
 *
 * GET  /api/atlas/refresh?projectId=<id>      → config
 * PUT  /api/atlas/refresh  { projectId, enabled?, schedule? }
 * POST /api/atlas/refresh  { projectId }      → run the refresh NOW
 *   (start-or-resume the Atlas terminal session + verified-submit the skill
 *   prompt — same primitive the scheduler's nightly atlas scan uses).
 */

import { NextRequest, NextResponse } from 'next/server';
import { Cron } from 'croner';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';
import { kickoffAtlasRefresh, readAtlasConfig, writeAtlasConfig } from '@/lib/atlas/refresh';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    return NextResponse.json({ config: await readAtlasConfig(project.root) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const project = await resolveProject(body.projectId ?? null);
    const config = await readAtlasConfig(project.root);
    if (typeof body.enabled === 'boolean') config.enabled = body.enabled;
    if (typeof body.schedule === 'string' && body.schedule.trim()) {
      const schedule = body.schedule.trim();
      try {
        new Cron(schedule); // validate only — never scheduled
      } catch {
        return NextResponse.json({ error: `invalid cron expression: ${schedule}` }, { status: 400 });
      }
      config.schedule = schedule;
    }
    // provider/model: explicit null/'' = follow the global default (feature 073)
    if (body.provider === null || body.provider === '') config.provider = null;
    else if (typeof body.provider === 'string') config.provider = body.provider;
    if (body.model === null || body.model === '') config.model = null;
    else if (typeof body.model === 'string') config.model = body.model.trim();
    await writeAtlasConfig(project.root, config);
    return NextResponse.json({ config });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const project = await resolveProject(body.projectId ?? null);
    const result = await kickoffAtlasRefresh(project.id, project.root, 'manual');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ ok: true, sessionName: result.sessionName });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  if (error instanceof AtlasPathError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error('[atlas/refresh] failed:', error);
  return NextResponse.json({ error: 'Atlas refresh operation failed' }, { status: 500 });
}
