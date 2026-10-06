/**
 * Server-side forwarding for the web voice picker (feature 087 phase 3):
 * /api/messaging/voices/* → the messaging service. JSON answers pass through
 * with their status; unreachable → 503 with VOICES_DOWN_MESSAGE; a timeout →
 * 504 with a message saying what may still have happened.
 */
import { NextResponse } from 'next/server';
import { getMessagingUrl } from '@/lib/paths';
import { VOICES_DOWN_MESSAGE } from '@/lib/voice-picker-view';

export function voicesDown(): NextResponse {
  return NextResponse.json({ ok: false, error: 'messaging_down', message: VOICES_DOWN_MESSAGE }, { status: 503 });
}

export function voicesTimeout(message: string): NextResponse {
  return NextResponse.json({ ok: false, error: 'messaging_timeout', message }, { status: 504 });
}

async function withTimeout<T>(timeoutMs: number, run: (signal: AbortSignal) => Promise<T>, onTimeout: () => T, onDown: () => T, outer?: AbortSignal): Promise<T> {
  const ac = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);
  const onOuter = () => ac.abort();
  outer?.addEventListener('abort', onOuter);
  try {
    return await run(ac.signal);
  } catch {
    return timedOut ? onTimeout() : onDown();
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

/** Forward to a messaging path and pass its JSON answer through unchanged. */
export function forwardJson(path: string, init: RequestInit, timeoutMs: number, timeoutMessage: string): Promise<NextResponse> {
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(`${getMessagingUrl()}${path}`, { ...init, signal, cache: 'no-store' });
    const text = await res.text();
    try {
      JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, error: 'bad_response', message: `The messaging service answered HTTP ${res.status} without details. Restart it so it runs the current version of SlyCode.` },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    return new NextResponse(text, { status: res.status, headers: { 'Content-Type': 'application/json' } });
  }, () => voicesTimeout(timeoutMessage), voicesDown);
}

/**
 * Forward a preview render: audio passes through as bytes, errors as JSON.
 * The browser hanging up aborts the messaging request (which cancels the render).
 */
export function forwardAudio(path: string, init: RequestInit, timeoutMs: number, timeoutMessage: string, outer?: AbortSignal): Promise<NextResponse> {
  return withTimeout(timeoutMs, async (signal) => {
    const res = await fetch(`${getMessagingUrl()}${path}`, { ...init, signal, cache: 'no-store' });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.startsWith('audio/')) {
      const audio = await res.arrayBuffer();
      return new NextResponse(audio, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
    }
    const text = await res.text();
    try {
      JSON.parse(text);
      return new NextResponse(text, { status: res.ok ? 502 : res.status, headers: { 'Content-Type': 'application/json' } });
    } catch {
      return NextResponse.json(
        { ok: false, error: 'bad_response', message: `The messaging service answered HTTP ${res.status} without details. Restart it so it runs the current version of SlyCode.` },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
  }, () => voicesTimeout(timeoutMessage), voicesDown, outer);
}
