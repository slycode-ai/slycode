'use client';

/**
 * Shared line-diff renderer. Extracted from SkillDiffViewer so both the
 * SlyCode Updates direction (SkillDiffViewer) and the project→store import
 * review (StoreImportDiffViewer) render diffs identically.
 *
 * Pure rendering — no modal chrome, no theme assumptions beyond the line colors
 * (which read on both light and dark backgrounds).
 */

import { createTwoFilesPatch } from 'diff';

export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export function parseDiffLines(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('@@')) {
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

/** Build diff lines between two file contents. */
export function buildDiffLines(opts: {
  oldContent: string;
  newContent: string;
  oldLabel?: string;
  newLabel?: string;
  fileName?: string;
  context?: number;
}): DiffLine[] {
  const name = opts.fileName ?? 'file';
  const patch = createTwoFilesPatch(
    `current/${name}`,
    `updated/${name}`,
    opts.oldContent,
    opts.newContent,
    opts.oldLabel ?? '(none)',
    opts.newLabel ?? '',
    { context: opts.context ?? 4 },
  );
  return parseDiffLines(patch);
}

export function diffStats(lines: DiffLine[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === 'add') additions++;
    if (line.type === 'remove') deletions++;
  }
  return { additions, deletions };
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

/** Renders a list of parsed diff lines. Caller provides the scroll container. */
export function DiffLineRows({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
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
            {line.content}
          </span>
        </div>
      ))}
    </div>
  );
}
