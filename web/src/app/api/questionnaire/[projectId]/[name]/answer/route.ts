import { NextRequest, NextResponse } from 'next/server';
import { resolveProjectRoot, ProjectResolutionError, getKanbanPath } from '@/lib/kanban-paths';
import { promises as fs } from 'fs';
import {
  patchAnswer,
  resolveQuestionnaireAbsPath,
  loadQuestionnaire,
  QuestionnaireValidationError,
} from '@/lib/questionnaire';
import type { KanbanCard, KanbanBoard } from '@/lib/types';

/** POST { itemId, value } — patch one answer in the questionnaire. */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string; name: string }> }
) {
  const { projectId, name } = await context.params;

  let body: { itemId?: string; value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  if (!body.itemId || typeof body.itemId !== 'string') {
    return NextResponse.json({ error: '"itemId" required (string)' }, { status: 400 });
  }
  if (!('value' in body)) {
    return NextResponse.json({ error: '"value" required (any JSON, including null)' }, { status: 400 });
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

  const ref = await findQuestionnaireRef(projectId, name);
  if (!ref) {
    return NextResponse.json({ error: `No questionnaire named "${name}"` }, { status: 404 });
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
    const result = await patchAnswer(absPath, body.itemId, body.value);
    return NextResponse.json({ ok: true, schema_version: result.schema_version });
  } catch (err) {
    if (err instanceof QuestionnaireValidationError) {
      const code = (err as QuestionnaireValidationError & { code?: string }).code;
      if (code === 'ITEM_NOT_FOUND') {
        // Schema mismatch — UI should re-fetch.
        let schemaVersion: number | null = null;
        try {
          const q = await loadQuestionnaire(absPath);
          schemaVersion = q.schema_version;
        } catch {
          // ignore
        }
        return NextResponse.json(
          { error: 'schema_mismatch', message: err.message, schema_version: schemaVersion },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

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
        // skip
      }
    }
  }
  return null;
}
