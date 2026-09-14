/**
 * Scheduled card prompts API (card #0352).
 *
 *   GET    ?projectId&cardId                       → { list }
 *   POST   { projectId, cardId, sessionName, message, fireAt } → { entry, list }
 *   PATCH  { projectId, cardId, id, message?, fireAt? }        → { entry, list }   (pending only)
 *   DELETE { projectId, cardId, id }                            → { entry, list }   (→ cancelled)
 *
 * The web server is the only writer of card.scheduled_prompts. The tick in
 * lib/scheduler.ts fires them; see documentation/designs/scheduled_card_prompts.md.
 */

import { NextRequest, NextResponse } from 'next/server';
import os from 'os';
import { resolveProjectRoot, ProjectResolutionError } from '@/lib/kanban-paths';
import { mutateCardScheduledPrompts, readCardScheduledPrompts } from '@/lib/scheduled-prompts-store';
import {
  SCHEDULED_PROMPT_LIMITS,
  newScheduledPromptId,
  pendingEntries,
  providerFromSessionName,
  validateScheduledPromptInput,
} from '@/lib/scheduled-prompts';
import type { ScheduledPrompt } from '@/lib/types';

const SESSION_NAME_RE = /^[a-zA-Z0-9:_-]+$/;

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

async function projectPathOr400(projectId: unknown): Promise<string | NextResponse> {
  if (typeof projectId !== 'string' || !projectId) return bad('projectId required');
  try {
    return await resolveProjectRoot(projectId);
  } catch (err) {
    if (err instanceof ProjectResolutionError) return bad(err.message, 404);
    throw err;
  }
}

export async function GET(request: NextRequest) {
  const projectId = request.nextUrl.searchParams.get('projectId');
  const cardId = request.nextUrl.searchParams.get('cardId');
  if (!cardId) return bad('cardId required');
  const projectPath = await projectPathOr400(projectId);
  if (projectPath instanceof NextResponse) return projectPath;
  try {
    const list = await readCardScheduledPrompts(projectPath, cardId);
    if (list === null) return bad('Card not found', 404);
    return NextResponse.json({ list });
  } catch (err) {
    return bad((err as Error).message, 500);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return bad('JSON body required');
  const { projectId, cardId, sessionName, message, fireAt } = body as Record<string, unknown>;
  if (typeof cardId !== 'string' || !cardId) return bad('cardId required');
  if (typeof sessionName !== 'string' || !SESSION_NAME_RE.test(sessionName)) return bad('sessionName invalid');
  if (!sessionName.includes(`:card:${cardId}`)) return bad('sessionName does not belong to this card');
  const provider = providerFromSessionName(sessionName);
  if (!provider) return bad('sessionName has no provider segment');
  const v = validateScheduledPromptInput({ message: String(message ?? ''), fireAt: String(fireAt ?? '') });
  if (!v.ok) return bad(v.error);
  const projectPath = await projectPathOr400(projectId);
  if (projectPath instanceof NextResponse) return projectPath;

  const now = new Date().toISOString();
  const entry: ScheduledPrompt = {
    id: newScheduledPromptId(),
    message: v.message,
    fireAt: v.fireAt,
    createdAt: now,
    sessionName,
    provider,
    host: os.hostname(),
    state: 'pending',
  };
  let capHit = false;
  const result = await mutateCardScheduledPrompts(projectPath, cardId, (list) => {
    if (pendingEntries(list).length >= SCHEDULED_PROMPT_LIMITS.maxPending) { capHit = true; return; }
    list.push(entry);
  });
  if (!result) return bad('Card not found', 404);
  if (capHit) return bad(`This card already has ${SCHEDULED_PROMPT_LIMITS.maxPending} pending sends`, 409);
  return NextResponse.json({ entry, list: result.list });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return bad('JSON body required');
  const { projectId, cardId, id, message, fireAt } = body as Record<string, unknown>;
  if (typeof cardId !== 'string' || !cardId) return bad('cardId required');
  if (typeof id !== 'string' || !id) return bad('id required');
  const projectPath = await projectPathOr400(projectId);
  if (projectPath instanceof NextResponse) return projectPath;

  let error: string | null = null;
  let updated: ScheduledPrompt | null = null;
  const result = await mutateCardScheduledPrompts(projectPath, cardId, (list) => {
    const entry = list.find(e => e.id === id);
    if (!entry) { error = 'Scheduled send not found'; return; }
    if (entry.state !== 'pending') { error = `Scheduled send is ${entry.state}, not pending`; return; }
    const v = validateScheduledPromptInput({
      message: typeof message === 'string' ? message : entry.message,
      fireAt: typeof fireAt === 'string' ? fireAt : entry.fireAt,
    });
    if (!v.ok) { error = v.error; return; }
    entry.message = v.message;
    entry.fireAt = v.fireAt;
    updated = entry;
  });
  if (!result) return bad('Card not found', 404);
  if (error) return bad(error, error === 'Scheduled send not found' ? 404 : 409);
  return NextResponse.json({ entry: updated, list: result.list });
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return bad('JSON body required');
  const { projectId, cardId, id } = body as Record<string, unknown>;
  if (typeof cardId !== 'string' || !cardId) return bad('cardId required');
  if (typeof id !== 'string' || !id) return bad('id required');
  const projectPath = await projectPathOr400(projectId);
  if (projectPath instanceof NextResponse) return projectPath;

  let error: string | null = null;
  let cancelled: ScheduledPrompt | null = null;
  const result = await mutateCardScheduledPrompts(projectPath, cardId, (list) => {
    const entry = list.find(e => e.id === id);
    if (!entry) { error = 'Scheduled send not found'; return; }
    if (entry.state === 'pending') {
      entry.state = 'cancelled';
      entry.finishedAt = new Date().toISOString();
      cancelled = entry;
      return;
    }
    // Finished (or firing) entries: removing from the list is the "clear" action.
    if (entry.state === 'firing') { error = 'Scheduled send is firing right now'; return; }
    cancelled = entry;
    return list.filter(e => e.id !== id);
  });
  if (!result) return bad('Card not found', 404);
  if (error) return bad(error, error === 'Scheduled send not found' ? 404 : 409);
  return NextResponse.json({ entry: cancelled, list: result.list });
}
