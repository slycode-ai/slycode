import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';
import { readProviderPrefs, writeProviderPrefs, orderProviderIds } from '@/lib/provider-prefs.server';

export const dynamic = 'force-dynamic';

interface RegistryProvider { displayName?: string; color?: { hex?: string }; transport?: string }

async function fullProviderList() {
  const raw = await fs.readFile(path.join(getSlycodeRoot(), 'data', 'providers.json'), 'utf-8');
  const providers = (JSON.parse(raw).providers ?? {}) as Record<string, RegistryProvider>;
  return providers;
}

/**
 * GET: the FULL provider list (including disabled ones) in effective order,
 * plus the prefs — this is the Provider Config modal's data source. The
 * plain /api/providers GET already hides disabled providers for everything
 * else (feature 085 stretch).
 */
export async function GET() {
  try {
    const providers = await fullProviderList();
    const prefs = readProviderPrefs();
    const ids = orderProviderIds(Object.keys(providers), prefs);
    return NextResponse.json({
      providers: ids.map(id => ({
        id,
        displayName: providers[id].displayName ?? id,
        colorHex: providers[id].color?.hex ?? null,
        disabled: prefs.disabled.includes(id),
      })),
      prefs,
    });
  } catch {
    return NextResponse.json({ error: 'providers.json not found' }, { status: 404 });
  }
}

/** PUT { order?: string[], disabled?: string[] } — ids validated against the registry. */
export async function PUT(request: Request) {
  let body: { order?: unknown; disabled?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const asIds = (v: unknown): string[] | null =>
    v === undefined ? [] : Array.isArray(v) && v.every(x => typeof x === 'string') ? v as string[] : null;
  const order = asIds(body.order);
  const disabled = asIds(body.disabled);
  if (!order || !disabled) {
    return NextResponse.json({ error: 'order and disabled must be arrays of provider ids' }, { status: 400 });
  }
  try {
    const providers = await fullProviderList();
    const known = new Set(Object.keys(providers));
    const unknown = [...order, ...disabled].filter(id => !known.has(id));
    if (unknown.length > 0) {
      return NextResponse.json({ error: `unknown provider id(s): ${unknown.join(', ')}` }, { status: 400 });
    }
    if (disabled.length >= known.size) {
      return NextResponse.json({ error: 'at least one provider must stay enabled' }, { status: 400 });
    }
    await writeProviderPrefs({ order, disabled });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'failed to save provider prefs' }, { status: 500 });
  }
}
