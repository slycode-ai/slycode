'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ProjectFolder, ProjectStatus, ProjectWithBacklog } from '@/lib/types';
import { projectStatus, heldForLabel } from '@/lib/project-status';
import { HealthDot } from './HealthDot';
import { ProjectMenu } from './ProjectMenu';
import { PlatformBadges } from './PlatformBadges';
import Tooltip from './Tooltip';

function relativeTime(iso?: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

interface ProjectCardProps {
  project: ProjectWithBacklog;
  onDeleted?: () => void;
  /** Cards with finished-but-unviewed session output (feature 082). */
  unseenCount?: number;
  /** Opens the dashboard's "new output" list for this project (or its one card). */
  onUnseenClick?: (anchor: HTMLElement) => void;
  shortcutKey?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  /** #0381: the Den handles status changes (dialog for held statuses, direct for Resume). */
  onStatusRequest?: (next: ProjectStatus) => void;
  /** Drag reorder is only offered on the default (Active-only) Den view. */
  draggable?: boolean;
  /** Phase B: the tile menu's Folder section (moves are handled by the Den). */
  folderMenu?: {
    folders: ProjectFolder[];
    onFolder: (folderId: string | null) => void;
    onNewFolder: (name: string) => Promise<void>;
  };
}

/** One line naming what a held project is holding back (#0381). */
function heldLine(held: NonNullable<ProjectWithBacklog['held']>): string {
  const parts: string[] = [];
  if (held.automations) parts.push(`${held.automations} automation${held.automations !== 1 ? 's' : ''}`);
  if (held.scheduledPrompts) parts.push(`${held.scheduledPrompts} scheduled send${held.scheduledPrompts !== 1 ? 's' : ''}`);
  if (held.atlas) parts.push('atlas refresh');
  const what = parts.length ? parts.join(', ') : 'nothing on a timer right now';
  const skipped = held.skippedRuns > 0 ? ` ${held.skippedRuns >= 99 ? '99+' : held.skippedRuns} run${held.skippedRuns !== 1 ? 's' : ''} skipped so far.` : '';
  return `${what}.${skipped}`;
}

export function ProjectCard({ project, onDeleted, unseenCount = 0, onUnseenClick, shortcutKey, onDragStart, onDragEnd, onStatusRequest, draggable = true, folderMenu }: ProjectCardProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDescription, setEditDescription] = useState(project.description);
  const [editPath, setEditPath] = useState(project.path);
  const [editTags, setEditTags] = useState(project.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Shown in the edit/remove dialogs — e.g. a 503 when the registry is busy (#0381).
  const [actionError, setActionError] = useState<string | null>(null);

  // Asset counts
  const skillCount = project.assets?.skills.length ?? 0;
  const agentCount = project.assets?.agents.length ?? 0;

  async function handleSave() {
    setSaving(true);
    try {
      const tags = editTags.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim(),
          path: editPath.trim(),
          tags,
        }),
      });
      if (res.ok) {
        setShowEditModal(false);
        setActionError(null);
        onDeleted?.();
      } else {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setActionError(body.error || `Saving failed (${res.status})`);
      }
    } catch (e) {
      setActionError((e as Error).message);
    }
    setSaving(false);
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setShowDeleteConfirm(false);
        setActionError(null);
        onDeleted?.();
      } else {
        const body = await res.json().catch(() => ({} as { error?: string }));
        setActionError(body.error || `Removing failed (${res.status})`);
      }
    } catch (e) {
      setActionError((e as Error).message);
    }
    setDeleting(false);
  }

  function handleActionClick(e: React.MouseEvent, action: () => void) {
    e.preventDefault();
    e.stopPropagation();
    action();
  }

  const working = project.activeSessions ?? 0;
  const stages = project.stageCounts;
  const openCards = stages ? stages.backlog + stages.design + stages.implementation + stages.testing : 0;
  const lastMoved = relativeTime(project.lastActivity);
  const status = projectStatus(project);
  const paused = status === 'paused';
  const complete = status === 'complete';
  const recede = paused || complete ? 'opacity-55' : '';

  const cardContent = (
    <>
      {working > 0 && !paused && <div className="live-wire" aria-hidden />}
      {paused && <div className="held-wire" aria-hidden />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className={`truncate text-[15px] font-semibold leading-6 tracking-tight text-ink-1 ${recede}`}>
            {project.name}
          </h3>
          {status === 'active' && <HealthDot health={project.healthScore} />}
          {paused && (
            <span className="flex h-5 flex-none items-center gap-1 rounded bg-warn/15 px-1.5 text-[11px] font-semibold text-warn-text">
              <svg className="h-2.5 w-2.5" viewBox="0 0 10 10" fill="currentColor" aria-hidden><rect x="1.5" y="1" width="2.4" height="8" rx=".6" /><rect x="6.1" y="1" width="2.4" height="8" rx=".6" /></svg>
              Paused {heldForLabel(project.statusChangedAt)}
            </span>
          )}
          {complete && (
            <span className="flex h-5 flex-none items-center gap-1 rounded bg-st-done/12 px-1.5 text-[11px] font-semibold text-st-done">
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              Complete
            </span>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ProjectMenu
            status={status}
            onStatus={(next) => onStatusRequest?.(next)}
            onEdit={() => setShowEditModal(true)}
            onRemove={() => setShowDeleteConfirm(true)}
            folders={folderMenu?.folders}
            folderId={project.folderId ?? null}
            onFolder={folderMenu?.onFolder}
            onNewFolder={folderMenu?.onNewFolder}
          />
        </div>
      </div>
      {project.description && (
        <p className={`mt-0.5 line-clamp-2 text-[13px] leading-5 text-ink-3 ${recede}`}>{project.description}</p>
      )}

      {!project.accessible && (
        <div className="mt-3 rounded-md bg-danger/10 px-2 py-1.5 text-[13px] text-danger-text">
          {project.error}
        </div>
      )}

      {project.accessible && stages && (
        <div className={`mt-3 ${recede}`}>
          <div
            className="stage-bar"
            role="img"
            aria-label={`Open cards: ${stages.backlog} backlog, ${stages.design} design, ${stages.implementation} implementation, ${stages.testing} testing`}
          >
            {openCards === 0 && <span className="sb-empty" style={{ flex: 1 }} />}
            {stages.backlog > 0 && <span className="sb-backlog" style={{ flex: stages.backlog }} />}
            {stages.design > 0 && <span className="sb-design" style={{ flex: stages.design }} />}
            {stages.implementation > 0 && <span className="sb-impl" style={{ flex: stages.implementation }} />}
            {stages.testing > 0 && <span className="sb-test" style={{ flex: stages.testing }} />}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] leading-4 text-ink-3">
            {stages.backlog > 0 && <span className="flex items-center gap-1"><i className="sb-key sb-backlog" />{stages.backlog} backlog</span>}
            {stages.design > 0 && <span className="flex items-center gap-1"><i className="sb-key sb-design" />{stages.design} design</span>}
            {stages.implementation > 0 && <span className="flex items-center gap-1"><i className="sb-key sb-impl" />{stages.implementation} impl</span>}
            {stages.testing > 0 && <span className="flex items-center gap-1"><i className="sb-key sb-test" />{stages.testing} testing</span>}
            {openCards === 0 && <span>No open cards</span>}
            <span className="ml-auto">{stages.done} done</span>
          </div>
        </div>
      )}

      {project.accessible && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {working > 0 && (
            <Tooltip content={`${working} agent${working !== 1 ? 's' : ''} working right now`}>
              <span className="flex items-center gap-1.5 rounded bg-live/10 px-1.5 text-[11px] font-medium leading-5 text-live-text">
                <span className="live-dot" />
                {working} working
              </span>
            </Tooltip>
          )}
          {/* Unseen roll-up (feature 082): cards with finished work you haven't opened. */}
          {unseenCount > 0 && (
            <Tooltip content={`${unseenCount} card${unseenCount !== 1 ? 's' : ''} with output you haven't looked at`}>
              {onUnseenClick ? (
                <button
                  type="button"
                  onClick={(e) => { const el = e.currentTarget; handleActionClick(e, () => onUnseenClick(el)); }}
                  aria-haspopup={unseenCount > 1 ? 'dialog' : undefined}
                  className="rounded bg-accent/10 px-1.5 text-[11px] font-medium leading-5 text-accent transition-colors hover:bg-accent/20"
                >
                  {unseenCount} new
                </button>
              ) : (
                <span className="rounded bg-accent/10 px-1.5 text-[11px] font-medium leading-5 text-accent">
                  {unseenCount} new
                </span>
              )}
            </Tooltip>
          )}
          {project.gitUncommitted !== undefined && project.gitUncommitted > 0 && (
            <span className="rounded bg-warn/10 px-1.5 font-mono text-[11px] leading-5 text-warn-text">
              {project.gitUncommitted} uncommitted
            </span>
          )}
        </div>
      )}

      {paused && project.held && (
        <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-warn/25 bg-warn/[0.07] px-2.5 py-2 text-[12px] leading-[18px] text-ink-2">
          <span className="min-w-0 flex-1"><b className="font-semibold text-ink-1">Holding</b> {heldLine(project.held)}</span>
          <button
            type="button"
            onClick={(e) => handleActionClick(e, () => onStatusRequest?.('active'))}
            className="h-[26px] flex-none rounded-md bg-primary px-2.5 text-[12px] font-semibold text-on-primary hover:opacity-90"
          >
            Resume
          </button>
        </div>
      )}

      {project.accessible && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-2.5 text-[11px] leading-4 text-ink-3">
          <PlatformBadges platforms={project.platforms} />
          {(skillCount + agentCount) > 0 && (
            <span className="truncate">
              {skillCount > 0 && `${skillCount} skill${skillCount !== 1 ? 's' : ''}`}
              {skillCount > 0 && agentCount > 0 && ', '}
              {agentCount > 0 && `${agentCount} agent${agentCount !== 1 ? 's' : ''}`}
            </span>
          )}
          {lastMoved && <span className="ml-auto shrink-0 pr-6">active {lastMoved}</span>}
        </div>
      )}
    </>
  );

  const baseClasses = `group relative block h-full overflow-hidden rounded-xl border p-4 transition-[transform,border-color] duration-150 hover:-translate-y-px`;
  // #0381: a paused tile is the loud one — dashed warn border, page-tinted surface.
  const statusClasses = paused
    ? 'border-dashed border-warn/45 bg-[color-mix(in_srgb,var(--s1)_70%,var(--page))] hover:border-warn/70'
    : 'border-line bg-surface-1 hover:border-line-strong';

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', project.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart?.();
  };

  const handleDragEnd = () => {
    onDragEnd?.();
  };

  return (
    <>
      {project.accessible ? (
        <Link
          href={`/project/${project.id}`}
          draggable={draggable}
          onDragStart={draggable ? handleDragStart : undefined}
          onDragEnd={draggable ? handleDragEnd : undefined}
          className={`${baseClasses} cursor-pointer shadow-(--shadow-card) ${statusClasses}`}
        >
          {shortcutKey !== undefined && (
            <span className="absolute bottom-2.5 right-3 flex h-[18px] min-w-[18px] items-center justify-center rounded border border-line-strong font-mono text-[11px] text-ink-3">
              {shortcutKey}
            </span>
          )}
          {cardContent}
        </Link>
      ) : (
        <div className={`${baseClasses} border-danger/30 bg-danger/5`}>
          {cardContent}
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] dark:bg-black/60">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-line bg-surface-1 p-6 shadow-(--shadow-overlay)">
            <h3 className="mb-4 text-lg font-semibold text-ink-1">Edit Project</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-[13px] font-medium text-ink-2">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink-1 focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-ink-2">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink-1 focus:border-accent focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-ink-2">Path</label>
                <input
                  type="text"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  className="w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 font-mono text-sm text-ink-1 focus:border-accent focus:outline-none"
                />
                <p className="mt-1 text-xs text-ink-3">Repoints registry only — files are not moved.</p>
              </div>
              <div>
                <label className="mb-1 block text-[13px] font-medium text-ink-2">Tags</label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="w-full rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-sm text-ink-1 focus:border-accent focus:outline-none"
                />
              </div>
            </div>
            {actionError && <p role="alert" className="mt-3 text-[13px] text-danger-text">{actionError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setShowEditModal(false); setActionError(null); }}
                className="rounded-md px-4 py-2 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink-1"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary hover:opacity-90 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] dark:bg-black/60">
          <div className="mx-4 w-full max-w-sm rounded-2xl border border-line bg-surface-1 p-6 shadow-(--shadow-overlay)">
            <h3 className="mb-2 text-lg font-semibold text-ink-1">Remove Project</h3>
            <p className="mb-4 text-sm text-ink-2">
              This will remove <strong className="text-ink-1">{project.name}</strong> from
              Code Den. Project files will not be deleted.
            </p>
            {actionError && <p role="alert" className="mb-3 text-[13px] text-danger-text">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteConfirm(false); setActionError(null); }}
                className="rounded-md px-4 py-2 text-sm text-ink-2 hover:bg-surface-3 hover:text-ink-1"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
