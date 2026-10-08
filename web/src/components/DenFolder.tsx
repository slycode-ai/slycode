'use client';

/**
 * Den folder header (card #0381 Phase B): chevron toggle, name, count, a
 * hairline, and a folder menu (rename / delete). Collapsed headers still
 * surface live work, items that need the owner, and paused projects, so
 * collapsing a folder never hides a running agent. The header is also a drop
 * target (drop a tile → move it into this folder) and draggable itself when
 * folders can be reordered.
 */

import { useEffect, useRef, useState } from 'react';
import type { ProjectFolder } from '@/lib/types';
import { ContextMenu } from './ContextMenu';

interface DenFolderHeaderProps {
  folder: ProjectFolder | null;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  working: number;
  needYou: number;
  paused: number;
  onRename?: (name: string) => Promise<void>;
  onDelete?: () => void;
  /** Tile drop onto the header (moves the dragged project into this folder). */
  tileDragActive?: boolean;
  onTileDrop?: () => void;
  /** Folder-header drag (reorder folders). */
  draggableFolder?: boolean;
  onFolderDragStart?: () => void;
  onFolderDragEnd?: () => void;
  folderDropActive?: boolean;
  /** Drop position from the cursor: top half of the header = before, bottom half = after. */
  onFolderDrop?: (position: 'before' | 'after') => void;
}

export function DenFolderHeader({
  folder, count, collapsed, onToggle, working, needYou, paused, onRename, onDelete,
  tileDragActive, onTileDrop, draggableFolder, onFolderDragStart, onFolderDragEnd, folderDropActive, onFolderDrop,
}: DenFolderHeaderProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(folder?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  // Folder-reorder feedback: an accent line above (before) or below (after) the header.
  const [folderPos, setFolderPos] = useState<'before' | 'after' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commitRename = async () => {
    if (!onRename || !folder) return;
    const name = draft.trim();
    if (!name || name === folder.name) { setEditing(false); setError(null); return; }
    try {
      await onRename(name);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const accepting = (tileDragActive && !!onTileDrop) || (folderDropActive && !!onFolderDrop);
  const label = folder ? folder.name : 'No folder';

  const posFromEvent = (e: React.DragEvent): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY < r.top + r.height / 2 ? 'before' : 'after';
  };

  return (
    <div
      className={`relative mb-3 flex min-h-8 items-center gap-2.5 rounded-md transition-colors ${over && accepting && !folderDropActive ? 'bg-accent/10' : ''}`}
      draggable={draggableFolder && !editing}
      onDragStart={draggableFolder ? (e) => {
        e.dataTransfer.setData('application/x-slycode-folder', folder?.id ?? '');
        e.dataTransfer.effectAllowed = 'move';
        onFolderDragStart?.();
      } : undefined}
      onDragEnd={draggableFolder ? () => onFolderDragEnd?.() : undefined}
      onDragOver={accepting ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
        if (folderDropActive) setFolderPos(posFromEvent(e));
      } : undefined}
      onDragLeave={accepting ? () => { setOver(false); setFolderPos(null); } : undefined}
      onDrop={accepting ? (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = posFromEvent(e);
        setOver(false);
        setFolderPos(null);
        if (folderDropActive) onFolderDrop?.(pos);
        else onTileDrop?.();
      } : undefined}
    >
      {folderDropActive && over && folderPos && (
        <span
          aria-hidden
          className={`pointer-events-none absolute left-0 right-0 h-0.5 rounded-full bg-accent ${folderPos === 'before' ? '-top-2' : '-bottom-2'}`}
        />
      )}
      {editing && folder ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); void commitRename(); }}
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={40}
            aria-label="Folder name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(e) => { if (e.key === 'Escape') { setEditing(false); setDraft(folder.name); setError(null); } }}
            className="h-7 w-48 rounded-md border border-line-strong bg-surface-2 px-2 text-[13px] font-semibold text-ink-1 focus:border-accent focus:outline-none"
          />
          {error && <span className="text-[12px] text-danger-text">{error}</span>}
        </form>
      ) : (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex items-center gap-2 rounded-md py-0.5 pl-0.5 pr-1.5 hover:bg-surface-2"
        >
          <svg className={`h-4 w-4 text-ink-3 transition-transform duration-150 motion-reduce:transition-none ${collapsed ? '-rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
          <span className={`text-[13px] ${folder ? 'font-semibold text-ink-1' : 'font-medium text-ink-3'}`}>{label}</span>
          <span className="font-mono text-[12px] text-ink-3">{count}</span>
        </button>
      )}
      {collapsed && (working > 0 || needYou > 0 || paused > 0) && (
        <span className="flex items-center gap-1.5">
          {working > 0 && (
            <span className="flex items-center gap-1.5 rounded bg-live/10 px-1.5 text-[11px] font-medium leading-5 text-live-text">
              <span className="live-dot" />{working} working
            </span>
          )}
          {needYou > 0 && (
            <span className="rounded bg-accent/10 px-1.5 text-[11px] font-medium leading-5 text-accent">{needYou} need{needYou === 1 ? 's' : ''} you</span>
          )}
          {paused > 0 && (
            <span className="rounded bg-warn/10 px-1.5 font-mono text-[11px] leading-5 text-warn-text">{paused} paused</span>
          )}
        </span>
      )}
      <span className="h-px flex-1 bg-line" aria-hidden />
      {folder && (onRename || onDelete) && (
        <button
          type="button"
          aria-label={`${folder.name} folder options`}
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.right - 160, y: r.bottom + 4 });
          }}
          className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink-1"
        >
          <svg className="h-[15px] w-[15px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
          </svg>
        </button>
      )}
      {menu && folder && (
        <ContextMenu
          open
          position={menu}
          onClose={() => setMenu(null)}
          groups={[{
            items: [
              ...(onRename ? [{ label: 'Rename folder', onClick: () => { setDraft(folder.name); setEditing(true); } }] : []),
              ...(onDelete ? [{ label: 'Delete folder…', danger: true, onClick: onDelete }] : []),
            ],
          }]}
        />
      )}
    </div>
  );
}

/** Inline "new folder" name field — used by the Projects header and the tile menu. */
export function NewFolderInput({ onCreate, onCancel, autoFocus = true }: {
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); void submit(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <input
        autoFocus={autoFocus}
        value={name}
        maxLength={40}
        placeholder="Folder name"
        aria-label="New folder name"
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
        className="h-7 w-44 rounded-md border border-line-strong bg-surface-2 px-2 text-[12px] text-ink-1 placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
      <button type="submit" disabled={!name.trim() || busy}
        className="h-7 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-on-primary hover:opacity-90 disabled:opacity-40">
        Create
      </button>
      <button type="button" onClick={onCancel} className="h-7 rounded-md px-2 text-[12px] text-ink-3 hover:text-ink-1">Cancel</button>
      {error && <span className="w-full text-[12px] text-danger-text">{error}</span>}
    </form>
  );
}
