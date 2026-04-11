'use client';

import { useState, useEffect, useMemo } from 'react';
import { createTwoFilesPatch } from 'diff';

interface SkillDiffViewerProps {
  skillName: string;
  currentVersion?: string;
  newVersion: string;
  currentContent: string | null;  // null for new skills
  newContent: string;
  onClose: () => void;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function parseDiffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
      // Parse hunk header for line numbers
      const match = raw.match(/@@ -(\d+)/);
      if (match) {
        oldLine = parseInt(match[1], 10) - 1;
        const newMatch = raw.match(/\+(\d+)/);
        if (newMatch) newLine = parseInt(newMatch[1], 10) - 1;
      }
      lines.push({ type: 'header', content: raw });
    } else if (raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('Index:') || raw.startsWith('===')) {
      // Skip file headers
    } else if (raw.startsWith('+')) {
      newLine++;
      lines.push({ type: 'add', content: raw.slice(1), newLineNo: newLine });
    } else if (raw.startsWith('-')) {
      oldLine++;
      lines.push({ type: 'remove', content: raw.slice(1), oldLineNo: oldLine });
    } else if (raw.startsWith(' ') || raw === '') {
      oldLine++;
      newLine++;
      lines.push({ type: 'context', content: raw.startsWith(' ') ? raw.slice(1) : raw, oldLineNo: oldLine, newLineNo: newLine });
    }
  }

  return lines;
}

const lineStyles: Record<string, string> = {
  add: 'bg-emerald-950/40 text-emerald-300',
  remove: 'bg-red-950/40 text-red-300',
  context: 'text-void-300',
  header: 'bg-neon-blue-950/30 text-neon-blue-300 font-medium',
};

const lineNoStyles: Record<string, string> = {
  add: 'text-emerald-600',
  remove: 'text-red-600',
  context: 'text-void-600',
  header: 'text-neon-blue-600',
};

const prefixChars: Record<string, string> = {
  add: '+',
  remove: '-',
  context: ' ',
  header: '',
};

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

  const diffLines = useMemo(() => {
    const oldContent = currentContent ?? '';
    const patch = createTwoFilesPatch(
      'current/SKILL.md',
      'updated/SKILL.md',
      oldContent,
      newContent,
      currentVersion ?? '(none)',
      newVersion,
      { context: 4 },
    );
    return parseDiffLines(patch);
  }, [currentContent, newContent, currentVersion, newVersion]);

  const isNewSkill = currentContent === null;
  const stats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const line of diffLines) {
      if (line.type === 'add') additions++;
      if (line.type === 'remove') deletions++;
    }
    return { additions, deletions };
  }, [diffLines]);

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
          <div className="font-mono text-xs leading-relaxed">
            {(viewMode === 'diff' || isNewSkill) ? (
              diffLines.map((line, i) => (
                <div key={i} className={`flex ${lineStyles[line.type]}`}>
                  <span className={`w-10 flex-shrink-0 select-none px-2 text-right ${lineNoStyles[line.type]}`}>
                    {line.type === 'header' ? '···' : (line.oldLineNo ?? line.newLineNo ?? '')}
                  </span>
                  <span className={`w-10 flex-shrink-0 select-none px-2 text-right ${lineNoStyles[line.type]}`}>
                    {line.type === 'header' ? '···' : (line.newLineNo ?? '')}
                  </span>
                  <span className={`w-4 flex-shrink-0 select-none text-center ${lineNoStyles[line.type]}`}>
                    {prefixChars[line.type]}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all px-2">
                    {line.type === 'header' ? line.content : line.content}
                  </span>
                </div>
              ))
            ) : (
              // Full view of new content
              newContent.split('\n').map((line, i) => (
                <div key={i} className="flex text-void-300">
                  <span className="w-10 flex-shrink-0 select-none px-2 text-right text-void-600">
                    {i + 1}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap break-all px-2">{line}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
