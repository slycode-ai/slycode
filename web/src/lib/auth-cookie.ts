/**
 * Request/response helpers for the web auth gate (Feature 068).
 * Kept separate from auth.ts so the pure crypto/logic core has no Next deps.
 */

import { NextResponse } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_MS } from './auth';

/** Best-effort client IP for lockout keying (trusts proxy headers). */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('cf-connecting-ip') ||
    'unknown'
  );
}

/**
 * Whether the request reached us over HTTPS. Trusts X-Forwarded-Proto so that
 * `tailscale serve` / reverse-proxy TLS termination is detected correctly.
 */
export function isHttps(req: Request): boolean {
  const proto = req.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Attach the session cookie to a response (Secure only when actually on HTTPS). */
export function setSessionCookie(res: NextResponse, token: string, secure: boolean): NextResponse {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}

export function clearSessionCookie(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return res;
}
