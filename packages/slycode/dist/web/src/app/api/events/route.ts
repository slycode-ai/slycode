/**
 * Events API — GET /api/events
 *
 * Query the activity event log with optional filters.
 * Params: project, type, limit (default 50), since (ISO timestamp)
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryEvents } from '@/lib/event-log';
import type { EventType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const project = searchParams.get('project') || undefined;
    const type = searchParams.get('type') as EventType | undefined;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const since = searchParams.get('since') || undefined;

    const events = queryEvents({ project, type, limit, since });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Failed to query events:', error);
    return NextResponse.json(
      { error: 'Failed to query events', details: String(error) },
      { status: 500 },
    );
  }
}
