import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';
import { atomicWriteFile } from '@/lib/atomic-write';

function getProvidersPath(): string {
  return path.join(getSlycodeRoot(), 'data', 'providers.json');
}

export async function GET() {
  try {
    const data = await fs.readFile(getProvidersPath(), 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json({ error: 'providers.json not found' }, { status: 404 });
  }
}

function validateProviderDefault(
  def: unknown,
  providerIds: Set<string>,
  label: string
): string | null {
  if (typeof def !== 'object' || def === null) return `${label} must be an object`;
  const d = def as Record<string, unknown>;
  if (typeof d.provider !== 'string' || !providerIds.has(d.provider)) {
    return `${label}.provider must be a known provider ID`;
  }
  if (typeof d.skipPermissions !== 'boolean') {
    return `${label}.skipPermissions must be a boolean`;
  }
  // Optional model field — free string, passed through to the provider CLI.
  // Deliberately NOT validated against the available list: custom model ids
  // are entered here (feature 073).
  if ('model' in d && d.model !== undefined && typeof d.model !== 'string') {
    return `${label}.model must be a string if provided`;
  }
  return null;
}

export async function PUT(request: Request) {
  try {
    const updates = await request.json();

    // Per-project defaults (073 follow-up). Two accepted payload shapes:
    //   { defaults: { projects: { [projectId]: Def } } }  — exactly one entry;
    //     writes that project's default AND mirrors it to `global`, so `global`
    //     is always the most-recently-set default (inherited by projects that
    //     never set their own).
    //   { defaults: { global: Def } }                     — writes global only.
    // Legacy `stages` keys are rejected and shed from the file on save.
    if (typeof updates !== 'object' || updates === null || !updates.defaults) {
      return NextResponse.json({ error: 'Payload must be an object with a "defaults" key' }, { status: 400 });
    }
    if (typeof updates.defaults !== 'object' || updates.defaults === null) {
      return NextResponse.json({ error: '"defaults" must be an object' }, { status: 400 });
    }
    const unknownKeys = Object.keys(updates.defaults).filter(k => k !== 'global' && k !== 'projects');
    if (unknownKeys.length > 0) {
      return NextResponse.json({ error: `Unsupported defaults keys: ${unknownKeys.join(', ')} (only "global" and "projects" are writable)` }, { status: 400 });
    }
    const hasGlobal = !!updates.defaults.global;
    const hasProjects = !!updates.defaults.projects;
    if (hasGlobal === hasProjects) {
      return NextResponse.json({ error: 'Provide exactly one of "defaults.global" or "defaults.projects"' }, { status: 400 });
    }

    const providersPath = getProvidersPath();
    const data = JSON.parse(await fs.readFile(providersPath, 'utf-8'));
    const providerIds = new Set<string>(Object.keys(data.providers));

    let newGlobal;
    let projectEntry: [string, unknown] | null = null;
    if (hasProjects) {
      if (typeof updates.defaults.projects !== 'object' || updates.defaults.projects === null) {
        return NextResponse.json({ error: '"defaults.projects" must be an object' }, { status: 400 });
      }
      const entries = Object.entries(updates.defaults.projects);
      if (entries.length !== 1) {
        return NextResponse.json({ error: '"defaults.projects" must contain exactly one project entry' }, { status: 400 });
      }
      const [projectId, def] = entries[0];
      if (!projectId.trim()) {
        return NextResponse.json({ error: 'Project id must be a non-empty string' }, { status: 400 });
      }
      const err = validateProviderDefault(def, providerIds, `projects.${projectId}`);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      projectEntry = [projectId, def];
      newGlobal = def; // last-set mirror
    } else {
      const err = validateProviderDefault(updates.defaults.global, providerIds, 'global');
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      newGlobal = updates.defaults.global;
    }

    // Rebuild defaults: keep existing per-project entries, shed legacy stages.
    const existingProjects = (data.defaults && typeof data.defaults.projects === 'object' && data.defaults.projects !== null)
      ? data.defaults.projects
      : {};
    const projects = projectEntry
      ? { ...existingProjects, [projectEntry[0]]: projectEntry[1] }
      : existingProjects;
    data.defaults = Object.keys(projects).length > 0
      ? { global: newGlobal, projects }
      : { global: newGlobal };

    await atomicWriteFile(providersPath, JSON.stringify(data, null, 2) + '\n');
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
