import { NextResponse } from 'next/server';
import { loadRegistry, saveRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/reorder - Reorder projects
 * Body: { projectIds: string[] } - ordered array of project IDs
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectIds } = body;

    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json(
        { error: 'projectIds must be a non-empty array' },
        { status: 400 }
      );
    }

    const registry = await loadRegistry();

    // Assign order values based on position in the submitted array
    for (let i = 0; i < projectIds.length; i++) {
      const project = registry.projects.find((p) => p.id === projectIds[i]);
      if (project) {
        project.order = i;
      }
    }

    registry.lastUpdated = new Date().toISOString();
    await saveRegistry(registry);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to reorder projects:', error);
    return NextResponse.json(
      { error: 'Failed to reorder projects', details: String(error) },
      { status: 500 }
    );
  }
}
