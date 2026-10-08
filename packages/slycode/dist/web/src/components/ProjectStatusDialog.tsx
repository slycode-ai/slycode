'use client';

/**
 * Confirm a move to Paused / Complete / Archived (card #0381). Lists what
 * the project will hold. Never touches running sessions — pausing just
 * pauses (owner ruling), so there is no stop-sessions option.
 */

import { useEffect, useRef, useState } from 'react';
import type { ProjectStatus } from '@/lib/types';
import { cronToHumanReadable } from '@/lib/cron-utils';
import { formatDateTimeShort } from '@/lib/date-format';

interface HeldItem {
  kind: 'automation' | 'scheduled_prompt' | 'atlas';
  cardId?: string;
  number?: number;
  title: string;
  when: string;
}

const COPY: Record<Exclude<ProjectStatus, 'active'>, { title: (n: string) => string; body: string; action: string; busy: string }> = {
  paused: {
    title: (n) => `Pause ${n}?`,
    body: 'Pausing hides it from the Den and holds everything that runs on a timer. Nothing is deleted.',
    action: 'Pause project',
    busy: 'Pausing…',
  },
  complete: {
    title: (n) => `Mark ${n} complete?`,
    body: 'Complete projects drop out of the Den and stop running anything on a timer. Nothing is deleted.',
    action: 'Mark complete',
    busy: 'Saving…',
  },
  archived: {
    title: (n) => `Archive ${n}?`,
    body: 'Archived projects go cold: out of the Den, search and Telegram, with nothing on a timer, until you restore them. Nothing is deleted.',
    action: 'Archive project',
    busy: 'Archiving…',
  },
};

function whenLabel(item: HeldItem): string {
  if (item.kind === 'atlas') return cronToHumanReadable(item.when, 'recurring').toLowerCase();
  const t = Date.parse(item.when);
  if (item.kind === 'scheduled_prompt' || (Number.isFinite(t) && /T\d/.test(item.when))) {
    return Number.isFinite(t) ? formatDateTimeShort(item.when) : item.when;
  }
  return cronToHumanReadable(item.when, 'recurring').toLowerCase();
}

interface ProjectStatusDialogProps {
  projectId: string;
  projectName: string;
  next: Exclude<ProjectStatus, 'active'>;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function ProjectStatusDialog({ projectId, projectName, next, onConfirm, onCancel }: ProjectStatusDialogProps) {
  const [items, setItems] = useState<HeldItem[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const copy = COPY[next];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${encodeURIComponent(projectId)}/status`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { items?: HeldItem[] }) => { if (!cancelled) setItems(d.items ?? []); })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError((e as Error).message || 'Could not change the status');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] dark:bg-black/60" onClick={() => !busy && onCancel()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-status-title"
        onClick={(e) => e.stopPropagation()}
        className="mx-4 w-full max-w-md overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-(--shadow-overlay)"
      >
        <div className="px-5 pb-1 pt-5">
          <h3 id="project-status-title" className="text-base font-semibold text-ink-1">{copy.title(projectName)}</h3>
          <p className="mt-1.5 text-[13px] text-ink-2">{copy.body}</p>
        </div>
        <div className="px-5 pt-3">
          <div className="mb-1.5 text-[12px] font-semibold text-ink-2">Held while {next === 'paused' ? 'paused' : next}</div>
          {items === null && !loadError && <p className="text-[13px] text-ink-3">Checking what runs on a timer…</p>}
          {loadError && <p className="text-[13px] text-ink-3">Couldn&apos;t list its timers. They are held all the same.</p>}
          {items !== null && items.length === 0 && <p className="text-[13px] text-ink-3">Nothing runs on a timer in this project right now.</p>}
          {items !== null && items.length > 0 && (
            <ul className="max-h-56 overflow-y-auto rounded-lg border border-line">
              {items.map((it, i) => (
                <li key={`${it.kind}-${it.cardId ?? ''}-${i}`} className="flex gap-3 border-t border-line px-2.5 py-1.5 text-[13px] text-ink-1 first:border-t-0">
                  <span className="min-w-0 flex-1 truncate">
                    {it.kind === 'scheduled_prompt' ? `Scheduled send on #${String(it.number ?? '').padStart(4, '0')}` : it.title}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] leading-5 text-ink-3">{whenLabel(it)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2.5 text-[12px] text-ink-3">
            Runs that come due while it is held are skipped, not saved up. Resuming picks up at each timer&apos;s next scheduled time. Sessions already running finish on their own.
          </p>
          {error && <p className="mt-2 text-[13px] text-danger-text">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
          <button type="button" onClick={onCancel} disabled={busy}
            className="rounded-md px-4 py-1.5 text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink-1 disabled:opacity-50">
            Cancel
          </button>
          <button ref={confirmRef} type="button" onClick={confirm} disabled={busy}
            className="rounded-md bg-primary px-4 py-1.5 text-[13px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-50">
            {busy ? copy.busy : copy.action}
          </button>
        </div>
      </div>
    </div>
  );
}
