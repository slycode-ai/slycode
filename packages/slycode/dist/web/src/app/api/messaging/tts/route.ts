import { NextResponse } from 'next/server';
import { getMessagingUrl } from '@/lib/paths';
import { MESSAGING_DOWN_MESSAGE, isSpeechProviderId } from '@/lib/tts-provider-view';

export const dynamic = 'force-dynamic';

/** Reads are bounded like the health probe so a dead service cannot stall the popover. */
const GET_TIMEOUT_MS = 1500;
/** A switch may look every project's voice up with the new provider first. */
const PUT_TIMEOUT_MS = 15_000;

function messagingDown() {
  return NextResponse.json({ ok: false, error: 'messaging_down', message: MESSAGING_DOWN_MESSAGE }, { status: 503 });
}

/**
 * Forward to messaging's /tts/provider and pass its status + JSON body through
 * unchanged. Unreachable → 503 messaging_down; a non-JSON answer (e.g. an
 * older messaging build without the route) → 502 with a readable message.
 */
async function forward(init: RequestInit, timeoutMs: number, onTimeout: () => NextResponse): Promise<NextResponse> {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  try {
    const res = await fetch(`${getMessagingUrl()}/tts/provider`, { ...init, signal: ac.signal, cache: 'no-store' });
    const text = await res.text();
    try {
      JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'bad_response', message: `The messaging service answered HTTP ${res.status} without details. Restart it so it runs the current version of SlyCode.` },
        { status: 502 },
      );
    }
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return timedOut ? onTimeout() : messagingDown();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Install-wide TTS provider (feature 087).
 * GET → messaging's { ok: true, ...SpeechHealth }.
 */
export async function GET() {
  return forward({ method: 'GET' }, GET_TIMEOUT_MS, messagingDown);
}

/**
 * PUT { provider: 'elevenlabs' | 'gemini' } → switch the install's provider.
 * Messaging answers 200 (switched, maybe with `unverified` voices), 409
 * unusable_voices (refused, nothing changed) or 400; all passed through.
 * A slow answer is NOT reported as "not running": the switch may still land.
 */
export async function PUT(request: Request) {
  let provider: unknown;
  try {
    provider = ((await request.json()) as { provider?: unknown } | null)?.provider;
  } catch {
    provider = undefined;
  }
  if (!isSpeechProviderId(provider)) {
    return NextResponse.json(
      { ok: false, error: 'bad_request', message: 'Pick a voice provider: "elevenlabs" or "gemini".' },
      { status: 400 },
    );
  }
  return forward(
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider }) },
    PUT_TIMEOUT_MS,
    () => NextResponse.json(
      {
        ok: false,
        error: 'messaging_timeout',
        message: 'The messaging service took longer than 15 seconds to answer. The switch may still go through; close and reopen Voice Settings to check.',
      },
      { status: 504 },
    ),
  );
}
