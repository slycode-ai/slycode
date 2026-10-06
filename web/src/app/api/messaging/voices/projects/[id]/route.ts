import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/messaging-voice-proxy';
import { isSpeechProviderId } from '@/lib/tts-provider-view';
import { requireSession } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

/** A Gemini id is checked against the catalogue before it is saved. */
const CHANGE_TIMEOUT_MS = 15_000;
const TIMEOUT_MESSAGE = 'The messaging service took longer than 15 seconds to answer. The change may still go through; reopen Voice Settings to check.';

type Ctx = { params: Promise<{ id: string }> };

function badRequest(message: string) {
  return NextResponse.json({ ok: false, error: 'bad_request', message }, { status: 400 });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * PUT { voiceId, voiceName, provider, revision } → set the project's voice for
 * that provider. The provider and revision come from the search that found
 * the voice; messaging answers 409 stale_provider when a switch happened since.
 */
export async function PUT(request: Request, ctx: Ctx) {
  const denied = requireSession(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await readBody(request);
  if (!body || typeof body.voiceId !== 'string' || !body.voiceId.trim()) return badRequest('Pick a voice to use.');
  if (!isSpeechProviderId(body.provider) || typeof body.revision !== 'number') return badRequest('This voice list is missing its provider; search again.');
  const forward = {
    voiceId: body.voiceId.trim(),
    voiceName: typeof body.voiceName === 'string' ? body.voiceName : body.voiceId.trim(),
    provider: body.provider,
    revision: body.revision,
  };
  return forwardJson(`/projects/${encodeURIComponent(id)}/voice`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(forward),
  }, CHANGE_TIMEOUT_MS, TIMEOUT_MESSAGE);
}

/** DELETE ?provider&revision → clear the project's own voice for that provider (it falls back to the default). */
export async function DELETE(request: Request, ctx: Ctx) {
  const denied = requireSession(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  const incoming = new URL(request.url).searchParams;
  const provider = incoming.get('provider');
  const revision = incoming.get('revision');
  if (!isSpeechProviderId(provider) || !revision || !/^\d+$/.test(revision)) return badRequest('This voice list is missing its provider; reopen Voice Settings.');
  return forwardJson(`/projects/${encodeURIComponent(id)}/voice?provider=${provider}&revision=${revision}`, { method: 'DELETE' }, CHANGE_TIMEOUT_MS, TIMEOUT_MESSAGE);
}
