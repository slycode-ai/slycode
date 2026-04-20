'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { BranchFileList } from './BranchFileList';

interface BranchTabProps {
  projectPath: string;
  isTerminalExpanded: boolean;
}

type FileCategory = 'staged' | 'unstaged' | 'untracked';

interface ChangedFile {
  status: string;
  path: string;
  category: FileCategory;
}

interface GitStatus {
  branch: string | null;
  uncommitted: number;
  files: ChangedFile[];
}

type PopoverState = 'hidden' | 'hovering' | 'pinned';

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
  const [popover, setPopover] = useState<PopoverState>('hidden');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  // Click-outside and Escape to dismiss pinned popover
  useEffect(() => {
    if (popover !== 'pinned') return;

    const handleMouseDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setPopover('hidden');
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopover('hidden');
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [popover]);

  const handleMouseEnter = () => {
    if (popover === 'pinned') return;
    setPopover('hovering');
    fetchBranch();
  };

  const handleMouseLeave = () => {
    if (popover === 'hovering') setPopover('hidden');
  };

  const handleClick = () => {
    if (popover === 'pinned') {
      setPopover('hidden');
    } else {
      setPopover('pinned');
      fetchBranch();
    }
  };

  if (!gitStatus) return null;

  const hue = branchToHue(gitStatus.branch!);
  const isOpen = popover !== 'hidden';

  const tabBg = dark ? `hsla(${hue}, 55%, 22%, 0.9)` : `hsla(${hue}, 40%, 48%, 0.92)`;
  const border = dark ? `hsla(${hue}, 60%, 45%, 0.5)` : `hsla(${hue}, 45%, 38%, 0.4)`;
  const glow = dark
    ? `0 -3px 12px hsla(${hue}, 70%, 50%, 0.2), 0 0 6px hsla(${hue}, 60%, 40%, 0.1)`
    : `0 -2px 8px hsla(${hue}, 50%, 50%, 0.15)`;
  const popoverBg = dark ? `hsla(${hue}, 50%, 15%, 0.95)` : `hsla(${hue}, 35%, 38%, 0.95)`;

  // Position: to the left of GlobalClaudePanel
  const rightPos = isTerminalExpanded
    ? 'right-4 sm:right-[724px]'
    : 'right-[280px]';

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`fixed z-40 bottom-0 cursor-pointer select-none transition-all duration-300 ease-in-out ${rightPos}`}
    >
      {/* Popover */}
      <div
        className={`absolute bottom-full left-0 mb-0 w-80 rounded-t-lg overflow-hidden backdrop-blur-md transition-all duration-150 ease-out ${
          isOpen ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'
        }`}
        style={{
          background: popoverBg,
          borderWidth: '1px 1px 0 1px',
          borderStyle: 'solid',
          borderColor: border,
          boxShadow: dark
            ? `0 -8px 24px hsla(${hue}, 60%, 20%, 0.4), 0 0 8px hsla(${hue}, 50%, 30%, 0.2)`
            : `0 -4px 16px hsla(${hue}, 40%, 30%, 0.2)`,
        }}
      >
        {/* Popover header */}
        <div
          className="px-3 py-1.5 flex items-center justify-between"
          style={{ borderBottom: `1px solid ${border}` }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/50">
            Changed files
          </span>
          {popover === 'pinned' && (
            <span className="text-[9px] text-white/30">pinned</span>
          )}
        </div>
        <BranchFileList files={gitStatus.files || []} hue={hue} dark={dark} />
      </div>

      {/* Tab */}
      <div
        onClick={handleClick}
        className={`rounded-t-md px-3 py-1.5 backdrop-blur-sm flex flex-col ${isOpen ? 'rounded-t-none' : ''}`}
        style={{
          background: tabBg,
          borderWidth: isOpen ? '0 1px 0 1px' : '1px 1px 0 1px',
          borderStyle: 'solid',
          borderColor: border,
          boxShadow: isOpen ? 'none' : glow,
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
