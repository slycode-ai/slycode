import { NextResponse } from 'next/server';
import { loadRegistry, mutateRegistry } from '@/lib/registry';
import { RegistryLockError } from '@/lib/registry-lock';
import {
  createFolder, deleteFolder, FolderError, moveProjectToFolder, renameFolder, reorderFolders, sortedFolders,
} from '@/lib/project-folders';
import type { Registry } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Den folders (card #0381, feature 089 Phase B). All writes go through the
 * pure helpers in lib/project-folders.ts inside one mutateRegistry() each
 * (registry lock + fresh read + atomic write).
 *
 *   GET                                   → { folders, counts: {folderId: n} }
 *   POST   { name, projectId? }           → create (and optionally move a project in)
 *   PATCH  { id, name }                   → rename
 *   PATCH  { order: string[] }            → reorder folders
 *   PATCH  { projectId, folderId|null }   → move a project in/out of a folder
 *   DELETE ?id=<folderId>                 → delete; its projects become unfiled
 */

function payload(registry: Registry) {
  const folders = sortedFolders(registry.folders);
  const counts: Record<string, number> = {};
  for (const f of folders) counts[f.id] = registry.projects.filter(p => p.folderId === f.id).length;
  return { folders, counts };
}

function fail(error: unknown) {
  if (error instanceof FolderError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof RegistryLockError) return NextResponse.json({ error: error.message }, { status: 503 });
  console.error('Folder operation failed:', error);
  return NextResponse.json({ error: 'Folder operation failed' }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json(payload(await loadRegistry()));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; projectId?: unknown };
    const out = await mutateRegistry((registry) => {
      const folder = createFolder(registry, body.name);
      if (typeof body.projectId === 'string') moveProjectToFolder(registry, body.projectId, folder.id);
      return { folder, ...payload(registry) };
    });
    return NextResponse.json(out);
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      id?: unknown; name?: unknown; order?: unknown; projectId?: unknown; folderId?: unknown;
    };
    const out = await mutateRegistry((registry) => {
      if (Array.isArray(body.order)) {
        reorderFolders(registry, body.order.filter((x): x is string => typeof x === 'string'));
      } else if (typeof body.projectId === 'string' && 'folderId' in body) {
        if (body.folderId !== null && typeof body.folderId !== 'string') throw new FolderError('folderId must be a string or null');
        moveProjectToFolder(registry, body.projectId, body.folderId as string | null);
      } else if (typeof body.id === 'string' && body.name !== undefined) {
        renameFolder(registry, body.id, body.name);
      } else {
        throw new FolderError('Expected { id, name }, { order }, or { projectId, folderId }');
      }
      return payload(registry);
    });
    return NextResponse.json(out);
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new FolderError('id is required');
    const out = await mutateRegistry((registry) => ({ unfiled: deleteFolder(registry, id), ...payload(registry) }));
    return NextResponse.json(out);
  } catch (error) {
    return fail(error);
  }
}
