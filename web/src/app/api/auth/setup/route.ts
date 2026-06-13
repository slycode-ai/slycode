import { NextResponse } from 'next/server';
import { isPasswordSet, setInitialPassword, createSessionToken } from '@/lib/auth';
import { isHttps, setSessionCookie } from '@/lib/auth-cookie';

export const dynamic = 'force-dynamic';

/** Minimum password length for first-run creation. */
const MIN_LENGTH = 6;

/**
 * First-run only: set the initial password when none exists. Returns a session
 * cookie so the user lands straight on the dashboard. Refuses (409) once a
 * password is already set — use /api/auth/login (and reset via the CLI).
 */
export async function POST(req: Request) {
  if (isPasswordSet()) {
    return NextResponse.json({ error: 'already_set' }, { status: 409 });
  }
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const password = body.password ?? '';
  if (typeof password !== 'string' || password.length < MIN_LENGTH) {
    return NextResponse.json(
      { error: 'weak_password', message: `Password must be at least ${MIN_LENGTH} characters.` },
      { status: 400 },
    );
  }
  try {
    setInitialPassword(password);
  } catch {
    // Race: someone set it between the check and now.
    return NextResponse.json({ error: 'already_set' }, { status: 409 });
  }
  const res = NextResponse.json({ ok: true });
  return setSessionCookie(res, createSessionToken(), isHttps(req));
}
