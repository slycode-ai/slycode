import { NextRequest, NextResponse } from 'next/server';
import { resolveProjectRoot, ProjectResolutionError, getKanbanPath } from '@/lib/kanban-paths';
import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import {
  buildSubmitMessage,
  loadQuestionnaire,
  resolveQuestionnaireAbsPath,
  saveQuestionnaire,
  QuestionnaireValidationError,
} from '@/lib/questionnaire';
import { getBridgeUrl } from '@/lib/paths';
import { loadRegistry } from '@/lib/registry';
import { sessionNameCandidates } from '@/lib/session-keys';
import { autoStatusQuestionnaireSubmitted } from '@/lib/status';
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

  const found = await findQuestionnaireRef(projectId, name);
  if (!found) {
    return NextResponse.json({ error: `No questionnaire named "${name}"` }, { status: 404 });
  }
  const { ref, card, board, kanbanPath } = found;

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

  // Resolve the bridge URL and build alias-aware session-name candidates.
  // The client-passed sessionName is used as the first candidate, then we add
  // canonical+alias forms derived from the project registry so we don't miss a
  // session that lives under an old alias key (a real-world flake when client
  // state was stale at click time).
  const bridgeUrl = getBridgeUrl();
  const candidates = await buildSessionCandidates(projectId, body.sessionName, body.provider);

  try {
    // Probe each candidate; first writable session wins.
    let resolvedName: string | null = null;
    for (const candidate of candidates) {
      const probeRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(candidate)}`);
      if (!probeRes.ok) continue;
      const data = await probeRes.json();
      // Bridge returns 200 with null body when session is missing.
      if (data && (data.status === 'running' || data.status === 'detached')) {
        resolvedName = candidate;
        break;
      }
    }

    if (resolvedName) {
      if (autoSubmit) {
        // Verified delivery (feature 070): the bridge pastes, confirms the
        // Q&A block is queued, sends Enter, and verifies the input region
        // actually cleared (resending Enter — never the paste — if not).
        // The questionnaire is only marked submitted on a confirmed delivery.
        const subRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(resolvedName)}/submit-verified`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: message, force: true }),
        });
        if (!subRes.ok) {
          const text = await subRes.text().catch(() => '');
          return NextResponse.json(
            { error: `PTY write failed (${subRes.status}): ${text}` },
            { status: 502 }
          );
        }
        const result = await subRes.json();
        const delivery = result.delivery as
          | { outcome: string; reason?: string; warnings?: string[]; attempts?: number; resends?: number }
          | undefined;

        if (delivery && delivery.outcome !== 'delivered') {
          // failed | ambiguous | blocked — do NOT mark submitted; the user's
          // draft answers are preserved and they can retry after clearing
          // whatever is in the way.
          const detail = delivery.reason ? ` (${delivery.reason})` : '';
          const uiError =
            delivery.outcome === 'blocked'
              ? `The session is blocked by an update/dialog — open the Terminal tab and clear it, then submit again${detail}`
              : `Delivery ${delivery.outcome}${detail} — the message could not be confirmed as submitted. Check the Terminal tab and retry.`;
          return NextResponse.json({ error: uiError, delivery }, { status: 502 });
        }

        const warnings = delivery?.warnings?.length ? delivery.warnings.join('; ') : undefined;
        await markSubmitted(absPath, questionnaire);
        await emitSubmittedStatus(card, board, kanbanPath);
        return NextResponse.json(warnings ? { ok: true, warning: warnings } : { ok: true });
      }

      // autoSubmit=false — deliberately paste-only; raw /input stays raw
      // (no submit semantics, no verification).
      const pasteRes = await fetch(`${bridgeUrl}/sessions/${encodeURIComponent(resolvedName)}/input`, {
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
    } else {
      // No active session under any alias — create one. Use the canonical
      // (first) candidate so the new session is created under the canonical
      // name, not an alias.
      if (!body.provider || !body.cwd) {
        return NextResponse.json(
          {
            error:
              'No active session for this card. To start one, include "provider" and "cwd" in the request body.',
            triedCandidates: candidates,
          },
          { status: 409 }
        );
      }
      const createName = candidates[0] ?? body.sessionName;
      const createRes = await fetch(`${bridgeUrl}/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName,
          provider: body.provider,
          skipPermissions: true,
          cwd: body.cwd,
          fresh: false,
          prompt: message,
          verifyDelivery: true,
        }),
      });
      if (!createRes.ok) {
        const text = await createRes.text().catch(() => '');
        return NextResponse.json(
          { error: `Session create failed (${createRes.status}): ${text}` },
          { status: 502 }
        );
      }
      // Resume/create path delivers via spawn (argv on POSIX, deferred paste
      // on Windows) — the bridge reports it in the additive delivery field.
      const createData = await createRes.json().catch(() => null);
      const createDelivery = createData?.delivery as { outcome: string; reason?: string } | undefined;
      if (createDelivery && createDelivery.outcome !== 'delivered') {
        const detail = createDelivery.reason ? ` (${createDelivery.reason})` : '';
        return NextResponse.json(
          { error: `Delivery ${createDelivery.outcome}${detail} — session was started but the message could not be confirmed as submitted.`, delivery: createDelivery },
          { status: 502 }
        );
      }
    }

    await markSubmitted(absPath, questionnaire);
    await emitSubmittedStatus(card, board, kanbanPath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `Bridge delivery failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 }
    );
  }
}

