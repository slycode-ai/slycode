'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ProjectWithBacklog } from '@/lib/types';
import { HealthDot } from './HealthDot';
import { PlatformBadges } from './PlatformBadges';

interface ProjectCardProps {
  project: ProjectWithBacklog;
  onDeleted?: () => void;
  shortcutKey?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}

export function ProjectCard({ project, onDeleted, shortcutKey, onDragStart, onDragEnd }: ProjectCardProps) {
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

  const cardContent = (
    <>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate font-semibold text-void-950 dark:text-void-100">
            {project.name}
          </h3>
          <HealthDot health={project.healthScore} />
        </div>
        <div className="flex flex-shrink-0 items-center gap-1">
          {project.masterCompliant && (
            <span className="rounded border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
              Compliant
            </span>
          )}
          <button
            onClick={(e) => handleActionClick(e, () => setShowEditModal(true))}
            className="rounded p-1 text-void-400 hover:bg-void-200 hover:text-void-600 dark:hover:bg-void-700 dark:hover:text-void-200"
            title="Edit project"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={(e) => handleActionClick(e, () => setShowDeleteConfirm(true))}
            className="rounded p-1 text-void-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/50 dark:hover:text-red-400"
            title="Remove project"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <p className="mb-2 text-sm text-void-500 dark:text-void-400">
        {project.description}
      </p>

      {/* Platform badges */}
      <PlatformBadges platforms={project.platforms} />

      {!project.accessible && (
        <div className="mt-2 rounded border border-red-500/20 bg-red-500/5 p-2 text-sm text-red-700 dark:text-red-300">
          {project.error}
        </div>
      )}

      {project.accessible && (
        <>
          {/* Asset counts */}
          {(skillCount + agentCount) > 0 && (
            <div className="mt-1.5 text-xs text-void-500 dark:text-void-400">
              {skillCount > 0 && <span>{skillCount} skill{skillCount !== 1 ? 's' : ''}</span>}
              {skillCount > 0 && agentCount > 0 && <span> / </span>}
              {agentCount > 0 && <span>{agentCount} agent{agentCount !== 1 ? 's' : ''}</span>}
            </div>
          )}

          {/* Git uncommitted */}
          {project.gitUncommitted !== undefined && project.gitUncommitted > 0 && (
            <div className="mt-1.5 text-xs text-neon-orange-500 dark:text-neon-orange-400">
              {project.gitUncommitted} uncommitted
            </div>
          )}
        </>
      )}

      {project.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {project.tags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-void-200 bg-void-100 px-2 py-0.5 text-xs text-void-500 dark:border-void-600 dark:bg-void-800 dark:text-void-400"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {project.accessible && project.areas.length > 0 && (
        <div className="mt-3 border-t border-void-100 pt-3 dark:border-void-700">
          <p className="mb-1 text-xs font-medium text-void-500 dark:text-void-500">
            Areas
          </p>
          <div className="flex flex-wrap gap-1">
            {project.areas.map((area) => (
              <span
                key={area}
                className="rounded border border-neon-blue-400/12 bg-neon-blue-400/8 px-2 py-0.5 text-xs text-neon-blue-600 dark:text-neon-blue-400/70"
              >
                {area}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const isActive = (project.activeSessions ?? 0) > 0;
  const baseClasses = `block h-full rounded-xl border p-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_0_20px_-5px_rgba(0,191,255,0.1)] ${isActive ? 'active-glow-card' : ''}`;

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
          className={`${baseClasses} relative cursor-pointer border-void-200 bg-white shadow-(--shadow-card) hover:border-neon-blue-400/40 hover:shadow-[0_8px_30px_rgba(0,0,0,0.18)] dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.7)] dark:border-void-700 dark:bg-void-800 dark:hover:border-neon-blue-400/30`}
        >
          {shortcutKey !== undefined && (
            <span className="absolute bottom-2 right-2 flex h-5 w-5 items-center justify-center rounded border border-neon-blue-400/15 bg-neon-blue-400/10 font-mono text-xs text-neon-blue-500 dark:text-neon-blue-400">
              {shortcutKey}
            </span>
          )}
          {cardContent}
        </Link>
      ) : (
        <div className={`${baseClasses} border-red-500/20 bg-red-500/5 dark:border-red-500/20 dark:bg-red-500/5`}>
          {cardContent}
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-md rounded-lg border border-void-700 bg-void-900 p-6 shadow-(--shadow-overlay)">
            <h3 className="mb-4 text-lg font-semibold text-void-100">Edit Project</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-void-300">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 text-sm text-void-100 focus:border-neon-blue-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-void-300">Description</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 text-sm text-void-100 focus:border-neon-blue-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-void-300">Path</label>
                <input
                  type="text"
                  value={editPath}
                  onChange={(e) => setEditPath(e.target.value)}
                  className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 font-mono text-sm text-void-100 focus:border-neon-blue-400 focus:outline-none"
                />
                <p className="mt-1 text-xs text-void-500">Repoints registry only — files are not moved.</p>
              </div>
              <div>
                <label className="mb-1 block text-sm text-void-300">Tags</label>
                <input
                  type="text"
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 text-sm text-void-100 focus:border-neon-blue-400 focus:outline-none"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowEditModal(false)}
                className="rounded px-4 py-2 text-sm text-void-400 hover:text-void-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="mx-4 w-full max-w-sm rounded-lg border border-void-700 bg-void-900 p-6 shadow-(--shadow-overlay)">
            <h3 className="mb-2 text-lg font-semibold text-void-100">Remove Project</h3>
            <p className="mb-4 text-sm text-void-400">
              This will remove <strong className="text-void-200">{project.name}</strong> from
              Code Den. Project files will not be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded px-4 py-2 text-sm text-void-400 hover:text-void-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
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
