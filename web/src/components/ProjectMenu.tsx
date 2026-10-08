'use client';

/**
 * Project tile ⋯ menu (card #0381): status, then edit/remove. Portalled so
 * it escapes the tile's overflow clip and the tile's <Link>.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ProjectFolder, ProjectStatus } from '@/lib/types';
import { NewFolderInput } from './DenFolder';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@/lib/project-status';
import { placePopover, type PopoverPlacement } from '@/lib/popover-placement';

const STATUS_HINTS: Record<ProjectStatus, string> = {
  active: 'Shown in the Den. Automations run.',
  paused: 'Hidden. Timers held until you resume.',
  complete: 'Finished. Hidden, timers held.',
  archived: 'Cold storage. Left out until restored.',
};

interface ProjectMenuProps {
  status: ProjectStatus;
  onStatus: (next: ProjectStatus) => void;
  /** Omitted for archived cold rows — restore the project to edit it. */
  onEdit?: () => void;
  onRemove: () => void;
  /** Phase B: folder assignment. The Folder section shows only when onFolder is given. */
  folders?: ProjectFolder[];
  folderId?: string | null;
  onFolder?: (folderId: string | null) => void;
  onNewFolder?: (name: string) => Promise<void>;
}

export function ProjectMenu({ status, onStatus, onEdit, onRemove, folders = [], folderId = null, onFolder, onNewFolder }: ProjectMenuProps) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  // A dangling folderId reads as "No folder" (same rule as the Den grouping).
  const currentFolder = folders.some(f => f.id === folderId) ? folderId : null;
  const [place, setPlace] = useState<PopoverPlacement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => { setOpen(false); setCreating(false); }, []);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const r = buttonRef.current.getBoundingClientRect();
    setPlace(placePopover(r, { width: window.innerWidth, height: window.innerHeight }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { close(); buttonRef.current?.focus(); }
    };
    // Page scroll or resize closes the menu (it is fixed-positioned to its
    // button), but scrolling the menu's OWN overflow list must not — otherwise
    // the lower folder choices, New folder and Remove are unreachable.
    const onScroll = (e: Event) => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // Focus the checked item on open for keyboard users.
  useEffect(() => {
    if (open && place) menuRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
  }, [open, place]);

  const stop = (e: React.SyntheticEvent) => { e.preventDefault(); e.stopPropagation(); };
  const pick = (fn: () => void) => (e: React.MouseEvent) => { stop(e); close(); fn(); };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  const style: React.CSSProperties | undefined = place
    ? place.side === 'below'
      ? { top: place.top, right: place.right, maxHeight: place.maxHeight }
      : { bottom: place.bottom, right: place.right, maxHeight: place.maxHeight }
    : undefined;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Project menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { stop(e); setOpen(o => !o); }}
        className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink-1"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
        </svg>
      </button>
      {open && place && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="Project menu"
          onKeyDown={onMenuKey}
          // Stop React bubbling to the tile's <Link> (portal events still bubble
          // through the React tree) — but never preventDefault here, or the
          // new-folder form could not submit.
          onClick={(e) => e.stopPropagation()}
          style={style}
          className="fixed z-[60] w-72 overflow-y-auto rounded-xl border border-line bg-surface-1 p-1.5 shadow-(--shadow-overlay)"
        >
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-semibold text-ink-3">Status</div>
          {PROJECT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={s === status}
              onClick={pick(() => { if (s !== status) onStatus(s); })}
              className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-2 focus:bg-surface-2 focus:outline-none"
            >
              <i className={`status-glyph status-glyph-${s} mt-1.5`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-ink-1">{PROJECT_STATUS_LABELS[s]}</span>
                <span className="block text-[12px] leading-4 text-ink-3">{STATUS_HINTS[s]}</span>
              </span>
              {s === status && (
                <svg className="mt-1 h-3.5 w-3.5 flex-none text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              )}
            </button>
          ))}
          {onFolder && (
            <>
              <div className="mx-0.5 my-1.5 h-px bg-line" />
              <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold text-ink-3">Folder</div>
              {[...folders.map(f => ({ id: f.id as string | null, name: f.name })), { id: null, name: 'No folder' }].map((f) => (
                <button
                  key={f.id ?? '__none'}
                  type="button"
                  role="menuitemradio"
                  aria-checked={f.id === currentFolder}
                  onClick={pick(() => { if (f.id !== currentFolder) onFolder(f.id); })}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 focus:bg-surface-2 focus:outline-none ${f.id === null ? 'text-ink-2' : 'text-ink-1'}`}
                >
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  {f.id === currentFolder && (
                    <svg className="h-3.5 w-3.5 flex-none text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" />
                    </svg>
                  )}
                </button>
              ))}
              {onNewFolder && (creating ? (
                <div className="px-2 py-1.5">
                  <NewFolderInput
                    onCreate={async (name) => { await onNewFolder(name); close(); }}
                    onCancel={() => setCreating(false)}
                  />
                </div>
              ) : (
                <button type="button" role="menuitem" onClick={(e) => { stop(e); setCreating(true); }}
                  className="flex w-full rounded-md px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-surface-2 focus:bg-surface-2 focus:outline-none">
                  New folder…
                </button>
              ))}
            </>
          )}
          <div className="mx-0.5 my-1.5 h-px bg-line" />
          {onEdit && (
            <button type="button" role="menuitem" onClick={pick(onEdit)}
              className="flex w-full rounded-md px-2 py-1.5 text-left text-[13px] text-ink-1 hover:bg-surface-2 focus:bg-surface-2 focus:outline-none">
              Edit project…
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(onRemove)}
            className="flex w-full rounded-md px-2 py-1.5 text-left text-[13px] text-danger-text hover:bg-danger/10 focus:bg-danger/10 focus:outline-none">
            Remove from SlyCode…
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}
