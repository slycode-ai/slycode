'use client';

import { useState } from 'react';
import { getProviderColor } from '@/lib/provider-colors';
import { ConfirmDialog } from './ConfirmDialog';

interface EndedSessionPanelProps {
  sessionName: string;
  provider: string;
  displayName: string;
  endedAt?: string;
  /** Called after a successful relink — parent re-scans sessions so the tab becomes resumable. */
  onRelinked: () => void;
  /** Called after the record is deleted — parent re-scans sessions. */
  onDismissed: () => void;
}

/**
 * Placeholder panel for a stopped session whose provider conversation id was
 * never captured (feature 080). Replaces the terminal for that tab: there is
 * nothing to resume, but the record is real — offer recovery or removal
 * instead of silently hiding it.
 */
export default function EndedSessionPanel({
  sessionName,
  provider,
  displayName,
  endedAt,
  onRelinked,
  onDismissed,
}: EndedSessionPanelProps) {
  const [busy, setBusy] = useState<'relink' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const colors = getProviderColor(provider);
  const encoded = encodeURIComponent(sessionName);

  const retryLink = async () => {
    setBusy('relink');
    setError(null);
    try {
      const res = await fetch(`/api/bridge/sessions/${encoded}/relink`, { method: 'POST' });
      if (res.ok) {
        onRelinked();
        return;
      }
      setError('No matching conversation found on disk — the session can’t be linked.');
    } catch {
      setError('Could not reach the bridge. Check that services are running and try again.');
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async () => {
    setConfirmDismiss(false);
    setBusy('dismiss');
    setError(null);
    try {
      // action=delete removes the persisted record; the endpoint's default
      // (action=stop) 404s on an already-stopped session
      const res = await fetch(`/api/bridge/sessions/${encoded}?action=delete`, { method: 'DELETE' });
      if (res.ok) {
        onDismissed();
        return;
      }
      setError('Could not remove the session record. Try again.');
    } catch {
      setError('Could not reach the bridge. Check that services are running and try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full border opacity-70" style={{ borderColor: colors.color }} />
        <span className="text-lg text-void-400 dark:text-void-400">{displayName} session ended</span>
      </div>
      <p className="max-w-md text-sm text-void-500 dark:text-void-500">
        This session stopped before its conversation was linked, so it can&apos;t be resumed.
        {endedAt && (
          <span className="mt-1 block text-xs text-void-400 dark:text-void-600">
            Ended {new Date(endedAt).toLocaleString()}
          </span>
        )}
      </p>
      <div className="mt-1 flex items-center gap-3">
        <button
          onClick={retryLink}
          disabled={busy !== null}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50"
          style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}`, color: colors.color }}
        >
          {busy === 'relink' ? 'Looking for conversation…' : 'Retry link'}
        </button>
        <button
          onClick={() => setConfirmDismiss(true)}
          disabled={busy !== null}
          className="rounded-lg border border-red-800/60 px-4 py-2 text-sm font-medium text-red-400 transition-all hover:border-red-700 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'dismiss' ? 'Removing…' : 'Dismiss'}
        </button>
      </div>
      {error && (
        <p className="max-w-md text-xs text-red-400">{error}</p>
      )}
      <ConfirmDialog
        open={confirmDismiss}
        onClose={() => setConfirmDismiss(false)}
        onConfirm={dismiss}
        title="Dismiss session"
        message={<>Remove the ended <span className="font-medium text-void-900 dark:text-void-200">{displayName}</span> session record from this card? The record can&apos;t be restored after removal.</>}
        confirmLabel="Dismiss"
      />
    </div>
  );
}
