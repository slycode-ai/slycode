/**
 * Board view state API (feature 082) — the "have I looked at this card" layer.
 *
 *   GET  /api/board-view-state?projectId=<id>  — that project's seen-state
 *   GET  /api/board-view-state?counts=1        — unseen count per project (dashboard roll-up)
 *   POST /api/board-view-state { projectId, cardId }  — stamp a card as seen
 *
 * UI-owned, mirroring /api/atlas/view-state: the web is the only writer, there
 * is no CLI path into this file.
 */

import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

import { resolveProjectRoot, ProjectResolutionError } from '@/lib/kanban-paths';
import { loadRegistry } from '@/lib/registry';
import { getBridgeUrl } from '@/lib/paths';
import { projectKeyAlternation } from '@/lib/session-keys';
import { computeUnseen, type UnseenCardInput, type UnseenSessionInput } from '@/lib/board-view-state';
import { markCardSeen, readBoardViewState } from '@/lib/board-view-state-store';
import type { KanbanBoard, KanbanStage } from '@/lib/types';

export const dynamic = 'force-dynamic';

const CARD_ID_RE = /^card-[A-Za-z0-9_-]{1,64}$/;
const STAGES: KanbanStage[] = ['backlog', 'design', 'implementation', 'testing', 'done'];

interface BridgeSession {
  name: string;
  lastOutputAt?: string | null;
  /** Sustained-activity timestamp — only /sessions exposes it, not /stats. */
  lastActive?: string | null;
}

/**
 * Bridge sessions, best-effort — a down bridge means no markers, never an error.
 *
 * Deliberately /sessions and not /stats: only /sessions carries `lastActive`,
 * the bridge's sustained-activity timestamp. Keying off lastOutputAt alone
 * counts stray blips as work and produces false markers.
 */
async function fetchBridgeSessions(): Promise<BridgeSession[]> {
  try {
    const res = await fetch(`${getBridgeUrl()}/sessions`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const body = await res.json();
    return (body?.sessions ?? body ?? []) as BridgeSession[];
  } catch {
    return [];
  }
}

/**
 * Cards the board would actually render for this project — archived and
 * automation cards are excluded, so neither can contribute to the count.
 * Stage + updated_at also feed the Done-lane suppression rule.
 */
async function liveCards(projectRoot: string): Promise<UnseenCardInput[]> {
  const cards: UnseenCardInput[] = [];
  try {
    const raw = await fs.readFile(path.join(projectRoot, 'documentation', 'kanban.json'), 'utf-8');
    const board = JSON.parse(raw) as KanbanBoard;
    for (const stage of STAGES) {
      for (const card of board.stages?.[stage] ?? []) {
        if (card.archived || card.automation) continue;
        cards.push({ id: card.id, stage, updatedAt: card.updated_at });
      }
    }
  } catch {
    // Unreadable or not a SlyCode project — contributes nothing.
  }
  return cards;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    if (searchParams.get('counts') === '1') {
      const [registry, sessions] = await Promise.all([loadRegistry(), fetchBridgeSessions()]);
      const counts: Record<string, number> = {};

      await Promise.all(
        registry.projects.map(async (project) => {
          try {
            const projectRoot = await resolveProjectRoot(project.id);
            const pattern = new RegExp(`^(?:${projectKeyAlternation(project)}):(?:[^:]+:)?card:(.+)$`);
            const inputs: UnseenSessionInput[] = [];
            for (const session of sessions) {
              const match = session.name.match(pattern);
              if (match) {
                inputs.push({
                  cardId: match[1],
                  lastOutputAt: session.lastOutputAt ?? null,
                  lastActiveAt: session.lastActive ?? null,
                });
              }
            }
            if (inputs.length === 0) {
              counts[project.id] = 0;
              return;
            }
            const [state, cards] = await Promise.all([
              readBoardViewState(projectRoot),
              liveCards(projectRoot),
            ]);
            const live = new Set(cards.map((c) => c.id));
            const unseen = computeUnseen(inputs, state, new Date(), cards);
            counts[project.id] = [...unseen].filter((id) => live.has(id)).length;
          } catch {
            // A project that can't be resolved or read just reports zero rather
            // than failing the whole dashboard response.
            counts[project.id] = 0;
          }
        }),
      );

      return NextResponse.json({ counts });
    }

    const projectId = searchParams.get('projectId');
    if (!projectId) {
      return NextResponse.json({ error: 'projectId or counts=1 is required' }, { status: 400 });
    }
    const projectRoot = await resolveProjectRoot(projectId);
    const state = await readBoardViewState(projectRoot);
    return NextResponse.json({ viewState: state });
  } catch (error) {
    if (error instanceof ProjectResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('[board-view-state] GET failed:', error);
    return NextResponse.json({ error: 'Failed to read board view state' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, cardId } = body ?? {};

    if (typeof projectId !== 'string' || !projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (typeof cardId !== 'string' || !CARD_ID_RE.test(cardId)) {
      return NextResponse.json({ error: 'cardId must look like card-<id>' }, { status: 400 });
    }

    const projectRoot = await resolveProjectRoot(projectId);
    const state = await markCardSeen(projectRoot, cardId);
    return NextResponse.json({ ok: true, viewState: state });
  } catch (error) {
    if (error instanceof ProjectResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('[board-view-state] POST failed:', error);
    return NextResponse.json({ error: 'Failed to update board view state' }, { status: 500 });
  }
}
