import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/messaging-voice-proxy';
import { requireSession } from '@/lib/route-auth';
import { consentFor } from '@/lib/consent-statements';

export const dynamic = 'force-dynamic';

/** The clone call gets Google's 90 s at messaging, plus the sample encode. */
const CLONE_TIMEOUT_MS = 120_000;
/**
 * Two base64 WAVs: 30 s + 20 s at 24 kHz mono is about 3.2 MB. Messaging
 * caps the body at 6 MB; Next's login proxy buffers up to 10 MB by default
 * (experimental.proxyClientMaxBodySize), so no config change is needed.
 */
const MAX_RECORDINGS_CHARS = 6 * 1024 * 1024;

/**
 * POST { name, locale, sample, consent, revision } → clone a Gemini voice
 * from the person's own recordings (#0376). Spends money: the session is
 * re-checked here and the list's revision goes along so a stale panel never
 * starts a paid call. The recordings pass straight through; nothing here
 * keeps or logs them.
 */
export async function POST(request: Request) {
  const denied = requireSession(request);
  if (denied) return denied;
  let body: Record<string, unknown> | null = null;
  try {
    const raw: unknown = await request.json();
    body = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    body = null;
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const name = str(body?.name);
  const sample = str(body?.sample);
  const consent = str(body?.consent);
  if (!body || !name) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Give the voice a name.' }, { status: 400 });
  }
  if (!sample || !consent) {
    return NextResponse.json({ ok: false, error: 'missing_recording', message: 'Both recordings are needed: your voice sample and the consent statement.' }, { status: 400 });
  }
  if (sample.length + consent.length > MAX_RECORDINGS_CHARS) {
    return NextResponse.json({ ok: false, error: 'too_large', message: 'The recordings are too large. Keep the sample to 30 seconds and the consent to 20.' }, { status: 413 });
  }
  if (typeof body.revision !== 'number') {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'This voice list is missing its provider; search again.' }, { status: 400 });
  }
  const locale = str(body.locale);
  if (locale && !consentFor(locale)) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Choose the language you read the consent statement in.' }, { status: 400 });
  }
  const forward = { name, sample, consent, revision: body.revision, returnSample: 'mp3', ...(locale ? { locale } : {}) };
  return forwardJson('/voices/clone', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forward),
  }, CLONE_TIMEOUT_MS, 'Cloning took longer than 2 minutes. It may still have been made; reopen the voice list to check before trying again.');
}
