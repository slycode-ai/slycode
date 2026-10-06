'use client';

import { useState } from 'react';
import Tooltip from './Tooltip';

/**
 * Logout control (Feature 068). POSTs to /api/auth/logout to clear the session
 * cookie, then hard-navigates to /login so middleware re-gates the next request.
 */
export function LogoutButton({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* even if the request fails, send the user to /login */
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <Tooltip content="Sign out" placement="bottom">
      <button
        onClick={logout}
        disabled={busy}
        aria-label="Sign out"
        className={`rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1 disabled:opacity-50 ${className}`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 17l5-5m0 0l-5-5m5 5H9" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
        </svg>
      </button>
    </Tooltip>
  );
}
