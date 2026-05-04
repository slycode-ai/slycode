import { NextRequest, NextResponse } from 'next/server';
import { resolveProjectRoot, ProjectResolutionError, getKanbanPath } from '@/lib/kanban-paths';
import { promises as fs } from 'fs';
import {
  loadQuestionnaire,
  resolveQuestionnaireAbsPath,
  getAnsweredCounts,
  QuestionnaireValidationError,
} from '@/lib/questionnaire';
import type { KanbanCard, KanbanBoard } from '@/lib/types';

/**
 * GET /api/questionnaire/[projectId]?cardId=xxx
 *
 * Returns a list of attached questionnaires for the given card with
 * metadata (name, title, status, counts) — used by the index view.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await context.params;
  const { searchParams } = new URL(req.url);
  const cardId = searchParams.get('cardId');
  if (!cardId) {
    return NextResponse.json({ error: '"cardId" required' }, { status: 400 });
  }

  let projectRoot: string;
  try {
    projectRoot = await resolveProjectRoot(projectId);
  } catch (err) {
    if (err instanceof ProjectResolutionError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  const kanbanPath = await getKanbanPath(projectId);
  let board: KanbanBoard;
  try {
    const raw = await fs.readFile(kanbanPath, 'utf-8');
    board = JSON.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to read kanban: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    );
  }

  let card: KanbanCard | null = null;
  for (const stage of Object.keys(board.stages || {}) as Array<keyof typeof board.stages>) {
    const found = (board.stages[stage] || []).find((c) => c.id === cardId);
    if (found) {
      card = found;
      break;
    }
  }
  if (!card) {
    return NextResponse.json({ error: `Card ${cardId} not found` }, { status: 404 });
  }

  const refs = card.questionnaire_refs || [];
  const items: Array<{
    ref: string;
    name?: string;
    title?: string;
    status?: string;
    answered?: number;
    answerable?: number;
    requiredMissing?: number;
    error?: string;
  }> = [];

  for (const ref of refs) {
    try {
      const abs = resolveQuestionnaireAbsPath(projectRoot, ref);
      const q = await loadQuestionnaire(abs);
      const counts = getAnsweredCounts(q);
      items.push({
        ref,
        name: q.name,
        title: q.title,
        status: q.status,
        answered: counts.answered,
        answerable: counts.answerable,
        requiredMissing: counts.requiredMissing,
      });
    } catch (err) {
      items.push({
        ref,
        error:
          err instanceof QuestionnaireValidationError
            ? err.message
            : (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? 'File not found'
            : err instanceof Error
            ? err.message
            : 'Unknown error',
      });
    }
  }

  return NextResponse.json({ items });
}
