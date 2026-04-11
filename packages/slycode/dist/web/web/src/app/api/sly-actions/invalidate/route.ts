/**
 * Cache invalidation endpoint for sly-actions.
 * POST /api/sly-actions/invalidate
 *
 * Called after SlyActionConfigModal closes or after accepting action updates.
 */

import { NextResponse } from 'next/server';
import { invalidateActionsCache } from '@/lib/action-scanner';

export async function POST() {
  invalidateActionsCache();
  return NextResponse.json({ success: true });
}
