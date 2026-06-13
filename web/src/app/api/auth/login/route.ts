import { NextResponse } from 'next/server';
import { isPasswordSet, verifyLoginAttempt, createSessionToken, backoffDelayMs } from '@/lib/auth';
import { clientIp, isHttps, setSessionCookie } from '@/lib/auth-cookie';

export const dynamic = 'force-dynamic';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Verify the shared password and issue a session cookie. Lockout-aware:
 * applies a per-failure backoff delay and returns 429 while cooling down.
 */
export async function POST(req: Request) {
  if (!isPasswordSet()) {
    return NextResponse.json({ error: 'no_password' }, { status: 409 });
  }
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  const ip = clientIp(req);

  // Backoff BEFORE processing — slows scripted guessing on this IP.
  const delay = backoffDelayMs(ip);
  if (delay > 0) await sleep(delay);

  const result = verifyLoginAttempt(body.password ?? '', ip);
  if (result.ok) {
    const res = NextResponse.json({ ok: true });
    return setSessionCookie(res, createSessionToken(), isHttps(req));
  }
  if (result.locked) {
    const retrySec = Math.max(1, Math.ceil((result.retryAfterMs ?? 0) / 1000));
    return NextResponse.json(
      { error: 'locked', message: 'Too many attempts. Try again later.', retryAfterSec: retrySec },
      { status: 429, headers: { 'Retry-After': String(retrySec) } },
    );
  }
  return NextResponse.json({ error: 'invalid' }, { status: 401 });
}
