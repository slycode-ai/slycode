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

    // Validate top-level structure. Only the single global default is
    // writable (feature 073) — stages/projects defaults no longer exist.
    if (typeof updates !== 'object' || updates === null || !updates.defaults) {
      return NextResponse.json({ error: 'Payload must be an object with a "defaults" key' }, { status: 400 });
    }
    if (typeof updates.defaults !== 'object' || updates.defaults === null) {
      return NextResponse.json({ error: '"defaults" must be an object' }, { status: 400 });
    }
    const unknownKeys = Object.keys(updates.defaults).filter(k => k !== 'global');
    if (unknownKeys.length > 0) {
      return NextResponse.json({ error: `Unsupported defaults keys: ${unknownKeys.join(', ')} (only "global" is writable)` }, { status: 400 });
    }
    if (!updates.defaults.global) {
      return NextResponse.json({ error: '"defaults.global" is required' }, { status: 400 });
    }

    const providersPath = getProvidersPath();
    const data = JSON.parse(await fs.readFile(providersPath, 'utf-8'));
    const providerIds = new Set<string>(Object.keys(data.providers));

    const err = validateProviderDefault(updates.defaults.global, providerIds, 'global');
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    // Replace the whole defaults block — this also sheds legacy
    // stages/projects keys from pre-073 files on first save.
    data.defaults = { global: updates.defaults.global };

    await fs.writeFile(providersPath, JSON.stringify(data, null, 2) + '\n');
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
