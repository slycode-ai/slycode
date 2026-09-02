import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';
import { refreshProviderModels, buildModelEntries } from '@/lib/provider-models.server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/providers/:id/models/refresh — run the provider's model
 * enumeration on demand (feature 085). Only providers that declare
 * `model.refreshCommand` in data/providers.json qualify. Nothing polls this;
 * the user presses Refresh.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: 'invalid provider id' }, { status: 400 });
  }
  let registry: { providers?: Record<string, { model?: { refreshCommand?: string[]; recentCommand?: string[] } }> };
  try {
    registry = JSON.parse(await fs.readFile(path.join(getSlycodeRoot(), 'data', 'providers.json'), 'utf-8'));
  } catch {
    return NextResponse.json({ error: 'providers.json not found' }, { status: 404 });
  }
  const provider = registry.providers?.[id];
  if (!provider) return NextResponse.json({ error: `unknown provider '${id}'` }, { status: 404 });
  if (!provider.model?.refreshCommand?.length) {
    return NextResponse.json({ error: `provider '${id}' does not support model refresh` }, { status: 400 });
  }
  try {
    const result = await refreshProviderModels(id, provider.model);
    return NextResponse.json({
      refreshedAt: result.refreshedAt,
      count: result.models.length,
      recentCount: result.recent.length,
      available: buildModelEntries(result.models.map(m => m.id), result.recent),
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
