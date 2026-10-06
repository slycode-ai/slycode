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
 *
 * SLYCODE_CLEARTEXT_WARNING=off switches it off (trusted network, or an
 * instance with no password). The flag comes from /api/auth/status at runtime
 * rather than being rendered into the layout, so it also works in prebuilt
 * production output. If that check fails, the banner shows (fail safe).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const noopSubscribe = () => () => {};
const getClientSnapshot = () =>
  window.location.protocol === 'http:' && !LOOPBACK.has(window.location.hostname);
const getServerSnapshot = () => false;

export default function CleartextWarningBanner() {
  const insecure = useSyncExternalStore(noopSubscribe, getClientSnapshot, getServerSnapshot);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!insecure) return;
    let cancelled = false;
    fetch('/api/auth/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { cleartextWarning?: boolean } | null) => { if (!cancelled) setEnabled(d?.cleartextWarning !== false); })
      .catch(() => { if (!cancelled) setEnabled(true); });
    return () => { cancelled = true; };
  }, [insecure]);

  if (!insecure || !enabled) return null;

  return (
    <div
      role="alert"
      className="sticky top-0 z-[100] w-full border-b border-warn/40 bg-warn/15 px-4 py-2 text-center text-[13px] text-ink-1 backdrop-blur"
    >
      <strong>Insecure connection.</strong> Your password is being sent in cleartext over the
      network. Put HTTPS in front — use <code className="font-mono">tailscale serve</code> or a
      reverse proxy (e.g. Caddy/nginx).
    </div>
  );
}
