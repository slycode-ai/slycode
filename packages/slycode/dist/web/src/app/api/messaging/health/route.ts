import { NextResponse } from 'next/server';
import { getMessagingUrl } from '@/lib/paths';

export const dynamic = 'force-dynamic';

/**
 * Availability probe for spoken replies (feature 086).
 * { running: is the messaging service answering, tts: does it have ElevenLabs configured (null when unknown) }
 * Bounded to 1.5 s so a dead service cannot stall the UI.
 */
export async function GET() {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 1500);
  try {
    const res = await fetch(`${getMessagingUrl()}/health`, { signal: ac.signal, cache: 'no-store' });
    if (!res.ok) return NextResponse.json({ running: false, tts: null });
    const data = (await res.json()) as { tts?: unknown };
    return NextResponse.json({ running: true, tts: typeof data.tts === 'boolean' ? data.tts : null });
  } catch {
    return NextResponse.json({ running: false, tts: null });
  } finally {
    clearTimeout(timer);
  }
}
