'use client';

/**
 * Client-side provider registry (feature 085 sweep).
 *
 * One cached fetch of /api/providers shared by every component that needs the
 * provider list (badges, selectors, wizard). Components never hardcode provider
 * ids; they render whatever the registry holds. Also hydrates the provider
 * colour table so pills/badges pick up registry colours.
 */
import { useEffect, useState } from 'react';
import { registerProviderColors } from './provider-colors';

export interface ProviderEntry {
  id: string;
  displayName: string;
  command: string;
  install?: string;
  instructionFile?: string;
  agentIdentity?: string;
  transport?: string;
  color?: { hex: string; tailwind: { bg: string; text: string }; token?: string };
  model?: { flag: string; available?: Array<{ id: string; label: string; description?: string }>; refreshCommand?: string[] };
}

let cached: ProviderEntry[] | null = null;
let inflight: Promise<ProviderEntry[]> | null = null;
const listeners = new Set<(entries: ProviderEntry[]) => void>();

function parseEntries(data: unknown): ProviderEntry[] {
  const providers = (data as { providers?: Record<string, Omit<ProviderEntry, 'id'> & { id?: string }> })?.providers ?? {};
  return Object.entries(providers).map(([id, p]) => ({ ...p, id: p.id ?? id }));
}

export function fetchProviders(force = false): Promise<ProviderEntry[]> {
  if (cached && !force) return Promise.resolve(cached);
  if (inflight && !force) return inflight;
  inflight = fetch('/api/providers')
    .then(res => (res.ok ? res.json() : Promise.reject(new Error(`providers ${res.status}`))))
    .then(data => {
      const entries = parseEntries(data);
      cached = entries;
      registerProviderColors(entries);
      listeners.forEach(l => l(entries));
      return entries;
    })
    .catch(() => cached ?? [])
    .finally(() => { inflight = null; });
  return inflight;
}

/** Drop the cache (after a registry write such as a model refresh). */
export function invalidateProviders(): void {
  cached = null;
}

/**
 * Hook: the registry entries (empty until loaded), plus `loaded`. Optional
 * `include` filters by id; unknown ids are simply absent.
 */
export function useProviders(): { providers: ProviderEntry[]; loaded: boolean } {
  const [providers, setProviders] = useState<ProviderEntry[]>(cached ?? []);
  const [loaded, setLoaded] = useState<boolean>(cached !== null);

  useEffect(() => {
    let active = true;
    const onUpdate = (entries: ProviderEntry[]) => { if (active) { setProviders(entries); setLoaded(true); } };
    listeners.add(onUpdate);
    void fetchProviders().then(onUpdate);
    return () => { active = false; listeners.delete(onUpdate); };
  }, []);

  return { providers, loaded };
}

/** Short badge label: the display name without a trailing " Code"/" CLI" suffix. */
export function shortProviderLabel(entry: Pick<ProviderEntry, 'id' | 'displayName'>): string {
  const name = entry.displayName || entry.id;
  return name.replace(/\s+(Code|CLI)$/i, '');
}
