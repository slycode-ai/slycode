import { NextResponse } from 'next/server';
import { loadRegistry, saveRegistry } from '@/lib/registry';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PUT /api/projects/[id] - Update project fields
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const registry = await loadRegistry();

    const projectIdx = registry.projects.findIndex((p) => p.id === id);
    if (projectIdx === -1) {
      return NextResponse.json(
        { error: `Project '${id}' not found` },
        { status: 404 }
      );
    }

    const project = registry.projects[projectIdx];

    // Update allowed fields
    if (body.name !== undefined) project.name = body.name;
    if (body.description !== undefined) project.description = body.description;
    if (body.path !== undefined) project.path = body.path;
    if (body.tags !== undefined) project.tags = body.tags;
    if (body.areas !== undefined) project.areas = body.areas;
    if (body.hasClaudeMd !== undefined) project.hasClaudeMd = body.hasClaudeMd;
    if (body.masterCompliant !== undefined) project.masterCompliant = body.masterCompliant;

    registry.lastUpdated = new Date().toISOString();
    await saveRegistry(registry);

    return NextResponse.json(project);
  } catch (error) {
    console.error('Failed to update project:', error);
    return NextResponse.json(
      { error: 'Failed to update project', details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projects/[id] - Remove project from registry
 */
export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const registry = await loadRegistry();

    const projectIdx = registry.projects.findIndex((p) => p.id === id);
    if (projectIdx === -1) {
      return NextResponse.json(
        { error: `Project '${id}' not found` },
        { status: 404 }
      );
    }

    const removed = registry.projects.splice(projectIdx, 1)[0];
    registry.lastUpdated = new Date().toISOString();
    await saveRegistry(registry);

    return NextResponse.json({ removed });
  } catch (error) {
    console.error('Failed to delete project:', error);
    return NextResponse.json(
      { error: 'Failed to delete project', details: String(error) },
      { status: 500 }
    );
  }
}
