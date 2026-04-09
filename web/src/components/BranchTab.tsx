'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface BranchTabProps {
  projectPath: string;
  isTerminalExpanded: boolean;
}

interface GitStatus {
  branch: string | null;
  uncommitted: number;
}

/**
 * Generate a deterministic hue (0-360) from a string using DJB2 hash.
 * Different branch names produce visually distinct colors.
 */
function branchToHue(branch: string): number {
  let hash = 5381;
  for (let i = 0; i < branch.length; i++) {
    hash = ((hash << 5) + hash + branch.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/**
 * Detect if dark mode is active by checking for .dark class on <html>.
 */
function isDarkMode(): boolean {
  if (typeof document === 'undefined') return true;
  return document.documentElement.classList.contains('dark');
}

export function BranchTab({ projectPath, isTerminalExpanded }: BranchTabProps) {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null);
  const [dark, setDark] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchBranch = useCallback(async () => {
    try {
      const res = await fetch(`/api/bridge/git-status?cwd=${encodeURIComponent(projectPath)}`);
      if (!res.ok) {
        setGitStatus(null);
        return;
      }
      const data = await res.json() as GitStatus;
      setGitStatus(data.branch ? data : null);
    } catch {
      setGitStatus(null);
    }
  }, [projectPath]);

  // Fetch on mount + poll every 30s
  useEffect(() => {
    fetchBranch();
    intervalRef.current = setInterval(fetchBranch, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchBranch]);

  // Watch for theme changes
  useEffect(() => {
    setDark(isDarkMode());
    const observer = new MutationObserver(() => setDark(isDarkMode()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (!gitStatus) return null;

  const hue = branchToHue(gitStatus.branch!);

  const bg = dark ? `hsla(${hue}, 55%, 22%, 0.9)` : `hsla(${hue}, 40%, 48%, 0.92)`;
  const border = dark ? `hsla(${hue}, 60%, 45%, 0.5)` : `hsla(${hue}, 45%, 38%, 0.4)`;
  const glow = dark
    ? `0 -3px 12px hsla(${hue}, 70%, 50%, 0.2), 0 0 6px hsla(${hue}, 60%, 40%, 0.1)`
    : `0 -2px 8px hsla(${hue}, 50%, 50%, 0.15)`;

  // Position: to the left of GlobalClaudePanel
  // Collapsed panel: right-4 w-64 → branch tab right = 16px + 256px + 8px gap = 280px
  // Expanded panel (sm+): right-4 w-[700px] → branch tab right = 16px + 700px + 8px gap = 724px
  const rightPos = isTerminalExpanded
    ? 'right-4 sm:right-[724px]'
    : 'right-[280px]';

  return (
    <div
      onClick={fetchBranch}
      title={`${gitStatus.branch}${gitStatus.uncommitted > 0 ? ` — ${gitStatus.uncommitted} uncommitted` : ''}\nClick to refresh`}
      className={`fixed z-40 bottom-0 cursor-pointer select-none transition-all duration-300 ease-in-out ${rightPos}`}
    >
      <div
        className="rounded-t-md px-3 py-1.5 backdrop-blur-sm flex flex-col"
        style={{
          background: bg,
          borderWidth: '1px 1px 0 1px',
          borderStyle: 'solid',
          borderColor: border,
          boxShadow: glow,
        }}
      >
        <span className="max-w-[200px] truncate text-xs font-semibold text-white/90">
          {gitStatus.branch}
        </span>
        {gitStatus.uncommitted > 0 && (
          <span className="text-[10px] leading-tight text-white/55">
            {gitStatus.uncommitted} uncommitted
          </span>
        )}
      </div>
    </div>
  );
}
