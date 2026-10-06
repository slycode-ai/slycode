import { NextResponse } from 'next/server';
import { getMessagingUrl } from '@/lib/paths';
import type { SpeechHealth } from '@/lib/speech-health';

export const dynamic = 'force-dynamic';

function down() {
  return { running: false, tts: null, speech: null, reason: { code: 'messaging_down', message: 'The messaging service is not running. Start it to allow spoken replies.' } };
}

/**
 * Availability probe for spoken replies (feature 086; speech DTO since 087).
 * { running: is the messaging service answering,
 *   tts: can it speak (legacy boolean, null when unknown),
 *   speech: the messaging speech-health DTO, passed through as-is (null when unknown),
 *   reason: { code: 'messaging_down', message } when the service doesn't answer }
 * Bounded to 1.5 s so a dead service cannot stall the UI.
 */
export async function GET() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1500);
  try {
    const res = await fetch(`${getMessagingUrl()}/health`, { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) return NextResponse.json(down());
    const data = (await res.json()) as { tts?: unknown; speech?: SpeechHealth | null };
    const speech = data.speech && typeof data.speech === 'object' && typeof data.speech.ready === 'boolean' ? data.speech : null;
    return NextResponse.json({ running: true, tts: speech ? speech.ready : typeof data.tts === 'boolean' ? data.tts : null, speech });
  } catch {
    return NextResponse.json(down());
  } finally {
    clearTimeout(timer);
  }
}
