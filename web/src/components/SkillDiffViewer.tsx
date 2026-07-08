'use client';

import { useState, useEffect, useMemo } from 'react';
import { buildDiffLines, diffStats, DiffLineRows } from './DiffLineView';

interface SkillDiffViewerProps {
  skillName: string;
  currentVersion?: string;
  newVersion: string;
  currentContent: string | null;  // null for new skills
  newContent: string;
  onClose: () => void;
}

export function SkillDiffViewer({
  skillName,
  currentVersion,
  newVersion,
  currentContent,
  newContent,
  onClose,
}: SkillDiffViewerProps) {
  const [viewMode, setViewMode] = useState<'diff' | 'new'>('diff');

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const diffLines = useMemo(() => buildDiffLines({
    oldContent: currentContent ?? '',
    newContent,
    fileName: 'SKILL.md',
    oldLabel: currentVersion ?? '(none)',
    newLabel: newVersion,
  }), [currentContent, newContent, currentVersion, newVersion]);

  const isNewSkill = currentContent === null;
  const stats = useMemo(() => diffStats(diffLines), [diffLines]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-void-700 bg-void-850 shadow-(--shadow-overlay)">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-void-700 px-5 py-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-void-100">{skillName}</h3>
            {isNewSkill ? (
              <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs font-medium text-emerald-300">
                New skill
              </span>
            ) : (
              <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-300">
                v{currentVersion} → v{newVersion}
              </span>
            )}
            <span className="text-xs text-void-500">
              <span className="text-emerald-400">+{stats.additions}</span>
              {' '}
              <span className="text-red-400">-{stats.deletions}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isNewSkill && (
              <div className="flex gap-1 rounded-md border border-void-700 bg-void-900 p-0.5">
                <button
                  onClick={() => setViewMode('diff')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    viewMode === 'diff'
                      ? 'bg-void-800 text-void-100 shadow-sm'
                      : 'text-void-400 hover:text-void-200'
                  }`}
                >
                  Diff
                </button>
                <button
                  onClick={() => setViewMode('new')}
                  className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                    viewMode === 'new'
                      ? 'bg-void-800 text-void-100 shadow-sm'
                      : 'text-void-400 hover:text-void-200'
                  }`}
                >
                  Full
                </button>
              </div>
            )}
            <button
              onClick={onClose}
              className="rounded p-1 text-void-400 hover:bg-void-800 hover:text-void-200"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto">
          {(viewMode === 'diff' || isNewSkill) ? (
            <DiffLineRows lines={diffLines} />
          ) : (
            // Full view of new content
            <div className="font-mono text-xs leading-relaxed">
              {newContent.split('\n').map((line, i) => (
                <div key={i} className="flex text-void-300">
                  <span className="w-10 flex-shrink-0 select-none px-2 text-right text-void-600">
                    {i + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all px-2">{line}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
