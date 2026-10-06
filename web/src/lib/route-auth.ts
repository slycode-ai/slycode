/**
 * Defence in depth for routes that write state or spend money (feature 087
 * fix loop): the proxy (src/proxy.ts) already gates every /api/* path, but a
 * matcher mistake there once let a path ending in ".js" through. These routes
 * re-check the session themselves, with the same rules as the proxy.
 */
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, isPasswordSet, verifySessionToken } from '@/lib/auth';

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** null when the request carries a valid session; otherwise the 401 to return. */
export function requireSession(request: Request): NextResponse | null {
  if (isPasswordSet() && verifySessionToken(cookieValue(request.headers.get('cookie'), SESSION_COOKIE)).session) return null;
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
