import { NextResponse } from 'next/server';
import { isPasswordSet } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Lightweight, unauthenticated: tells the client whether to show first-run setup. */
export async function GET() {
  return NextResponse.json({ passwordSet: isPasswordSet() });
}
