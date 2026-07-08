/**
 * GET /api/atlas/git?projectId=<id>&op=<status|diff|log|blame|churn>[&path=<file>]
 *
 * Git lens for Code Mode. Read-only; non-git projects return isRepo:false
 * for status and empty results elsewhere so the UI degrades gracefully.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, containedPath, AtlasPathError } from '@/lib/atlas/fs-utils';
import { gitStatus, gitDiff, gitLog, gitBlame, gitChurn, gitShow, gitBranches, gitSwitchBranch } from '@/lib/atlas/git';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const op = searchParams.get('op') ?? 'status';
    const relPath = searchParams.get('path') ?? undefined;
    // Containment check on any user-supplied path (result unused — throw-only).
    if (relPath) containedPath(project.root, relPath);

    switch (op) {
      case 'status':
        return NextResponse.json(await gitStatus(project.root));
      case 'diff':
        return NextResponse.json({ diff: await gitDiff(project.root, relPath) });
      case 'log':
        return NextResponse.json({ entries: await gitLog(project.root, relPath) });
      case 'blame': {
        if (!relPath) return NextResponse.json({ error: 'path required' }, { status: 400 });
        return NextResponse.json({ lines: await gitBlame(project.root, relPath) });
      }
      case 'churn':
        return NextResponse.json({ churn: await gitChurn(project.root) });
      case 'show': {
        const ref = searchParams.get('ref');
        if (!ref) return NextResponse.json({ error: 'ref required' }, { status: 400 });
        return NextResponse.json({ diff: await gitShow(project.root, ref, relPath) });
      }
      case 'branches':
        return NextResponse.json(await gitBranches(project.root));
      default:
        return NextResponse.json({ error: 'Unknown op' }, { status: 400 });
    }
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/git] failed:', error);
    return NextResponse.json({ error: 'Git operation failed' }, { status: 500 });
  }
}

/** POST — branch mutations: { projectId, op: 'checkout'|'create-branch', branch } */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const project = await resolveProject(body.projectId ?? null);
    const branch = typeof body.branch === 'string' ? body.branch.trim() : '';
    if (!branch) return NextResponse.json({ error: 'branch required' }, { status: 400 });
    if (body.op !== 'checkout' && body.op !== 'create-branch') {
      return NextResponse.json({ error: 'Unknown op' }, { status: 400 });
    }
    const result = await gitSwitchBranch(project.root, branch, body.op === 'create-branch');
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json({ ok: true, branch });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/git] branch op failed:', error);
    return NextResponse.json({ error: 'Branch operation failed' }, { status: 500 });
  }
}
