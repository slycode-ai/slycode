import { NextResponse, type NextRequest } from 'next/server';
import { readAutomationLog } from '@/lib/scheduler';

// Read-only view over ~/.slycode/logs/automation.log, scoped to one card.
// Separate from ../route.ts because that handler is a command dispatcher
// (POST + action) and this is a plain GET query.

const DEFAULT_LIMIT = 20;

export async function GET(request: NextRequest) {
  try {
    const cardId = request.nextUrl.searchParams.get('cardId');
    if (!cardId) {
      return NextResponse.json({ error: 'cardId required' }, { status: 400 });
    }

    const limitParam = request.nextUrl.searchParams.get('limit');
    const parsed = limitParam ? parseInt(limitParam, 10) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;

    // A card that has never run returns [] with 200 — absence of history is
    // a normal state, not an error.
    const runs = await readAutomationLog(cardId, limit);
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
