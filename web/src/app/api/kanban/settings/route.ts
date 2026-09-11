import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import type { KanbanBoard } from '@/lib/types';
import { getKanbanPath, ProjectResolutionError } from '@/lib/kanban-paths';
import { withBoardLock } from '@/lib/board-lock';
import { readBoardSettings, validateSettingsPatch, writeBoardSettings } from '@/lib/kanban-settings';

/**
 * Board settings (feature #0350).
 *
 *   GET /api/kanban/settings?projectId=<id>   → { settings }
 *   PUT /api/kanban/settings?projectId=<id>   body: { allowCrossProjectPrompts: boolean }
 *
 * This is the ONLY write surface for the project-owned policy block — the CLI
 * deliberately has no setter, so an agent refused by the cross-project gate
 * cannot flip the flag from a terminal.
 */

function projectIdFrom(request: NextRequest): string | null {
  return new URL(request.url).searchParams.get('projectId');
}

function resolutionError(error: unknown): NextResponse | null {
  if (error instanceof ProjectResolutionError) {
    return NextResponse.json({ error: error.message }, { status: error.code === 'NOT_FOUND' ? 404 : 400 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const projectId = projectIdFrom(request);
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });
  try {
    const kanbanPath = await getKanbanPath(projectId);
    let board: KanbanBoard | null = null;
    try {
      board = JSON.parse(await fs.readFile(kanbanPath, 'utf-8')) as KanbanBoard;
    } catch {
      // No board yet — every setting reads as off.
    }
    return NextResponse.json({ settings: readBoardSettings(board) });
  } catch (error) {
    return resolutionError(error) ?? NextResponse.json({ error: 'Failed to read settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const projectId = projectIdFrom(request);
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const validated = validateSettingsPatch(body);
  if ('error' in validated) return NextResponse.json({ error: validated.error }, { status: 400 });

  try {
    const kanbanPath = await getKanbanPath(projectId);
    const settings = await withBoardLock(kanbanPath, () => writeBoardSettings(kanbanPath, validated.patch));
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    const resolved = resolutionError(error);
    if (resolved) return resolved;
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'This project has no kanban board yet' }, { status: 404 });
    }
    console.error('[kanban/settings] write failed:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
