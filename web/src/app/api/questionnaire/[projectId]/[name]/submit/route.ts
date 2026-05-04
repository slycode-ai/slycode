import { NextRequest, NextResponse } from 'next/server';
import { resolveProjectRoot, ProjectResolutionError, getKanbanPath } from '@/lib/kanban-paths';
import { promises as fs } from 'fs';
import {
  buildSubmitMessage,
  loadQuestionnaire,
  resolveQuestionnaireAbsPath,
  saveQuestionnaire,
  QuestionnaireValidationError,
} from '@/lib/questionnaire';
import { getBridgeUrl } from '@/lib/paths';
import type { KanbanCard, KanbanBoard } from '@/lib/types';

interface SubmitBody {
  sessionName: string;
  provider?: string;
  cwd?: string;
  /** If true, autoSubmit (send Enter after the paste). Default true. */
  autoSubmit?: boolean;
}

/**
 * POST — submit the questionnaire to the card's terminal session.
 *
 * On success: writes a human-readable Q&A block to the PTY (same primitive
 * as Sly Actions), then mutates the questionnaire (status='submitted',
 * submitted_at, submission_count++).
 *
 * On PTY-write failure: the questionnaire is NOT mutated (so the user can
 * retry without losing draft state).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectId: string; name: string }> }
) {
  const { projectId, name } = await context.params;

  let body: SubmitBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  if (!body.sessionName || typeof body.sessionName !== 'string') {
    return NextResponse.json({ error: '"sessionName" required (string)' }, { status: 400 });
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

  let questionnaire;
  try {
    questionnaire = await loadQuestionnaire(absPath);
  } catch (err) {
    if (err instanceof QuestionnaireValidationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }

  const message = buildSubmitMessage(questionnaire, ref);
  const autoSubmit = body.autoSubmit !== false;

  // Resolve the bridge URL and try to deliver the message.
  const bridgeUrl = getBridgeUrl();
  const sessionName = body.sessionName;

  try {
    // Probe whether the session exists and is in a writable state.
    const probeRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}`);
    let isWritable = false;
    if (probeRes.ok) {
      const data = await probeRes.json();
      // Bridge returns 200 with null body when session is missing.
      if (data && (data.status === 'running' || data.status === 'detached')) {
        isWritable = true;
      }
    }

    if (isWritable) {
      // Session is up — paste with bracketed-paste markers, then optionally Enter.
      const pasteRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: `\x1b[200~${message}\x1b[201~` }),
      });
      if (!pasteRes.ok) {
        return NextResponse.json(
          { error: `PTY write failed (${pasteRes.status})` },
          { status: 502 }
        );
      }
      if (autoSubmit) {
        await new Promise((r) => setTimeout(r, 600));
        const enterRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(sessionName)}/input`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: '\r' }),
        });
        if (!enterRes.ok) {
          // Paste landed but Enter failed — partial delivery. Still mutate
          // status (the message is on the prompt line) and return success.
          // Surface the warning so the UI can show a toast.
          await markSubmitted(absPath, questionnaire);
          return NextResponse.json({
            ok: true,
            warning: `Enter submission failed (${enterRes.status}); message pasted but not auto-submitted`,
          });
        }
      }
    } else {
      // No active session — create one. Same shape as GlobalClaudePanel /
      // pushToTerminal does: pass the prompt body; the bridge delivers it as
      // part of session startup.
      if (!body.provider || !body.cwd) {
        return NextResponse.json(
          {
            error:
              'No active session for this card. To start one, include "provider" and "cwd" in the request body.',
          },
          { status: 409 }
        );
      }
      const createRes = await fetch(`${bridgeUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionName,
          provider: body.provider,
          skipPermissions: true,
          cwd: body.cwd,
          fresh: false,
          prompt: message,
        }),
      });
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => '');
        return NextResponse.json(
          { error: `Session create failed (${createRes.status}): ${text}` },
          { status: 502 }
        );
      }
    }

    await markSubmitted(absPath, questionnaire);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Bridge delivery failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}

async function markSubmitted(absPath: string, q: import('@/lib/questionnaire').Questionnaire): Promise<void> {
  q.status = 'submitted';
  q.submitted_at = new Date().toISOString();
  q.submission_count = (q.submission_count || 0) + 1;
  await saveQuestionnaire(absPath, q);
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
