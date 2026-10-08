import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { loadRegistry, mutateRegistry } from '@/lib/registry';
import { RegistryLockError } from '@/lib/registry-lock';
import { isProjectStatus, projectStatus, statusChangePatch, PROJECT_STATUS_LABELS } from '@/lib/project-status';
import { heldSummary } from '@/lib/project-held';
import { appendEvent } from '@/lib/event-log';
import type { KanbanBoard, ProjectStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

/** Timers this project holds (or would hold) — for the pause dialog and the response. */
async function heldFor(projectPath: string, sinceIso?: string) {
  const board = await readJson<KanbanBoard>(path.join(projectPath, 'documentation', 'kanban.json'));
  const atlas = await readJson<{ enabled?: boolean; schedule?: string | null }>(
    path.join(projectPath, 'documentation', 'atlas', 'config.json'));
  const since = sinceIso ? Date.parse(sinceIso) : NaN;
  const summary = heldSummary(board, atlas, {
    sinceMs: Number.isFinite(since) ? since : undefined,
    timezone: process.env.TZ || 'UTC',
  });
  // Named list for the dialog: enabled automations + cards with pending sends.
  const items: { kind: 'automation' | 'scheduled_prompt' | 'atlas'; cardId?: string; number?: number; title: string; when: string }[] = [];
  for (const cards of Object.values(board?.stages ?? {})) {
    for (const c of cards || []) {
      if (c.archived) continue;
      if (c.automation?.enabled && c.automation.schedule) {
        items.push({ kind: 'automation', cardId: c.id, number: c.number, title: c.title, when: c.automation.schedule });
      }
      for (const sp of c.scheduled_prompts ?? []) {
        if (sp.state === 'pending') items.push({ kind: 'scheduled_prompt', cardId: c.id, number: c.number, title: c.title, when: sp.fireAt });
      }
    }
  }
  if (summary.atlas && atlas?.schedule) items.push({ kind: 'atlas', title: 'Atlas refresh', when: atlas.schedule });
  return { summary, items };
}

/**
 * GET /api/projects/[id]/status — current status + what it holds (or would
 * hold if paused). Feeds the pause dialog (card #0381).
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const registry = await loadRegistry();
  const project = registry.projects.find(p => p.id === id);
  if (!project) return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
  const held = await heldFor(project.path, project.status && project.status !== 'active' ? project.statusChangedAt : undefined);
  return NextResponse.json({
    status: projectStatus(project),
    statusChangedAt: project.statusChangedAt ?? null,
    resumedAt: project.resumedAt ?? null,
    held: held.summary,
    items: held.items,
  });
}

/**
 * POST /api/projects/[id]/status { status } — the one write path for a
 * project's status (card #0381, feature 089). Writes status +
 * statusChangedAt, and resumedAt on a non-active → active move (the
 * scheduler's skip-never-replay fence). Never touches running sessions:
 * pausing just pauses (owner ruling). Unchanged status is a no-op.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const next = (body as { status?: unknown }).status;
    if (!isProjectStatus(next)) {
      return NextResponse.json({ error: `status must be one of active, paused, complete, archived` }, { status: 400 });
    }
    // Fresh read → patch → atomic write under the registry lock, so a
    // concurrent reorder/folder/edit can't overwrite this status (or vice versa).
    const outcome = await mutateRegistry((registry) => {
      const found = registry.projects.find(p => p.id === id);
      if (!found) return null;
      const before: ProjectStatus = projectStatus(found);
      const change = statusChangePatch(found, next);
      if (change) Object.assign(found, change);
      return { project: { ...found }, previous: before, patch: change };
    });
    if (!outcome) return NextResponse.json({ error: `Project '${id}' not found` }, { status: 404 });
    const { project, previous, patch } = outcome;
    if (patch) {
      try {
        const verb = next === 'active' ? (previous === 'archived' ? 'Restored' : 'Resumed') : `Marked ${PROJECT_STATUS_LABELS[next].toLowerCase()}`;
        appendEvent({ type: 'project_status', project: project.id, detail: `${verb}: ${project.name}`, source: 'web', timestamp: new Date().toISOString() });
      } catch {
        // Activity feed is best-effort.
      }
    }
    const held = await heldFor(project.path, next === 'active' ? undefined : project.statusChangedAt);
    return NextResponse.json({ changed: Boolean(patch), project, held: held.summary });
  } catch (error) {
    if (error instanceof RegistryLockError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error('Failed to update project status:', error);
    return NextResponse.json({ error: 'Failed to update project status' }, { status: 500 });
  }
}
