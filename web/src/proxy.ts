/**
 * Global auth gate (Feature 068).
 *
 * Next.js Proxy file (the `proxy.ts` convention that replaced `middleware.ts`
 * in Next 16; renamed here under card #0349 on 16.3.4). Proxy always runs on
 * the Node.js runtime — a `runtime` key in `config` is rejected at build time
 * (E1031) — so it can read ~/.slycode/auth.json and verify the session cookie
 * with node:crypto directly: no secret injection, works the same in dev and
 * prod. Gates the entire app, including all /api/* routes and the bridge
 * proxy, in one place (the 41 API routes have no shared wrapper).
 *
 * Bridge and messaging services are NOT affected by this — they are separate
 * processes on localhost. Automations drive the bridge directly and never pass
 * through here, so nothing here can lock them out.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isPasswordSet, verifySessionToken, SESSION_COOKIE } from '@/lib/auth';

export const config = {
  // Run on everything except Next internals and the real public files. The
  // extension rule only skips ROOT-level files (public/*.webp, favicon.png …)
  // and the bundled Monaco editor (public/monaco/) — never a deeper path, so a
  // dynamic segment that merely ends in an extension (/api/…/projects/Next.js,
  // /project/next.js, /doc-viewer/…/style.css) is still gated (#0369).
  // Checked against Next's own matcher compiler in src/lib/proxy-matcher.test.ts.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico|monaco/|[^/]+\\.(?:png|jpg|jpeg|svg|ico|webp|gif|css|js|woff2?|ttf)$).*)'],
};

// Paths always reachable (the auth flow itself + its API).
const PUBLIC_PATHS = new Set<string>(['/login', '/setup']);
const PUBLIC_API = new Set<string>([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/setup',
  '/api/auth/status',
]);

function isApi(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

function deny(req: NextRequest, to: '/login' | '/setup'): NextResponse {
  if (isApi(req.nextUrl.pathname)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = to;
  url.search = '';
  return NextResponse.redirect(url);
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Always let the auth API through.
  if (PUBLIC_API.has(pathname)) return NextResponse.next();

  const passwordSet = isPasswordSet();

  // First-run: no password yet → only the setup screen is reachable.
  if (!passwordSet) {
    if (pathname === '/setup') return NextResponse.next();
    return deny(req, '/setup');
  }

  // Password exists → require a valid session for everything but /login.
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const { session } = verifySessionToken(token);
  const authed = !!session;

  if (PUBLIC_PATHS.has(pathname)) {
    // Already-authed users shouldn't sit on /login or /setup.
    if (authed) {
      const url = req.nextUrl.clone();
      url.pathname = '/';
      url.search = '';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (authed) return NextResponse.next();
  return deny(req, '/login');
}
