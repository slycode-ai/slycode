import { NextResponse } from 'next/server';
import { forwardAudio } from '@/lib/messaging-voice-proxy';
import { isSpeechProviderId } from '@/lib/tts-provider-view';
import { requireSession } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

/** Messaging allows a preview 30 s (a busy provider queue plus one short render). */
const PREVIEW_TIMEOUT_MS = 35_000;

/**
 * POST { voiceId, voiceName, provider, revision } → audio/mpeg of one short
 * fixed sentence in that voice (feature 087 phase 3). Played by the picker
 * locally; never sent to the speaker stream or a channel.
 */
export async function POST(request: Request) {
  // Spends money: re-check the session here too (defence in depth).
  const denied = requireSession(request);
  if (denied) return denied;
  let body: Record<string, unknown> | null = null;
  try {
    const raw: unknown = await request.json();
    body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body.voiceId !== 'string' || !body.voiceId.trim() || !isSpeechProviderId(body.provider) || typeof body.revision !== 'number') {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Pick a voice from a search to preview it.' }, { status: 400 });
  }
  const forward = {
    voiceId: body.voiceId.trim(),
    voiceName: typeof body.voiceName === 'string' ? body.voiceName : undefined,
    provider: body.provider,
    revision: body.revision,
  };
  return forwardAudio('/voices/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forward),
  }, PREVIEW_TIMEOUT_MS, 'The preview took longer than 35 seconds. Try again in a moment.', request.signal);
}
