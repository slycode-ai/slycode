'use client';

/**
 * Board-page strip for a held project (card #0381). Everything done by hand
 * still works on a held board; this just says so and offers Resume/Restore.
 */

import { useState } from 'react';
import type { ProjectStatus } from '@/lib/types';
import { heldForLabel, PROJECT_STATUS_LABELS } from '@/lib/project-status';

interface ProjectStatusStripProps {
  projectId: string;
  status: Exclude<ProjectStatus, 'active'>;
  statusChangedAt?: string;
  onResumed: () => void;
}

export function ProjectStatusStrip({ projectId, status, statusChangedAt, onResumed }: ProjectStatusStripProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const since = heldForLabel(statusChangedAt);
  const action = status === 'archived' ? 'Restore' : 'Resume';

  const resume = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `${action} failed (${res.status})`);
      }
      onResumed();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-warn/25 bg-warn/[0.07]">
      <div className="mx-auto flex max-w-[1920px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[13px] text-ink-2 sm:px-6">
        <span className="h-3 w-0.5 flex-none rounded-full bg-warn" aria-hidden />
        <span className="min-w-0 flex-1">
          <b className="font-semibold text-ink-1">{PROJECT_STATUS_LABELS[status]}{since ? ` ${since} ago` : ''}.</b>{' '}
          Automations, scheduled sends and the atlas refresh are held. Anything you do by hand still works.
        </span>
        {error && <span className="text-danger-text">{error}</span>}
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="h-7 flex-none rounded-md bg-primary px-3 text-[12px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          {busy ? `${action === 'Restore' ? 'Restoring' : 'Resuming'}…` : action}
        </button>
      </div>
    </div>
  );
}
