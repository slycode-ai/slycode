import { NextResponse } from 'next/server';
import { forwardJson } from '@/lib/messaging-voice-proxy';
import { requireSession } from '@/lib/route-auth';

export const dynamic = 'force-dynamic';

const DELETE_TIMEOUT_MS = 15_000;

/**
 * DELETE → discard a designed voice at Google (feature 087). The recipe stays
 * in messaging (marked deleted) so it can be recreated from the CLI.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = requireSession(request);
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!/^voice_[A-Za-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ ok: false, error: 'bad_request', message: 'Only designed voices can be discarded.' }, { status: 400 });
  }
  return forwardJson(`/voices/${encodeURIComponent(id)}`, { method: 'DELETE' }, DELETE_TIMEOUT_MS,
    'The messaging service took longer than 15 seconds to answer. The voice may still be deleted; reopen the voice list to check.');
}
