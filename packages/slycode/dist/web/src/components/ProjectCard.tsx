'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ProjectWithBacklog } from '@/lib/types';
import { HealthDot } from './HealthDot';
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
}

export function ProjectCard({ project, onDeleted, unseenCount = 0, onUnseenClick, shortcutKey, onDragStart, onDragEnd }: ProjectCardProps) {
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [editDescription, setEditDescription] = useState(project.description);
  const [editPath, setEditPath] = useState(project.path);
  const [editTags, setEditTags] = useState(project.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
        onDeleted?.();
      }
    } catch {
      // ignore
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
        onDeleted?.();
      }
    } catch {
      // ignore
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

  const cardContent = (
    <>
      {working > 0 && <div className="live-wire" aria-hidden />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold leading-6 tracking-tight text-ink-1">
            {project.name}
          </h3>
          <HealthDot health={project.healthScore} />
        </div>
        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
          <Tooltip content="Edit project">
            <button
              onClick={(e) => handleActionClick(e, () => setShowEditModal(true))}
              aria-label="Edit project"
              className="rounded p-1 text-ink-3 hover:bg-surface-3 hover:text-ink-1"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </Tooltip>
          <Tooltip content="Remove project">
            <button
              onClick={(e) => handleActionClick(e, () => setShowDeleteConfirm(true))}
              aria-label="Remove project"
              className="rounded p-1 text-ink-3 hover:bg-danger/10 hover:text-danger-text"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
      {project.description && (
        <p className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-ink-3">{project.description}</p>
      )}

      {!project.accessible && (
        <div className="mt-3 rounded-md bg-danger/10 px-2 py-1.5 text-[13px] text-danger-text">
          {project.error}
        </div>
      )}

      {project.accessible && stages && (
        <div className="mt-3">
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
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className={`${baseClasses} cursor-pointer border-line bg-surface-1 shadow-(--shadow-card) hover:border-line-strong`}
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
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowEditModal(false)}
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
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
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
