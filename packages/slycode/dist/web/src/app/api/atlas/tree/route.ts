/**
 * GET /api/atlas/tree?projectId=<id>
 *
 * Project file tree for the Code Mode explorer. Respects .gitignore via
 * `git ls-files`; falls back to a bounded fs walk for non-git projects.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, buildTree, AtlasPathError } from '@/lib/atlas/fs-utils';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const tree = await buildTree(project.root);
    return NextResponse.json({ tree });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/tree] failed:', error);
    return NextResponse.json({ error: 'Failed to build tree' }, { status: 500 });
  }
}
