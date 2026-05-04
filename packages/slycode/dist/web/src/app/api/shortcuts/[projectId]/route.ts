/**
 * Per-project Quick-launch Shortcuts API.
 *
 * GET  /api/shortcuts/[projectId] → returns the project's ShortcutsFile (empty
 *                                   default if none exists).
 * PUT  /api/shortcuts/[projectId] → replaces the file. Server-side validation
 *                                   for tag (lowercase alphanumeric 1–6,
 *                                   unique workspace-wide) and labels
 *                                   (lowercase alphanumeric, must contain a
 *                                   letter, unique within project, not
 *                                   reserved). Returns 400 with a structured
 *                                   error on failure.
 */

import { NextResponse } from 'next/server';
import { loadRegistry } from '@/lib/registry';
import {
  loadShortcuts,
  saveShortcuts,
  loadAllShortcuts,
  validateTag,
  validateLabel,
  type ProjectShortcuts,
} from '@/lib/shortcuts';
import type { ShortcutsFile, Shortcut } from '@/lib/types';

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

async function getProjectPath(projectId: string): Promise<string | null> {
  const registry = await loadRegistry();
  const project = registry.projects.find((p) => p.id === projectId);
  return project?.path ?? null;
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { projectId } = await params;
  const projectPath = await getProjectPath(projectId);
  if (!projectPath) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }
  const file = await loadShortcuts(projectPath);
  return NextResponse.json(file);
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { projectId } = await params;
  const projectPath = await getProjectPath(projectId);
  if (!projectPath) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  let body: Partial<ShortcutsFile>;
  try {
    body = (await request.json()) as Partial<ShortcutsFile>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const projectTag = typeof body.projectTag === 'string' ? body.projectTag.trim().toLowerCase() : '';
  const incomingShortcuts = Array.isArray(body.shortcuts) ? body.shortcuts : [];

  // Cross-workspace tag validation. Empty tag is allowed (project hasn't
  // configured shortcuts yet), but if any shortcuts are present the tag is
  // mandatory.
  const allFiles: ProjectShortcuts[] = await loadAllShortcuts();
  if (projectTag) {
    const tagResult = validateTag(projectTag, projectId, allFiles);
    if (!tagResult.ok) {
      return NextResponse.json({ error: tagResult.error, field: 'projectTag' }, { status: 400 });
    }
  } else if (incomingShortcuts.length > 0) {
    return NextResponse.json(
      { error: 'Project tag is required when shortcuts are configured.', field: 'projectTag' },
      { status: 400 },
    );
  }

  // Normalize + validate each shortcut. Build the final array as we go so
  // intra-project uniqueness checks see the canonical (lowercase) labels.
  const normalised: Shortcut[] = [];
  const sink: ShortcutsFile = { projectTag, shortcuts: [] };
  for (let i = 0; i < incomingShortcuts.length; i++) {
    const raw = incomingShortcuts[i] as Partial<Shortcut> | undefined;
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: `Shortcut #${i + 1} is invalid.` }, { status: 400 });
    }
    if (typeof raw.cardId !== 'string' || !raw.cardId.trim()) {
      return NextResponse.json(
        { error: `Shortcut #${i + 1} is missing a card.`, field: `shortcuts[${i}].cardId` },
        { status: 400 },
      );
    }
    const label = typeof raw.label === 'string' ? raw.label.trim().toLowerCase() : '';
    const labelResult = validateLabel(label, sink);
    if (!labelResult.ok) {
      return NextResponse.json(
        { error: labelResult.error, field: `shortcuts[${i}].label` },
        { status: 400 },
      );
    }
    const out: Shortcut = {
      label,
      cardId: raw.cardId.trim(),
    };
    if (typeof raw.prompt === 'string' && raw.prompt.trim()) out.prompt = raw.prompt;
    if (typeof raw.provider === 'string' && raw.provider.trim()) out.provider = raw.provider as Shortcut['provider'];
    if (raw.preferExistingSession === true) out.preferExistingSession = true;
    normalised.push(out);
    sink.shortcuts.push(out);
  }

  const finalFile: ShortcutsFile = { projectTag, shortcuts: normalised };
  try {
    await saveShortcuts(projectPath, finalFile);
  } catch (err) {
    console.error('Failed to save shortcuts:', err);
    return NextResponse.json({ error: 'Failed to write shortcuts.json' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, file: finalFile });
}
