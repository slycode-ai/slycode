/**
 * Speaker-permission snapshot line for card-context injections (feature 086).
 *
 * Wording is fixed by the design doc ("Codex round 3 additions") and is a
 * STATE snapshot, never an instruction: an ON snapshot conveys neither an
 * ask nor a guarantee that a browser is listening. Mirrored (lockstep) in
 * scripts/kanban.js (CLI prompt preamble) and messaging/src/sly-action-filter.ts
 * (Telegram-triggered Sly actions) — keep the three copies identical.
 */

export type SpeakerSnapshot = 'on' | 'off' | 'unknown';

export function formatSpeakerLine(state: SpeakerSnapshot): string {
  return `Speaker permission: ${state} (snapshot; use sly-messaging speak only if the user explicitly asked this session for spoken summaries; the command checks current state)`;
}

/**
 * Server-side: read the bridge's global speaker flag at dispatch time.
 * Bounded (default 500 ms) so a slow or absent bridge never delays delivery;
 * any failure resolves to 'unknown'.
 */
export async function fetchSpeakerState(bridgeUrl: string, timeoutMs = 500): Promise<SpeakerSnapshot> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${bridgeUrl}/speaker`, { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) return 'unknown';
    const data = (await res.json()) as { enabled?: unknown };
    if (data.enabled === true) return 'on';
    if (data.enabled === false) return 'off';
    return 'unknown';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}
