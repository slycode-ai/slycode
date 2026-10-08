import { NextResponse } from 'next/server';
import { mutateRegistry } from '@/lib/registry';
import { RegistryLockError } from '@/lib/registry-lock';
import { FolderError, moveProjectToFolder } from '@/lib/project-folders';

export const dynamic = 'force-dynamic';

/**
 * POST /api/projects/reorder - Reorder projects
 * Body: { projectIds: string[], move?: { projectId, folderId: string|null } }
 * `move` (#0381 Phase B) sets a dragged project's folder in the same write as
 * the new order, so a drop into another folder is one atomic change.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { projectIds, move } = body as { projectIds?: unknown; move?: { projectId?: unknown; folderId?: unknown } };

    if (!Array.isArray(projectIds) || projectIds.length === 0) {
      return NextResponse.json(
        { error: 'projectIds must be a non-empty array' },
        { status: 400 }
      );
    }

    // Fresh read → reorder (+ optional folder move) → atomic write under the
    // registry lock (#0381): never saves a stale snapshot over a concurrent
    // status or folder change.
    await mutateRegistry((registry) => {
      if (move && typeof move.projectId === 'string' && (move.folderId === null || typeof move.folderId === 'string')) {
        moveProjectToFolder(registry, move.projectId, move.folderId as string | null);
      }
      // Assign order values based on position in the submitted array
      for (let i = 0; i < projectIds.length; i++) {
        const project = registry.projects.find((p) => p.id === projectIds[i]);
        if (project) {
          project.order = i;
        }
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RegistryLockError) return NextResponse.json({ error: error.message }, { status: 503 });
    if (error instanceof FolderError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Failed to reorder projects:', error);
    return NextResponse.json(
      { error: 'Failed to reorder projects', details: String(error) },
      { status: 500 }
    );
  }
}
