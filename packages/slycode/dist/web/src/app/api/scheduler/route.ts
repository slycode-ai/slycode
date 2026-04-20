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

      const result = await triggerAutomation(foundCard, projectId, projectPath, { trigger: 'manual' });

      // Persist lastRun and lastResult for manual triggers
      // (scheduled triggers handle this in checkAutomations, but manual bypasses that)
      const configUpdates: Partial<AutomationConfig> = {
        lastRun: new Date().toISOString(),
        lastResult: result.success ? 'success' : 'error',
      };
      await updateCardAutomation(projectPath, cardId, configUpdates);

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
