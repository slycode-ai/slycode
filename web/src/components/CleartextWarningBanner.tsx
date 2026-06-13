'use client';

/**
 * Cleartext warning (Feature 068).
 *
 * Shows a persistent banner when the dashboard is being served over plain HTTP
 * to a NON-loopback host — i.e. the password is travelling in cleartext over a
 * network. Loopback HTTP (127.0.0.1/localhost) never leaves the box, so it's
 * silent there. HTTPS (incl. via `tailscale serve` / a reverse proxy) is silent.
 *
 * Uses useSyncExternalStore so the value is computed client-only (server
 * snapshot = false), avoiding both a hydration mismatch and a setState-in-effect.
 */

import { useSyncExternalStore } from 'react';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const noopSubscribe = () => () => {};
const getClientSnapshot = () =>
  window.location.protocol === 'http:' && !LOOPBACK.has(window.location.hostname);
const getServerSnapshot = () => false;

export default function CleartextWarningBanner() {
  const show = useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot);

  if (!show) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-[100] w-full bg-red-600 text-white text-sm px-4 py-2 text-center shadow-md"
    >
      <strong>Insecure connection.</strong> Your password is being sent in cleartext over the
      network. Put HTTPS in front — use <code className="font-mono">tailscale serve</code> or a
      reverse proxy (e.g. Caddy/nginx).
    </div>
  );
}
