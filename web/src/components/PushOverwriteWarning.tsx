'use client';

import { useState } from 'react';
import type { ProviderId } from '@/lib/types';

/**
 * A project+provider cell whose installed copy is NEWER than the store copy
 * being pushed. Pushing would overwrite local edits, so these are excluded
 * from push-to-all unless the user opts them in here.
 */
export interface OverwriteConflict {
  projectId: string;
  projectName: string;
  provider: ProviderId;
  projectVersion?: string;
  storeVersion?: string;
}

interface Props {
  skillName: string;
  conflicts: OverwriteConflict[];
  /** Number of project+provider targets that will be pushed regardless (no conflict). */
  safeCount: number;
  onConfirm: (includedKeys: Set<string>) => void;
  onCancel: () => void;
}

export function conflictKey(c: { projectId: string; provider: ProviderId }): string {
  return `${c.projectId}:${c.provider}`;
}

const providerLabels: Record<ProviderId, string> = {
  claude: 'Claude',
  agents: 'Agents',
  codex: 'Codex',
  gemini: 'Gemini',
};

export function PushOverwriteWarning({ skillName, conflicts, safeCount, onConfirm, onCancel }: Props) {
  // Default: every conflicting project is EXCLUDED — overwriting is opt-in.
  const [included, setIncluded] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setIncluded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pushCount = safeCount + included.size;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-(--shadow-overlay) dark:bg-void-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hazard header strip — same visual language as automation cards */}
        <div className="hazard-stripe h-1.5 w-full" aria-hidden="true" />

        <div className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <svg className="h-6 w-6 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-void-900 dark:text-void-100">
                Some projects have newer copies
              </h3>
              <p className="text-xs text-void-500 dark:text-void-400">
                Pushing <span className="font-mono">{skillName}</span> from the store
              </p>
            </div>
          </div>

          <p className="mb-4 text-sm text-void-600 dark:text-void-400">
            These projects hold a newer version of <span className="font-mono text-void-800 dark:text-void-200">{skillName}</span> than
            the store copy. Pushing would overwrite their local changes, so they are left
            out unless you include them.
          </p>

          <ul className="mb-6 max-h-60 space-y-1.5 overflow-y-auto">
            {conflicts.map(c => {
              const key = conflictKey(c);
              const isIncluded = included.has(key);
              return (
                <li key={key}>
                  <button
                    onClick={() => toggle(key)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                      isIncluded
                        ? 'border-amber-400/60 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-900/20'
                        : 'border-void-200 bg-void-50 hover:border-void-300 dark:border-void-700 dark:bg-void-850 dark:hover:border-void-600'
                    }`}
                    aria-pressed={isIncluded}
                  >
                    <span
                      className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${
                        isIncluded
                          ? 'border-amber-500 bg-amber-500 text-white'
                          : 'border-void-300 bg-white dark:border-void-600 dark:bg-void-800'
                      }`}
                      aria-hidden="true"
                    >
                      {isIncluded && (
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-void-800 dark:text-void-200">
                        {c.projectName}
                      </span>
                      <span className="text-[11px] text-void-500 dark:text-void-400">
                        {providerLabels[c.provider] ?? c.provider}
                      </span>
                    </span>
                    <span className="flex-shrink-0 font-mono text-xs">
                      <span className="text-amber-600 dark:text-amber-400">v{c.projectVersion ?? '?'}</span>
                      <span className="mx-1 text-void-400 dark:text-void-500">&gt;</span>
                      <span className="text-void-500 dark:text-void-400">v{c.storeVersion ?? '?'}</span>
                    </span>
                    <span className={`flex-shrink-0 text-[11px] font-medium ${
                      isIncluded ? 'text-amber-600 dark:text-amber-400' : 'text-void-400 dark:text-void-500'
                    }`}>
                      {isIncluded ? 'overwrite' : 'kept'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-void-500 dark:text-void-400">
              {safeCount > 0
                ? `${safeCount} other ${safeCount === 1 ? 'target gets' : 'targets get'} the push either way`
                : 'No other targets to push'}
            </span>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="rounded-lg px-4 py-2 text-sm font-medium text-void-700 hover:bg-void-100 dark:text-void-300 dark:hover:bg-void-700"
              >
                Cancel
              </button>
              <button
                onClick={() => onConfirm(included)}
                disabled={pushCount === 0}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pushCount === 0 ? 'Nothing to push' : `Push to ${pushCount} ${pushCount === 1 ? 'target' : 'targets'}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
