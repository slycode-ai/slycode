/**
 * GET /api/atlas/db?projectId=<id>  (feature 079)
 *
 * Deterministic database schema introspection (SQLite files, schema.prisma,
 * SQL DDL — via the shared scripts/db-introspect.js implementation, 60s
 * cached) paired with the AI annotations artifact (documentation/atlas/db.json,
 * written via `sly-atlas write-db`).
 */

import { NextRequest, NextResponse } from 'next/server';
import { resolveProject, AtlasPathError } from '@/lib/atlas/fs-utils';
import { loadDbIntrospection, loadDbAnnotations } from '@/lib/atlas/db-schema';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const project = await resolveProject(searchParams.get('projectId'));
    const [introspection, annotations] = await Promise.all([
      loadDbIntrospection(project.root),
      loadDbAnnotations(project.root),
    ]);
    return NextResponse.json({ introspection, annotations });
  } catch (error) {
    if (error instanceof AtlasPathError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[atlas/db] failed:', error);
    return NextResponse.json({ error: 'Failed to introspect database sources' }, { status: 500 });
  }
}
