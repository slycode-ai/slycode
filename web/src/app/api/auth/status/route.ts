import { NextResponse } from 'next/server';
import { isPasswordSet } from '@/lib/auth';
import { isCleartextWarningDisabled } from '@/lib/cleartext-warning';

export const dynamic = 'force-dynamic';

/**
 * Lightweight, unauthenticated: tells the client whether to show first-run
 * setup, and whether the plain-HTTP warning banner is switched on.
 */
export async function GET() {
  return NextResponse.json({ passwordSet: isPasswordSet(), cleartextWarning: !isCleartextWarningDisabled() });
}
