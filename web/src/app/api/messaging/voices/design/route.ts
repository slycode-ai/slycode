import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/messaging-voice-proxy';
import { requireSession } from '@/lib/route-auth';
import { DESIGN_GENDERS } from '@/lib/voice-picker-view';

export const dynamic = 'force-dynamic';

/** Messaging allows the design call 90 s (it took ~20–26 s live), plus the sample encode. */
const DESIGN_TIMEOUT_MS = 120_000;

/**
 * POST { description, name, gender?, language?, revision } → design a Gemini
 * voice (feature 087). Spends money: the session is re-checked here, and the
 * list's revision goes along so a stale panel never starts a paid call. The
 * sample comes back as MP3 for the panel to play.
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
  const description = str(body?.description);
  const name = str(body?.name);
  if (!body || !description || !name) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Describe the voice and give it a name.' }, { status: 400 });
  }
  if (typeof body.revision !== 'number') {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'This voice list is missing its provider; search again.' }, { status: 400 });
  }
  const gender = str(body.gender);
  if (gender && !DESIGN_GENDERS.some((g) => g.id === gender)) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Gender must be female, male or neutral.' }, { status: 400 });
  }
  const forward = {
    description, name, revision: body.revision, returnSample: 'mp3',
    ...(gender ? { gender } : {}),
    ...(str(body.language) ? { language: str(body.language) } : {}),
  };
  return forwardJson('/voices/design', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forward),
  }, DESIGN_TIMEOUT_MS, 'The design took longer than 2 minutes. It may still have been made; reopen the voice list to check before trying again.');
}