/**
 * Build the ordered list of session-name candidates to probe for this submit.
 *
 * Why iterate: bridge sessions can live under either the canonical sessionKey
 * or an alias (e.g., projects upgraded from a registry id that diverged from
 * path.basename). Probing only the client-passed name produces the
 * "no active session" false negative we hit in the wild — same pattern that
 * GlobalClaudePanel and the messaging bridge resolver use.
 *
 * Order:
 *   1. Client-passed sessionName (gives priority to whatever the UI thinks)
 *   2. Canonical-first alias forms derived from the project + cardId + provider
 */
async function buildSessionCandidates(
  projectId: string,
  passedSessionName: string,
  passedProvider: string | undefined,
): Promise<string[]> {
  const candidates: string[] = [];
  if (passedSessionName) candidates.push(passedSessionName);

  // Parse `<key>:<provider>:card:<cardId>` from the passed name to derive
  // alias forms with the same provider+cardId.
  const cardMatch = passedSessionName?.match(/:card:(.+)$/);
  const cardId = cardMatch?.[1];
  const providerMatch = passedSessionName?.match(/^[^:]+:([^:]+):card:/);
  const provider = providerMatch?.[1] || passedProvider;

  if (cardId && provider) {
    try {
      const registry = await loadRegistry();
      const project = registry.projects.find((p) => p.id === projectId);
      if (project) {
        for (const alias of sessionNameCandidates(project, provider, cardId)) {
          if (!candidates.includes(alias)) candidates.push(alias);
        }
      }
    } catch {
      // Registry unavailable — fall back to whatever the client gave us.
    }
  }

  return candidates;
}

async function markSubmitted(absPath: string, q: import('@/lib/questionnaire').Questionnaire): Promise<void> {
  q.status = 'submitted';
  q.submitted_at = new Date().toISOString();
  q.submission_count = (q.submission_count || 0) + 1;
  await saveQuestionnaire(absPath, q);
}

/**
 * Try to emit the medium-tier auto-status `"Questionnaire submitted"` on the
 * card and persist the board if it took. Skips the kanban write if the helper
 * declined (e.g., a manual or higher-tier auto-status is currently set), so we
 * don't churn `last_updated` when nothing actually changed.
 */
async function emitSubmittedStatus(
  card: KanbanCard,
  board: KanbanBoard,
  kanbanPath: string,
): Promise<void> {
  if (autoStatusQuestionnaireSubmitted(card)) {
    card.updated_at = new Date().toISOString();
    card.last_modified_by = 'agent';
    await persistKanbanStatus(board, kanbanPath);
  }
}

interface FoundQuestionnaire {
  ref: string;
  card: KanbanCard;
  board: KanbanBoard;
  kanbanPath: string;
}

async function findQuestionnaireRef(
  projectId: string,
  name: string,
): Promise<FoundQuestionnaire | null> {
  const projectRoot = await resolveProjectRoot(projectId);
  const kanbanPath = await getKanbanPath(projectId);
  let board: KanbanBoard;
  try {
    const raw = await fs.readFile(kanbanPath, 'utf-8');
    board = JSON.parse(raw);
  } catch {
    return null;
  }
  const stageKeys = Object.keys(board.stages || {}) as Array<keyof typeof board.stages>;
  for (const stage of stageKeys) {
    for (const card of board.stages[stage] || []) {
      const refs = card.questionnaire_refs || [];
      for (const ref of refs) {
        try {
          const abs = resolveQuestionnaireAbsPath(projectRoot, ref);
          const q = await loadQuestionnaire(abs);
          if (q.name === name) return { ref, card, board, kanbanPath };
        } catch {
          // skip
        }
      }
    }
  }
  return null;
}

/**
 * Atomic write of the kanban board after an auto-status mutation. Updates
 * `last_updated` on the board; the per-card `last_modified_by` is stamped by
 * the caller (auto-status emissions are system-driven, so callers use
 * `'agent'`). Mirrors the temp+rename pattern used by saveQuestionnaire.
 *
 * Concurrency note: this is a full-board overwrite, so a simultaneous human
 * web edit racing this write could lose a field. The window is small (submit
 * is rare and user-initiated) and acceptable for a single-user app; if it
 * becomes a problem, route through /api/kanban POST surgical-save instead.
 */
async function persistKanbanStatus(board: KanbanBoard, kanbanPath: string): Promise<void> {
  board.last_updated = new Date().toISOString();
  const json = JSON.stringify(board, null, 2);
  const tmpPath = `${kanbanPath}.tmp.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}`;
  await fs.writeFile(tmpPath, json, 'utf-8');
  await fs.rename(tmpPath, kanbanPath);
}
