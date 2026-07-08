import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import type { KanbanBoard, KanbanCard, KanbanStages } from '@/lib/types';
import { appendEvent } from '@/lib/event-log';
import { getKanbanPath, ProjectResolutionError } from '@/lib/kanban-paths';
import { ensureCardNumbers } from '@/lib/kanban-numbering';
import { atomicWriteFile } from '@/lib/atomic-write';
import { withBoardLock } from '@/lib/board-lock';

// Eager card creation endpoint.
//
// Why this exists separately from the full-board POST /api/kanban:
// the typed-merge path there silently drops cards tagged "move" that aren't
// on disk yet (route.ts:331-334). When the user creates a card optimistically
// and then drags it within the 2s save debounce, the move tag wins and the
// card is dropped. By persisting the card synchronously here BEFORE the
// frontend lets the user interact with it, the move-during-debounce path
// always finds a real disk record and the silent-drop branch never fires.

const EMPTY_STAGES: KanbanStages = {
  backlog: [],
  design: [],
  implementation: [],
  testing: [],
  done: [],
};

type NewCardInput = Partial<Omit<KanbanCard, 'id' | 'order' | 'created_at' | 'updated_at' | 'last_modified_by' | 'number'>> & {
  title: string;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, card } = body as { projectId: string; card: NewCardInput };

    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }
    if (!card || typeof card !== 'object') {
      return NextResponse.json({ error: 'card object required' }, { status: 400 });
    }
    if (typeof card.title !== 'string' || !card.title.trim()) {
      return NextResponse.json({ error: 'card.title required' }, { status: 400 });
    }

    let kanbanPath: string;
    try {
      kanbanPath = await getKanbanPath(projectId);
    } catch (error) {
      if (error instanceof ProjectResolutionError) {
        return NextResponse.json({ error: error.message }, { status: 404 });
      }
      throw error;
    }

    // Advisory lock around the read-modify-write (feature 077, best-effort —
    // shared with the CLI, kanban POST, and scheduler).
    return await withBoardLock(kanbanPath, async () => {

    let board: KanbanBoard;
    try {
      const content = await fs.readFile(kanbanPath, 'utf-8');
      board = JSON.parse(content) as KanbanBoard;
      if (!board.stages) board.stages = { ...EMPTY_STAGES };
    } catch {
      board = {
        project_id: projectId,
        stages: { ...EMPTY_STAGES },
        last_updated: new Date().toISOString(),
      };
    }

    const backlog = board.stages.backlog || [];
    const order = backlog.length > 0
      ? Math.max(...backlog.map((c) => c.order)) + 10
      : 10;

    const now = new Date().toISOString();
    // Random suffix prevents id collisions when two tabs/machines fire
    // creates within the same millisecond.
    const id = `card-${Date.now()}-${randomBytes(2).toString('hex')}`;

    const newCard: KanbanCard = {
      id,
      title: card.title.trim(),
      description: card.description ?? '',
      type: card.type ?? 'feature',
      priority: card.priority ?? 'medium',
      order,
      areas: card.areas ?? [],
      tags: card.tags ?? [],
      problems: card.problems ?? [],
      checklist: card.checklist ?? [],
      created_at: now,
      updated_at: now,
      last_modified_by: 'web',
      ...(card.automation ? { automation: card.automation } : {}),
    };

    board.project_id = projectId;
    board.stages = { ...board.stages, backlog: [...backlog, newCard] };
    board.last_updated = now;
    ensureCardNumbers(board);

    await fs.mkdir(path.dirname(kanbanPath), { recursive: true });
    await atomicWriteFile(kanbanPath, JSON.stringify(board, null, 2));

    try {
      appendEvent({
        type: 'card_created',
        project: projectId,
        card: newCard.id,
        detail: `Card '${newCard.title}' created in backlog`,
        source: 'web',
        timestamp: now,
      });
    } catch {
      // Non-critical; surfaced via logs in appendEvent itself.
    }

    // Return the persisted card. The number was assigned by ensureCardNumbers,
    // so we read it back from the board (the same object reference is mutated).
    const persisted = (board.stages.backlog || []).find((c) => c.id === id) ?? newCard;
    return NextResponse.json({ card: persisted });

    }); // end withBoardLock
  } catch (error) {
    console.error('Failed to create card:', error);
    return NextResponse.json({ error: 'Failed to create card' }, { status: 500 });
  }
}
