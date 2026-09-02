/**
 * Per-machine provider preferences (feature 085 stretch): which providers are
 * disabled here and in what order they appear. Lives in
 * data/provider-prefs.json (gitignored) — like provider-models.json it is
 * machine state, never registry config, so `slycode update` and the template
 * parity guard don't touch it. An empty/missing file means "everything
 * enabled, registry order".
 */
import fs from 'fs';
import path from 'path';
import { getSlycodeRoot } from './paths';
import { atomicWriteFile } from './atomic-write';

export interface ProviderPrefs {
  /** Provider ids in display order; ids not listed follow in registry order. */
  order: string[];
  /** Provider ids hidden from selectors and refused at spawn on this machine. */
  disabled: string[];
}

export function providerPrefsPath(root = getSlycodeRoot()): string {
  return path.join(root, 'data', 'provider-prefs.json');
}

export function readProviderPrefs(root = getSlycodeRoot()): ProviderPrefs {
  try {
    const parsed = JSON.parse(fs.readFileSync(providerPrefsPath(root), 'utf-8'));
    return {
      order: Array.isArray(parsed?.order) ? parsed.order.filter((x: unknown) => typeof x === 'string') : [],
      disabled: Array.isArray(parsed?.disabled) ? parsed.disabled.filter((x: unknown) => typeof x === 'string') : [],
    };
  } catch {
    return { order: [], disabled: [] };
  }
}

export async function writeProviderPrefs(prefs: ProviderPrefs, root = getSlycodeRoot()): Promise<void> {
  const clean: ProviderPrefs = {
    order: [...new Set(prefs.order)],
    disabled: [...new Set(prefs.disabled)],
  };
  await atomicWriteFile(providerPrefsPath(root), JSON.stringify(clean, null, 2) + '\n');
}

/** Reorder provider ids: prefs order first (unknown ids dropped), the rest keep their relative order. */
export function orderProviderIds(ids: string[], prefs: ProviderPrefs): string[] {
  const known = new Set(ids);
  const head = prefs.order.filter(id => known.has(id));
  const headSet = new Set(head);
  return [...head, ...ids.filter(id => !headSet.has(id))];
}

/**
 * Apply prefs to a providers.json document for /api/providers consumers:
 * disabled providers are omitted entirely (selectors, wizard and messaging
 * never see them) and the remainder is reordered. Non-destructive copy.
 */
export function applyProviderPrefs<T extends { providers?: Record<string, unknown> }>(data: T, prefs: ProviderPrefs): T {
  if (!data?.providers) return data;
  const disabled = new Set(prefs.disabled);
  const ids = orderProviderIds(Object.keys(data.providers), prefs).filter(id => !disabled.has(id));
  const providers: Record<string, unknown> = {};
  for (const id of ids) providers[id] = data.providers[id];
  return { ...data, providers };
}
