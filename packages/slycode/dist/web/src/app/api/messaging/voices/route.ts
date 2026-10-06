import { forwardJson } from '@/lib/messaging-voice-proxy';

export const dynamic = 'force-dynamic';

/** The first Gemini search loads its ~2,000-voice catalogue; later ones are local. */
const SEARCH_TIMEOUT_MS = 12_000;
const PASS = ['q', 'provider', 'gender', 'accent', 'language', 'custom'] as const;

/**
 * Voice search for the web picker (feature 087 phase 3).
 * GET ?q&provider&gender&language → messaging /voices/search, stamped with
 * { provider, revision } so a later set/preview can be checked for staleness.
 */
export async function GET(request: Request) {
  const incoming = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  for (const key of PASS) {
    const v = incoming.get(key);
    if (v) params.set(key, v.slice(0, 200));
  }
  return forwardJson(`/voices/search?${params}`, { method: 'GET' }, SEARCH_TIMEOUT_MS,
    'The voice search took longer than 12 seconds. Try again in a moment.');
}
