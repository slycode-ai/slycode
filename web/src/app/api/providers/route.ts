import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';

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

const VALID_STAGES = new Set(['backlog', 'design', 'implementation', 'testing', 'done', 'automation']);

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
  return null;
}

export async function PUT(request: Request) {
  try {
    const updates = await request.json();

    // Validate top-level structure
    if (typeof updates !== 'object' || updates === null || !updates.defaults) {
      return NextResponse.json({ error: 'Payload must be an object with a "defaults" key' }, { status: 400 });
    }
    if (typeof updates.defaults !== 'object' || updates.defaults === null) {
      return NextResponse.json({ error: '"defaults" must be an object' }, { status: 400 });
    }

    const providersPath = getProvidersPath();
    const data = JSON.parse(await fs.readFile(providersPath, 'utf-8'));
    const providerIds = new Set<string>(Object.keys(data.providers));

    // Validate stages
    if (updates.defaults.stages) {
      if (typeof updates.defaults.stages !== 'object') {
        return NextResponse.json({ error: '"defaults.stages" must be an object' }, { status: 400 });
      }
      for (const [stageName, stageDef] of Object.entries(updates.defaults.stages)) {
        if (!VALID_STAGES.has(stageName)) {
          return NextResponse.json({ error: `Unknown stage: "${stageName}"` }, { status: 400 });
        }
        const err = validateProviderDefault(stageDef, providerIds, `stages.${stageName}`);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
    }

    // Validate global
    if (updates.defaults.global) {
      const err = validateProviderDefault(updates.defaults.global, providerIds, 'global');
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    // Validate projects
    if (updates.defaults.projects) {
      if (typeof updates.defaults.projects !== 'object') {
        return NextResponse.json({ error: '"defaults.projects" must be an object' }, { status: 400 });
      }
      for (const [projId, projDef] of Object.entries(updates.defaults.projects)) {
        const err = validateProviderDefault(projDef, providerIds, `projects.${projId}`);
        if (err) return NextResponse.json({ error: err }, { status: 400 });
      }
    }

    // Apply updates
    if (updates.defaults.stages) {
      data.defaults.stages = { ...data.defaults.stages, ...updates.defaults.stages };
    }
    if (updates.defaults.global) {
      data.defaults.global = updates.defaults.global;
    }
    if (updates.defaults.projects) {
      data.defaults.projects = { ...data.defaults.projects, ...updates.defaults.projects };
    }

    await fs.writeFile(providersPath, JSON.stringify(data, null, 2) + '\n');
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
