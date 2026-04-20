'use client';

type FileCategory = 'staged' | 'unstaged' | 'untracked';

interface ChangedFile {
  status: string;
  path: string;
  category: FileCategory;
}

interface BranchFileListProps {
  files: ChangedFile[];
  hue: number;
  dark: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  M: '#f0a030', // orange — modified
  A: '#4ade80', // green — added
  D: '#ff5c5c', // red — deleted
  R: '#60a5fa', // blue — renamed
  C: '#60a5fa', // blue — copied
  '?': '#9ca3af', // grey — untracked
};

const CATEGORY_LABELS: Record<FileCategory, string> = {
  staged: 'Staged',
  unstaged: 'Unstaged',
  untracked: 'Untracked',
};

const CATEGORY_ORDER: FileCategory[] = ['staged', 'unstaged', 'untracked'];

export function BranchFileList({ files, hue, dark }: BranchFileListProps) {
  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-4 px-3">
        <span className="text-white/50 text-xs">Working tree clean</span>
      </div>
    );
  }

  // Group by category
  const grouped = CATEGORY_ORDER
    .map(cat => ({
      category: cat,
      label: CATEGORY_LABELS[cat],
      items: files.filter(f => f.category === cat),
    }))
    .filter(g => g.items.length > 0);

  const sectionBorder = dark
    ? `hsla(${hue}, 40%, 40%, 0.25)`
    : `hsla(${hue}, 30%, 50%, 0.2)`;

  return (
    <div className="overflow-y-auto max-h-80 py-1.5">
      {grouped.map((group, gi) => (
        <div key={group.category}>
          {gi > 0 && (
            <div className="mx-2 my-1" style={{ borderTop: `1px solid ${sectionBorder}` }} />
          )}
          <div className="px-3 pt-1.5 pb-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-white/40">
              {group.label}
              <span className="ml-1 text-white/25">{group.items.length}</span>
            </span>
          </div>
          {group.items.map((file, fi) => {
            const color = STATUS_COLORS[file.status] || STATUS_COLORS['?'];
            return (
              <div
                key={`${group.category}-${fi}`}
                className="flex items-center gap-2 px-3 py-0.5 hover:bg-white/5"
              >
                <span
                  className="shrink-0 w-4 text-center text-[10px] font-bold rounded-sm leading-4"
                  style={{ color }}
                >
                  {file.status}
                </span>
                <span
                  className="text-xs text-white/75 truncate"
                  style={{ fontFamily: 'var(--font-jetbrains-mono, monospace)', direction: 'rtl', textAlign: 'left' }}
                  title={file.path}
                >
                  {file.path}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
