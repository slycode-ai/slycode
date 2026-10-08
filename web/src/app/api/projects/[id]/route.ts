import { NextResponse } from 'next/server';
import { mutateRegistry } from '@/lib/registry';
import { RegistryLockError } from '@/lib/registry-lock';
import { computeSessionKey } from '@/lib/session-keys';
import type { Project } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Whitelisted field edits (and sessionKey re-derivation on a path change). */
function applyProjectEdit(project: Project, body: Record<string, unknown>): void {
  // Update allowed fields
  if (body.name !== undefined) project.name = body.name as string;
  if (body.description !== undefined) project.description = body.description as string;
  const pathChanged = body.path !== undefined && body.path !== project.path;
  if (body.path !== undefined) project.path = body.path as string;
  if (body.tags !== undefined) project.tags = body.tags as string[];
  if (body.areas !== undefined) project.areas = body.areas as string[];
  if (body.hasClaudeMd !== undefined) project.hasClaudeMd = body.hasClaudeMd as boolean;
  if (body.masterCompliant !== undefined) project.masterCompliant = body.masterCompliant as boolean;

  // If path changed, sessionKey is stale. Recompute from the new path and
  // archive the previous sessionKey as an alias so sessions already created
  // under the old key still resolve during the transition.
  if (pathChanged) {
    const oldKey = project.sessionKey;
    const newKey = computeSessionKey(project.path);
    if (oldKey !== newKey) {
      const existingAliases = project.sessionKeyAliases ?? [];
      const aliasSet = new Set(existingAliases);
      if (oldKey) aliasSet.add(oldKey);
      // Drop the new key from aliases if it was previously the project.id form
      aliasSet.delete(newKey);
      project.sessionKey = newKey;
      project.sessionKeyAliases = Array.from(aliasSet);
    }
  }
}

/**
 * PUT /api/projects/[id] - Update project fields
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    // Fresh read → edit → atomic write under the registry lock (#0381).
    const project = await mutateRegistry((registry) => {
      const found = registry.projects.find((p) => p.id === id);
      if (!found) return null;
      applyProjectEdit(found, body);
      return found;
    });
    if (!project) {
      return NextResponse.json(
        { error: `Project '${id}' not found` },
        { status: 404 }
      );
    }

    return NextResponse.json(project);
  } catch (error) {
    if (error instanceof RegistryLockError) return NextResponse.json({ error: error.message }, { status: 503 });
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
    const removed = await mutateRegistry((registry) => {
      const projectIdx = registry.projects.findIndex((p) => p.id === id);
      return projectIdx === -1 ? null : registry.projects.splice(projectIdx, 1)[0];
    });
    if (!removed) {
      return NextResponse.json(
        { error: `Project '${id}' not found` },
        { status: 404 }
      );
    }

    return NextResponse.json({ removed });
  } catch (error) {
    if (error instanceof RegistryLockError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error('Failed to delete project:', error);
    return NextResponse.json(
      { error: 'Failed to delete project', details: String(error) },
      { status: 500 }
    );
  }
}
