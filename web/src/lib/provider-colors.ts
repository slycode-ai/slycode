export interface ProviderColorSet { color: string; bg: string; border: string; dot: string }

const defaultProviderColor: ProviderColorSet = {
  color: '#00bfff',
  bg: 'rgba(0, 191, 255, 0.15)',
  border: 'rgba(0, 191, 255, 0.4)',
  dot: '#00bfff',
};

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Build the pill/tab colour set from a single brand hex. */
export function colorSetFromHex(hex: string): ProviderColorSet {
  const rgb = hexToRgb(hex);
  if (!rgb) return defaultProviderColor;
  const [r, g, b] = rgb;
  return {
    color: hex,
    bg: `rgba(${r}, ${g}, ${b}, 0.15)`,
    border: `rgba(${r}, ${g}, ${b}, 0.4)`,
    dot: hex,
  };
}

/**
 * Provider colour table. The source of truth is data/providers.json
 * (`color.hex`, feature 085 sweep); `registerProviderColors` hydrates this
 * table from /api/providers. The seed values below mirror the registry so the
 * first paint (before the fetch resolves) matches — they are a cache, not a
 * second definition. Providers absent from both get the neutral default.
 */
export const providerColors: Record<string, ProviderColorSet> = {
  claude: colorSetFromHex('#d4764e'),
  codex: colorSetFromHex('#6b8fae'),
  gemini: colorSetFromHex('#8b7ec8'),
};

/** Hydrate from registry entries (idempotent). */
export function registerProviderColors(entries: Array<{ id: string; color?: { hex?: string } }>): void {
  for (const e of entries) {
    if (e.color?.hex) providerColors[e.id] = colorSetFromHex(e.color.hex);
  }
}

let hydrationStarted = false;

/**
 * Lazily fetch the registry once in the browser so callers that never mount
 * `useProviders()` still converge on registry colours. Colours already known
 * render immediately; a provider first seen after hydration is re-rendered by
 * whatever state change introduced it.
 */
function ensureHydrated(): void {
  if (hydrationStarted || typeof window === 'undefined' || typeof fetch !== 'function') return;
  hydrationStarted = true;
  fetch('/api/providers')
    .then(res => (res.ok ? res.json() : null))
    .then((data: { providers?: Record<string, { color?: { hex?: string } }> } | null) => {
      if (!data?.providers) return;
      registerProviderColors(Object.entries(data.providers).map(([id, p]) => ({ id, color: p.color })));
    })
    .catch(() => { /* keep seeds */ });
}

export function getProviderColor(providerId: string): ProviderColorSet {
  ensureHydrated();
  return providerColors[providerId] || defaultProviderColor;
}
