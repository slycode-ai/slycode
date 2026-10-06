import { forwardJson } from '@/lib/messaging-voice-proxy';
import { isSpeechProviderId } from '@/lib/tts-provider-view';

export const dynamic = 'force-dynamic';

/** Local state only, so a short bound keeps a dead service from stalling the popover. */
const LIST_TIMEOUT_MS = 3_000;

/**
 * Every registered project's voice for one provider (default: the active one),
 * for the "Project voices" list (feature 087 phase 3).
 */
export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get('provider');
  const qs = isSpeechProviderId(provider) ? `?provider=${provider}` : '';
  return forwardJson(`/tts/project-voices${qs}`, { method: 'GET' }, LIST_TIMEOUT_MS,
    'The messaging service took too long to list project voices. Close and reopen Voice Settings to try again.');
}
