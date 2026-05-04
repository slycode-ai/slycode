import { NextRequest, NextResponse } from 'next/server';
import { resolveProjectRoot, ProjectResolutionError } from '@/lib/kanban-paths';
import { getKanbanPath } from '@/lib/kanban-paths';
import { promises as fs } from 'fs';
import {
  loadQuestionnaire,
  resolveQuestionnaireAbsPath,
  QuestionnaireValidationError,
} from '@/lib/questionnaire';
import type { KanbanCard, KanbanBoard } from '@/lib/types';

/** GET — read a questionnaire JSON attached to any card in the project. */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ projectId: string; name: string }> }
) {
  const { projectId, name } = await context.params;

  let projectRoot: string;
  try {
    projectRoot = await resolveProjectRoot(projectId);
  } catch (err) {
    if (err instanceof ProjectResolutionError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  const ref = await findQuestionnaireRef(projectId, name);
  if (!ref) {
    return NextResponse.json(
      { error: `No questionnaire named "${name}" attached to any card in project "${projectId}"` },
      { status: 404 }
    );
  }

  let absPath: string;
  try {
    absPath = resolveQuestionnaireAbsPath(projectRoot, ref);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Invalid path' },
      { status: 400 }
    );
  }

  try {
    const q = await loadQuestionnaire(absPath);
    return NextResponse.json({ questionnaire: q, ref });
  } catch (err) {
    if (err instanceof QuestionnaireValidationError) {
      return NextResponse.json({ error: err.message, ref }, { status: 422 });
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: `File not found: ${ref}`, ref }, { status: 404 });
    }
    throw err;
  }
}

/**
 * Find the first questionnaire ref across all cards in the project whose
 * loaded `name` field matches the requested name.
 */
async function findQuestionnaireRef(projectId: string, name: string): Promise<string | null> {
  const projectRoot = await resolveProjectRoot(projectId);
  const kanbanPath = await getKanbanPath(projectId);
  let board: KanbanBoard;
  try {
    const raw = await fs.readFile(kanbanPath, 'utf-8');
    board = JSON.parse(raw);
  } catch {
    return null;
  }
  const allCards: KanbanCard[] = [];
  for (const stage of Object.keys(board.stages || {}) as Array<keyof typeof board.stages>) {
    allCards.push(...(board.stages[stage] || []));
  }
  for (const card of allCards) {
    const refs = card.questionnaire_refs || [];
    for (const ref of refs) {
      try {
        const abs = resolveQuestionnaireAbsPath(projectRoot, ref);
        const q = await loadQuestionnaire(abs);
        if (q.name === name) return ref;
      } catch {
        // skip unreadable refs
      }
    }
  }
  return null;
}
