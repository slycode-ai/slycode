'use client';

/**
 * Den status pieces (card #0381): the status filter chips and the archived
 * project's one-line cold row.
 */

import Link from 'next/link';
import type { ProjectFolder, ProjectStatus, ProjectWithBacklog } from '@/lib/types';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS } from '@/lib/project-status';
import { formatDate } from '@/lib/date-format';
import { ProjectMenu } from './ProjectMenu';

interface DenStatusFilterProps {
  shown: ReadonlySet<ProjectStatus>;
  counts: Record<ProjectStatus, number>;
  onToggle: (status: ProjectStatus) => void;
}

/** Segmented multi-toggle. Empty statuses are hidden, except Active (the default view). */
export function DenStatusFilter({ shown, counts, onToggle }: DenStatusFilterProps) {
  const chips = PROJECT_STATUSES.filter(s => s === 'active' || counts[s] > 0 || shown.has(s));
  if (chips.length <= 1) return null; // nothing but Active — no filter needed
  return (
    <div role="group" aria-label="Show projects by status" className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface-1 p-0.5">
      {chips.map((s) => {
        const on = shown.has(s);
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(s)}
            className={`flex h-[26px] items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium transition-colors ${
              on
                ? 'bg-surface-3 text-ink-1 shadow-[inset_0_0_0_1px_var(--line-strong)]'
                : 'text-ink-3 hover:bg-surface-2 hover:text-ink-1'
            }`}
          >
            <i className={`status-glyph status-glyph-${s}`} aria-hidden />
            {PROJECT_STATUS_LABELS[s]}
            <span className={`font-mono text-[11px] ${on ? 'text-ink-2' : 'text-ink-3'}`}>{counts[s]}</span>
          </button>
        );
      })}
    </div>
  );
}

interface ProjectColdRowProps {
  project: ProjectWithBacklog;
  onStatusRequest: (next: ProjectStatus) => void;
  onRemove: () => void;
  /** Phase B: the tile menu's Folder section (moves are handled by the Den). */
  folderMenu?: {
    folders: ProjectFolder[];
    onFolder: (folderId: string | null) => void;
    onNewFolder: (name: string) => Promise<void>;
  };
}

/** Archived = cold: a single row from registry data, no stats computed. */
export function ProjectColdRow({ project, onStatusRequest, onRemove, folderMenu }: ProjectColdRowProps) {
  const since = project.statusChangedAt ? formatDate(project.statusChangedAt) : null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5">
      <i className="status-glyph status-glyph-archived" aria-hidden />
      <Link href={`/project/${project.id}`} className="min-w-0 truncate text-[13px] font-medium text-ink-2 hover:text-ink-1">
        {project.name}
      </Link>
      <span className="hidden min-w-0 truncate text-[12px] text-ink-3 sm:inline">
        {since ? `Archived ${since}. ` : ''}Not loaded until you restore it.
      </span>
      <span className="ml-auto flex flex-none items-center gap-1.5">
        <button
          type="button"
          onClick={() => onStatusRequest('active')}
          className="h-7 rounded-md border border-line px-2.5 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-1"
        >
          Restore
        </button>
        <ProjectMenu
          status="archived"
          onStatus={onStatusRequest}
          onRemove={onRemove}
          folders={folderMenu?.folders}
          folderId={project.folderId ?? null}
          onFolder={folderMenu?.onFolder}
          onNewFolder={folderMenu?.onNewFolder}
        />
      </span>
    </div>
  );
}
