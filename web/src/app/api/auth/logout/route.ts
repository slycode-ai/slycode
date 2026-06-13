import { NextResponse } from 'next/server';
import { clearSessionCookie } from '@/lib/auth-cookie';

export const dynamic = 'force-dynamic';

/** Clear the session cookie. (The token also dies on reset via tokenVersion bump.) */
export async function POST() {
  return clearSessionCookie(NextResponse.json({ ok: true }));
}
