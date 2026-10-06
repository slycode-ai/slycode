import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/messaging-voice-proxy';
import { isSpeechProviderId } from '@/lib/tts-provider-view';
import { requireSession } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

/** A Gemini id is checked against the catalogue before it is saved. */
const CHANGE_TIMEOUT_MS = 15_000;
const TIMEOUT_MESSAGE = 'The messaging service took longer than 15 seconds to answer. The change may still go through; reopen Voice Settings to check.';

/**
 * PUT { voiceId, voiceName, provider, revision } → set the install default:
 * the voice every project without its own inherits (#0376). Stamped like a
 * project set; messaging answers 409 stale_provider after a switch.
 */
export async function PUT(request: Request) {
  const denied = requireSession(request);
  if (denied) return denied;
  let body: Record<string, unknown> | null = null;
  try {
    const raw: unknown = await request.json();
    body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  if (!body || typeof body.voiceId !== 'string' || !body.voiceId.trim()) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Pick a voice to use.' }, { status: 400 });
  }
  if (!isSpeechProviderId(body.provider) || typeof body.revision !== 'number') {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'This voice list is missing its provider; search again.' }, { status: 400 });
  }
  const forward = {
    voiceId: body.voiceId.trim(),
    voiceName: typeof body.voiceName === 'string' ? body.voiceName : body.voiceId.trim(),
    provider: body.provider,
    revision: body.revision,
  };
  return forwardJson('/tts/default-voice', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forward),
  }, CHANGE_TIMEOUT_MS, TIMEOUT_MESSAGE);
}
