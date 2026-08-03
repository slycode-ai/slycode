import { NextResponse } from 'next/server';
import { startScheduler, stopScheduler, getSchedulerStatus, getConfiguredTimezone, getNextRun, triggerAutomation, updateCardAutomation } from '@/lib/scheduler';
import { promises as fs } from 'fs';
import path from 'path';
import type { KanbanBoard, KanbanCard, AutomationConfig } from '@/lib/types';
import { resolveProjectRoot } from '@/lib/kanban-paths';

// Scheduler is started via instrumentation.ts on server startup.
// The API route provides status + manual control only.

export async function GET() {
  const status = getSchedulerStatus();
  const tz = getConfiguredTimezone();
  return NextResponse.json({ ...status, ...tz });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, cardId, projectId } = body;

    if (action === 'start') {
      startScheduler();
      return NextResponse.json({ ok: true, message: 'Scheduler started' });
    }

    if (action === 'stop') {
      stopScheduler();
      return NextResponse.json({ ok: true, message: 'Scheduler stopped' });
    }

    if (action === 'nextRun') {
      const { schedule, scheduleType } = body;
      if (!schedule) {
        return NextResponse.json({ error: 'schedule required' }, { status: 400 });
      }
      const next = getNextRun(schedule, scheduleType || 'recurring');
      return NextResponse.json({ nextRun: next ? next.toISOString() : null });
    }

    if (action === 'trigger') {
      if (!cardId || !projectId) {
        return NextResponse.json({ error: 'cardId and projectId required' }, { status: 400 });
      }

      // Find the card in the project's kanban
      const projectPath = await resolveProjectRoot(projectId);
      const kanbanPath = path.join(projectPath, 'documentation', 'kanban.json');
      const content = await fs.readFile(kanbanPath, 'utf-8');
      const board: KanbanBoard = JSON.parse(content);

      let foundCard: KanbanCard | null = null;
      for (const stageCards of Object.values(board.stages)) {
        const card = (stageCards as KanbanCard[]).find((c) => c.id === cardId);
        if (card) {
          foundCard = card;
          break;
        }
      }

      if (!foundCard) {
        return NextResponse.json({ error: 'Card not found' }, { status: 404 });
      }

      if (!foundCard.automation) {
        return NextResponse.json({ error: 'Card has no automation config' }, { status: 400 });
      }

      // Write lastRun BEFORE the kickoff, mirroring checkAutomations.
      // A manual trigger registers in neither guard the scheduler relies on:
      // it never enters activeKickoffs (that Set is local to the scheduler
      // loop), and until lastRun lands, isDue()'s re-fire guard has nothing to
      // read. Writing it after the kickoff left a 60-80s window in which a
      // scheduler tick would see the card as due and fire it a second time —
      // no restart required, just a manual run overlapping its own schedule.
      await updateCardAutomation(projectPath, cardId, {
        lastRun: new Date().toISOString(),
      });

      const result = await triggerAutomation(foundCard, projectId, projectPath, { trigger: 'manual' });

      // Persist the outcome once the kickoff resolves
      // (scheduled triggers handle this in checkAutomations, but manual bypasses that)
      const configUpdates: Partial<AutomationConfig> = {
        lastResult: result.success ? 'success' : 'error',
        // undefined clears the key (Object.assign + JSON.stringify drops it),
        // so a card that has since succeeded shows no stale error.
        lastError: result.success ? undefined : result.error,
      };
      await updateCardAutomation(projectPath, cardId, configUpdates);

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
