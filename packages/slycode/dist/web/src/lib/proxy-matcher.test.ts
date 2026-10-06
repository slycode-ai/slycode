/**
 * The auth proxy's matcher (src/proxy.ts) compiled exactly as Next compiles it
 * (getMiddlewareMatchers + getMiddlewareRouteMatcher), so a path the matcher
 * skips is a path that bypasses the login gate. Regression for #0369: a
 * dynamic segment ending in a file extension (a project named "Next.js")
 * used to skip the gate on /api/* and page routes alike.
 *
 *   cd web && ../bridge/node_modules/.bin/tsx --test src/lib/proxy-matcher.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../proxy';

type MatcherFns = {
  getMiddlewareMatchers?: (m: unknown, c: unknown) => unknown;
  getMiddlewareRouteMatcher?: (m: unknown) => (p: string, r: unknown, q: unknown) => boolean;
};

/** Next's own functions (CJS modules, so they may sit on `default` when imported). */
function pick(mod: unknown): MatcherFns {
  const m = mod as MatcherFns & { default?: MatcherFns };
  return { ...m.default, ...m };
}

async function gate(): Promise<(pathname: string) => boolean> {
  const { getMiddlewareMatchers } = pick(await import('next/dist/build/analysis/get-page-static-info.js'));
  const { getMiddlewareRouteMatcher } = pick(await import('next/dist/shared/lib/router/utils/middleware-route-matcher.js'));
  assert.ok(getMiddlewareMatchers && getMiddlewareRouteMatcher, 'Next matcher internals moved; update this test');
  const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, {}));
  return (pathname) => matches(pathname, {}, {});
}

test('every /api/* path is gated whatever its suffix (project id ending in .js)', async () => {
  const gated = await gate();
  for (const p of [
    '/api/messaging/voices/projects/Next.js',
    '/api/messaging/voices/projects/next.js',
    '/api/messaging/voices/projects/site.css',
    '/api/kanban/cards/logo.svg',
    '/api/bridge/sessions/a.woff2',
    '/api/messaging/voices',
    '/api/messaging/voices/preview',
  ]) assert.equal(gated(p), true, `${p} must pass through the login gate`);
});

test('dynamic page routes ending in an extension are gated too', async () => {
  const gated = await gate();
  for (const p of [
    '/project/next.js',
    '/project/next.js/some-token',
    '/doc-viewer/documentation/notes/style.css',
    '/html-viewer/documentation/designs/mock.svg',
    '/doc-viewer/web/src/app.js',
    '/',
    '/global',
    '/login',
    '/setup',
  ]) assert.equal(gated(p), true, `${p} must pass through the login gate`);
});

test('static assets stay reachable without a session (login page, Next internals, Monaco)', async () => {
  const gated = await gate();
  for (const p of [
    '/_next/static/chunks/main-app.js',
    '/_next/static/css/app.css',
    '/_next/image',
    '/favicon.ico',
    '/favicon.png',
    '/slycode_logo.webp',
    '/slycode_logo_light.webp',
    '/slycode.webp',
    '/next.svg',
    '/monaco/vs/editor.api-CalNCsUg.js',
    '/monaco/vs/editor/editor.main.css',
  ]) assert.equal(gated(p), false, `${p} must not be gated`);
});
