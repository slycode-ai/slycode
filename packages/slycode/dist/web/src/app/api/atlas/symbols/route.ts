/**
 * GET /api/atlas/symbols?projectId=<id>[&q=<filter>][&path=<file>][&limit=200]
 *
 * Deterministic symbol index (tree-sitter, NO LSP) for the Symbols rail,
 * jump-to-definition, and the Phase-2 L3 file atlas.
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';
import { querySymbols } from '@/lib/symbol-index';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const result = await querySymbols(project.id, project.root, {
      q: searchParams.get('q') ?? undefined,
      file: searchParams.get('path') ?? undefined,
      limit: parseInt(searchParams.get('limit') ?? '200', 10) || 200,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/symbols] failed:', error);
    return NextResponse.json({ error: 'Symbol index failed' }, { status: 500 });
  }
}
