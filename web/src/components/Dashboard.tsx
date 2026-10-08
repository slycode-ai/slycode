'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { DashboardData, BridgeStats, ProjectFolder, ProjectStatus, ProjectWithBacklog } from '@/lib/types';
import { projectStatus, PROJECT_STATUSES } from '@/lib/project-status';
import { workingInActive, canReorder, groupDen, parseShowParam, reorderAfterDrop, serializeShow, shortcutOrder, statusCounts, toggleShown, type DenSection } from '@/lib/den-filter';
import { folderOf, folderOrderAfterDrop, sortedFolders } from '@/lib/project-folders';
import { readCollapsedFolders, writeCollapsedFolders } from '@/lib/den-collapse-prefs';
import { DenFolderHeader, NewFolderInput } from './DenFolder';
import { DenStatusFilter, ProjectColdRow } from './DenStatus';
import { ProjectStatusDialog } from './ProjectStatusDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { connectionManager } from '@/lib/connection-manager';
import { usePolling } from '@/hooks/usePolling';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { ProjectCard } from './ProjectCard';
import { ConnectionStatusIndicator } from './ConnectionStatusIndicator';
import { AddProjectModal } from './AddProjectModal';
import { GlobalClaudePanel } from './GlobalClaudePanel';
import { SearchBar } from './SearchBar';
import { DashboardAttention } from './DashboardAttention';
import { NewOutputList, type NewOutputItem } from './NewOutputList';
import { CliAssetsTab } from './CliAssetsTab';
import { AtlasRollup } from './AtlasRollup';
import { ActivityFeed } from './ActivityFeed';
import { ThemeToggle } from './ThemeToggle';
import { VoiceSettingsButton } from './VoiceSettingsButton';
import { LogoutButton } from './LogoutButton';
import { ProviderConfigModal } from './ProviderConfigModal';
import { VersionUpdateToast } from './VersionUpdateToast';
import { sumProjectActivityCounts } from '@/lib/session-keys';
import { ChangelogModal } from './ChangelogModal';
import { fetchWhatsNew, openWhatsNew, WHATS_NEW_SEEN_EVENT } from '@/lib/whats-new-client';
import { DISCORD_INVITE_URL } from '@/lib/community-links';
import { useVoice } from '@/contexts/VoiceContext';
import { formatDateTime } from '@/lib/date-format';
import Tooltip from './Tooltip';

interface DashboardProps {
  data: DashboardData;
}

type Tab = 'projects' | 'cli-assets' | 'atlas';

/** Collapse key + pseudo-folder for the "No folder" section (#0381 Phase B). */
const NO_FOLDER_KEY = '__none';
const NO_FOLDER: ProjectFolder = { id: NO_FOLDER_KEY, name: 'No folder', order: Number.MAX_SAFE_INTEGER };
function sectionKey(section: { folder: ProjectFolder | null }): string {
  return section.folder?.id ?? NO_FOLDER_KEY;
}

/**
 * Persist a Den reorder (and optional folder move) in one write. Returns an
 * error message, or null on success. Module-level on purpose: React Compiler
 * bails on a component whose try/catch contains logical expressions.
 */
async function saveProjectOrder(
  projectIds: string[],
  move?: { projectId: string; folderId: string | null },
): Promise<string | null> {
  try {
    const res = await fetch('/api/projects/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectIds, ...(move ? { move } : {}) }),
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => ({} as { error?: string }));
    return body.error || `Saving the new order failed (${res.status})`;
  } catch (error) {
    return (error as Error).message;
  }
}

export function Dashboard({ data: initialData }: DashboardProps) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [isLive, setIsLive] = useState(false);
  const connectionIdRef = useRef<string | null>(null);
  const [isGlobalActive, setIsGlobalActive] = useState(false);
  const voice = useVoice();
  const [bridgeCounts, setBridgeCounts] = useState<Record<string, number> | null>(null);
  const [unseenCounts, setUnseenCounts] = useState<Record<string, number>>({});
  const [unseenCards, setUnseenCards] = useState<Record<string, { id: string; number?: number; title: string }[]>>({});
  // Open "new output" list: anchored to the chip that opened it; projectId null = all projects.
  const [newOutputOpen, setNewOutputOpen] = useState<{ anchor: HTMLElement; projectId: string | null } | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('projects');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  // Phase B (#0381): drops are per folder section — {section key, index in its visible tiles}.
  const [dropTarget, setDropTarget] = useState<{ section: string; index: number } | null>(null);
  const [draggedFolderId, setDraggedFolderId] = useState<string | null>(null);
  const [slycodeVersion, setSlycodeVersion] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  // What's new (#0379): footer reopen link, with a dot until this release's splash is dismissed.
  const [whatsNew, setWhatsNew] = useState<{ available: boolean; unseen: boolean }>({ available: false, unseen: false });
  const [showProviderConfig, setShowProviderConfig] = useState(false);

  // Auto-open the global terminal when arriving via /global or /?openGlobal=1.
  // Strip the param after consuming so a refresh doesn't re-trigger.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const openGlobalRequested = searchParams.get('openGlobal') === '1';
  const consumedOpenGlobalRef = useRef(false);

  // Activate the CLI Assets tab when arriving via ?tab=updates|cli-assets.
  // Used by SkillUpdateToast click routing. Has to be in an effect because
  // useState initializer runs during SSR (no window) and hydration uses the
  // SSR value, so the URL param is never read. The setState-in-effect lint
  // rule is suppressed — same shape as other consumers in this codebase
  // (CliAssetsTab provider switch, html-viewer, etc.).
  const requestedTab = searchParams.get('tab');
  const consumedTabRef = useRef(false);
  useEffect(() => {
    if (consumedTabRef.current) return;
    if (requestedTab === 'updates' || requestedTab === 'cli-assets') {
      consumedTabRef.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab('cli-assets');
    }
  }, [requestedTab]);

  useEffect(() => {
    let cancelled = false;
    fetchWhatsNew().then(status => {
      if (!cancelled && status) setWhatsNew({ available: !!status.latest, unseen: status.unseen });
    });
    const onSeen = () => setWhatsNew(w => ({ ...w, unseen: false }));
    window.addEventListener(WHATS_NEW_SEEN_EVENT, onSeen);
    return () => { cancelled = true; window.removeEventListener(WHATS_NEW_SEEN_EVENT, onSeen); };
  }, []);

  // Fetch SlyCode version on mount
  useEffect(() => {
    fetch('/api/version-check')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.current) setSlycodeVersion(data.current); })
      .catch(() => {});
  }, []);

  // Merge live bridge counts into project data (poll is source of truth once it has run).
  // Alias-aware: sum across each project's canonical sessionKey + legacy id form.
  const projectsWithBridge = data.projects.map(p => ({
    ...p,
    activeSessions: bridgeCounts !== null ? sumProjectActivityCounts(p, bridgeCounts) : (p.activeSessions ?? 0),
  }));
  const accessibleProjects = projectsWithBridge.filter((p) => p.accessible);
  const inaccessibleProjects = projectsWithBridge.filter((p) => !p.accessible);
  const [showAddModal, setShowAddModal] = useState(false);
  const router = useRouter();

  // --- Project status (card #0381) ---
  // The filter lives in the URL (?show=), never in storage: the Den always
  // opens on Active. Archived projects render as cold rows, not tiles.
  const shown = parseShowParam(searchParams.get('show'));
  const counts = statusCounts(projectsWithBridge);
  // Phase B: folder sections. No folders → one header-less section (the Den
  // looks exactly as before). Collapse is device-local (localStorage).
  const folders = sortedFolders(data.folders);
  const { grouped, sections } = groupDen(accessibleProjects, folders, shown);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    // Read after mount: localStorage doesn't exist during SSR.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(readCollapsedFolders());
  }, []);
  const toggleCollapsed = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
    writeCollapsedFolders(next, [NO_FOLDER_KEY, ...folders.map((f) => f.id)]);
  };
  // Number keys follow the visible tiles, top to bottom, skipping collapsed folders.
  const visibleTiles = shortcutOrder(sections.map((sec) => ({ ...sec, folder: sec.folder ?? (grouped ? NO_FOLDER : null) })), collapsed);
  const visibleCount = sections.reduce((n, sec) => n + sec.tiles.length + sec.cold.length, 0);
  const needYouByProject = new Map<string, number>();
  for (const item of data.needsYou ?? []) needYouByProject.set(item.projectId, (needYouByProject.get(item.projectId) ?? 0) + 1);
  const visibleInaccessible = inaccessibleProjects.filter((p) => shown.has(projectStatus(p)));
  const reorderable = canReorder(shown);
  const activeProjectCount = counts.active;
  const hiddenCount = projectsWithBridge.length - activeProjectCount;
  const setShown = (next: Set<ProjectStatus>) => {
    const params = new URLSearchParams(searchParams.toString());
    const value = serializeShow(next);
    if (value) params.set('show', value);
    else params.delete('show');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const [statusRequest, setStatusRequest] = useState<{ project: ProjectWithBacklog; next: Exclude<ProjectStatus, 'active'> } | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [removeCold, setRemoveCold] = useState<ProjectWithBacklog | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<ProjectFolder | null>(null);

  // Strip ?openGlobal=1 after first render so a refresh doesn't re-trigger
  // the auto-expand. The `defaultExpanded` prop on GlobalClaudePanel only
  // applies on its initial mount, so the URL strip is safe.
  useEffect(() => {
    if (openGlobalRequested && !consumedOpenGlobalRef.current) {
      consumedOpenGlobalRef.current = true;
      router.replace(pathname, { scroll: false });
    }
  }, [openGlobalRequested, pathname, router]);

  // Number-key shortcuts to jump to projects
  useKeyboardShortcuts({
    onNumberKey: (n) => {
      const project = visibleTiles[n - 1];
      if (project) {
        router.push(`/project/${project.id}`);
      }
    },
    enabled: activeTab === 'projects' && !showAddModal,
  });

  // Fetch fresh dashboard data
  const refreshData = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard');
      if (res.ok) {
        const newData = await res.json();
        setData(newData);
      }
    } catch (error) {
      console.error('Failed to refresh dashboard:', error);
    }
  }, []);

  // Poll bridge stats for global terminal activity + per-project active sessions (every 2s)
  const fetchGlobalActivity = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch('/api/bridge/stats', { signal });
      if (res.ok) {
        const stats: BridgeStats = await res.json();
        const globalSession = stats.sessions.find((s) => s.name === 'global:global' || /^global:[^:]+:global$/.test(s.name));
        setIsGlobalActive(globalSession?.isActive ?? false);

        // Count actively working sessions per project group
        const counts: Record<string, number> = {};
        for (const s of stats.sessions) {
          if (s.isActive) {
            const group = s.name.split(':')[0];
            counts[group] = (counts[group] || 0) + 1;
          }
        }
        setBridgeCounts(counts);
      }
    } catch {
      // Bridge might not be running
    }
  }, []);

  usePolling(fetchGlobalActivity, 1000);

  // Unseen-card roll-up per project (feature 082). Server-side because it needs
  // each project's seen-state file; polled slowly since it only shifts when a
  // session settles or a card is opened.
  const fetchUnseenCounts = useCallback(async (signal: AbortSignal) => {
    try {
      const res = await fetch('/api/board-view-state?counts=1', { signal });
      if (res.ok) {
        const body = await res.json();
        if (body?.counts) setUnseenCounts(body.counts as Record<string, number>);
        if (body?.cards) setUnseenCards(body.cards as Record<string, { id: string; number?: number; title: string }[]>);
      }
    } catch {
      // Leave the last known counts alone rather than flashing them to zero.
    }
  }, []);

  usePolling(fetchUnseenCounts, 10000);

  // Connect to SSE stream for live updates using ConnectionManager
  useEffect(() => {
    const connectionId = connectionManager.createManagedEventSource(
      '/api/kanban/stream',
      {
        onOpen: () => {
          setIsLive(true);
        },
        onError: () => {
          setIsLive(false);
        },
        connected: () => {
          setIsLive(true);
        },
        update: () => {
          refreshData();
        },
      }
    );
    connectionIdRef.current = connectionId;

    return () => {
      if (connectionIdRef.current) {
        connectionManager.closeConnection(connectionIdRef.current);
        connectionIdRef.current = null;
      }
      setIsLive(false);
    };
  }, [refreshData]);

  // --- Project drag-and-drop reordering (per folder section, #0381 Phase B) ---
  // Plain functions (not useCallback): the React Compiler memoizes them, and
  // manual deps on the derived section arrays can't be preserved.
  const resetDrag = () => { setDraggedId(null); setDropTarget(null); setDraggedFolderId(null); };

  const handleSectionDragOver = (e: React.DragEvent<HTMLDivElement>, section: DenSection<ProjectWithBacklog>) => {
    if (!draggedId) return; // folder-header drags are handled by the headers
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const key = sectionKey(section);

    const cards = Array.from(e.currentTarget.children).filter(
      (child) => child.getAttribute('data-project-card') !== null
    );
    if (cards.length === 0) { setDropTarget({ section: key, index: 0 }); return; }

    // Group cards into rows by matching top position (within 10px tolerance)
    const rows: { indices: number[]; rects: DOMRect[]; top: number; bottom: number }[] = [];
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect();
      const existingRow = rows.find((r) => Math.abs(r.top - rect.top) < 10);
      if (existingRow) {
        existingRow.indices.push(i);
        existingRow.rects.push(rect);
        existingRow.bottom = Math.max(existingRow.bottom, rect.bottom);
      } else {
        rows.push({ indices: [i], rects: [rect], top: rect.top, bottom: rect.bottom });
      }
    }

    // Find which row the cursor is in (or closest to)
    let targetRow = rows[rows.length - 1];
    for (const row of rows) {
      const rowIdx = rows.indexOf(row);
      const nextRow = rows[rowIdx + 1];
      const boundary = nextRow ? (row.bottom + nextRow.top) / 2 : Infinity;
      if (e.clientY < boundary) {
        targetRow = row;
        break;
      }
    }

    // Within the target row, find the insertion point by horizontal position
    let newDropIndex = targetRow.indices[targetRow.indices.length - 1] + 1;
    for (let j = 0; j < targetRow.rects.length; j++) {
      const midX = targetRow.rects[j].left + targetRow.rects[j].width / 2;
      if (e.clientX < midX) {
        newDropIndex = targetRow.indices[j];
        break;
      }
    }

    // Suppress the indicator next to the dragged card in its own section (no-op drop)
    const dragIdx = section.tiles.findIndex((p) => p.id === draggedId);
    if (dragIdx !== -1 && (newDropIndex === dragIdx || newDropIndex === dragIdx + 1)) {
      setDropTarget(null);
    } else {
      setDropTarget({ section: key, index: newDropIndex });
    }
  };

  const handleSectionDragLeave = (e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDropTarget(null);
    }
  };

  /**
   * Drop the dragged project at `index` among a section's visible tiles. One
   * write: the full registry order, plus a folder move when it changed folder.
   */
  const dropProject = async (section: DenSection<ProjectWithBacklog>, index: number) => {
    const id = draggedId;
    resetDrag();
    if (!id) return;
    const order = reorderAfterDrop(data.projects, section.tiles, id, index);
    const dragged = data.projects.find((p) => p.id === id);
    if (!dragged) return;
    const targetFolder = section.folder?.id ?? null;
    const move = grouped && targetFolder !== (folderOf(dragged, folders)?.id ?? null)
      ? { projectId: id, folderId: targetFolder }
      : undefined;

    // Optimistic update
    const byId = new Map(data.projects.map((p) => [p.id, p]));
    const next = order
      .map((pid) => byId.get(pid))
      .filter((p): p is typeof data.projects[number] => p !== undefined)
      .map((p) => (move && p.id === id ? { ...p, folderId: targetFolder ?? undefined } : p));
    setData((prev) => ({ ...prev, projects: next }));

    const error = await saveProjectOrder(order, move);
    if (error) {
      setStatusError(`${dragged.name}: ${error}`);
      await refreshData();
    }
  };

  // --- Folder writes (#0381 Phase B) — every failure is shown, never swallowed ---
  const folderApi = async (method: 'POST' | 'PATCH' | 'DELETE', body?: unknown, query = '') => {
    const res = await fetch(`/api/projects/folders${query}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({} as { error?: string }));
      throw new Error(b.error || `Folder change failed (${res.status})`);
    }
    await refreshData();
  };
  const folderMenuFor = (project: ProjectWithBacklog) => ({
    folders,
    onFolder: (folderId: string | null) => {
      setStatusError(null);
      folderApi('PATCH', { projectId: project.id, folderId }).catch((e: Error) => setStatusError(`${project.name}: ${e.message}`));
    },
    onNewFolder: (name: string) => folderApi('POST', { name, projectId: project.id }),
  });
  const dropFolderOn = (target: ProjectFolder, position: 'before' | 'after') => {
    const dragged = draggedFolderId;
    resetDrag();
    if (!dragged || dragged === target.id) return;
    const ids = folderOrderAfterDrop(folders.map((f) => f.id), dragged, target.id, position);
    folderApi('PATCH', { order: ids }).catch((e: Error) => setStatusError(e.message));
  };

  // Status writes (#0381). Resume/restore goes straight through; the held
  // statuses go through the dialog first. Failures are shown, never swallowed.
  const postStatus = useCallback(async (projectId: string, next: ProjectStatus) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({} as { error?: string }));
      throw new Error(body.error || `Status change failed (${res.status})`);
    }
    await refreshData();
  }, [refreshData]);
  const requestStatus = (project: ProjectWithBacklog, next: ProjectStatus) => {
    setStatusError(null);
    if (next === 'active') {
      postStatus(project.id, 'active').catch((e: Error) => setStatusError(`${project.name}: ${e.message}`));
    } else {
      setStatusRequest({ project, next });
    }
  };

  const addProjectTile = (
    <button
      onClick={() => setShowAddModal(true)}
      className="flex h-full min-h-[140px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-1"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
      </svg>
      Add a project
    </button>
  );

  // Hero line counts Active projects only (#0381) — a session still finishing
  // in a paused project shows on that project's tile, not in the headline.
  const workingNow = workingInActive(data.projects);
  const newOutput = Object.values(unseenCounts).reduce((n, c) => n + c, 0);

  // Unseen output is a nice-to-know, not the headline: a quiet chip in the
  // subline and on each tile, each opening a short list of the cards.
  const newOutputItems = (projectId: string | null): NewOutputItem[] =>
    data.projects
      .filter((p) => projectId === null || p.id === projectId)
      .flatMap((p) => (unseenCards[p.id] ?? []).map((c) => ({ projectId: p.id, projectName: p.name, cardId: c.id, number: c.number, title: c.title })));
  const openNewOutput = (anchor: HTMLElement, projectId: string | null) => {
    if (newOutputOpen?.anchor === anchor) { setNewOutputOpen(null); return; }
    const items = newOutputItems(projectId);
    // A tile with exactly one new card goes straight to it.
    if (projectId !== null && items.length === 1) {
      router.push(`/project/${items[0].projectId}?card=${items[0].cardId}`);
      return;
    }
    setNewOutputOpen({ anchor, projectId });
  };
  const closeNewOutput = useCallback(() => setNewOutputOpen(null), []);

  return (
    <div className="relative min-h-screen bg-page">
      {/* Connection status + version update toast */}
      <ConnectionStatusIndicator position="top-right" />
      <VersionUpdateToast />
      {showProviderConfig && <ProviderConfigModal onClose={() => setShowProviderConfig(false)} />}

      {/* Top bar: brand, tabs, search, settings */}
      <header className="fox-rule sticky top-0 z-20 bg-surface-1">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 sm:gap-5 sm:px-6">
          <span className="flex shrink-0 items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/slycode_logo_light.webp" alt="" className="h-8 w-8 object-contain mix-blend-multiply dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/slycode_logo.webp" alt="" className="hidden h-8 w-8 object-contain mix-blend-lighten dark:block" />
            <span className="hidden text-[15px] font-semibold tracking-tight text-ink-1 sm:inline">SlyCode</span>
          </span>
          <nav className="flex h-full min-w-0 items-stretch gap-0.5 sm:gap-2" aria-label="Dashboard sections">
            <button
              onClick={() => setActiveTab('projects')}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 text-[13px] font-medium transition-colors sm:gap-2 sm:px-2 ${
                activeTab === 'projects' ? 'border-accent text-ink-1' : 'border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              Code Den
            </button>
            <button
              onClick={() => setActiveTab('cli-assets')}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 text-[13px] font-medium transition-colors sm:gap-2 sm:px-2 ${
                activeTab === 'cli-assets' ? 'border-accent text-ink-1' : 'border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              CLI Assets
              {(data.totalOutdatedAssets ?? 0) > 0 && (
                <span className="rounded bg-warn/10 px-1.5 font-mono text-[11px] leading-[18px] text-warn-text">
                  {data.totalOutdatedAssets}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('atlas')}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 text-[13px] font-medium transition-colors sm:gap-2 sm:px-2 ${
                activeTab === 'atlas' ? 'border-accent text-ink-1' : 'border-transparent text-ink-3 hover:text-ink-1'
              }`}
            >
              Atlas
            </button>
          </nav>
          <div className="ml-auto hidden w-72 sm:block">
            <SearchBar
              onResultClick={(result) => {
                // Archived hits need the board in archived mode or the card isn't
                // loaded and the deep-link silently finds nothing (feature 082).
                const archived = result.isArchived ? '&archived=1' : '';
                window.location.href = `/project/${result.projectId}?card=${result.cardId}${archived}`;
              }}
            />
          </div>
          {isLive && (
            <Tooltip content="Live updates connected" placement="bottom">
              <span className="hidden items-center gap-1.5 text-[11px] text-ink-3 sm:flex">
                <span className="h-1.5 w-1.5 rounded-full bg-live" />
                Live
              </span>
            </Tooltip>
          )}
          <div className="ml-auto flex shrink-0 items-center sm:ml-0 sm:gap-1">
            <Tooltip content="Provider config" placement="bottom">
              <button
                onClick={() => setShowProviderConfig(true)}
                aria-label="Provider config"
                className="rounded-lg p-2 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1"
              >
                {/* Sliders icon — ordering + toggles */}
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h9m4 0h3M4 12h3m4 0h9M4 18h13m2 0h1M13 4v4M7 10v4M17 16v4" />
                </svg>
              </button>
            </Tooltip>
            <VoiceSettingsButton />
            <ThemeToggle />
            <LogoutButton />
          </div>
        </div>
      </header>

      {/* Mobile search */}
      <div className="px-4 pt-4 sm:hidden">
        <SearchBar
          onResultClick={(result) => {
            const archived = result.isArchived ? '&archived=1' : '';
            window.location.href = `/project/${result.projectId}?card=${result.cardId}${archived}`;
          }}
        />
      </div>

      {/* Main Content */}
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        {activeTab === 'projects' ? (
          <>
            {/* What's happening now — built from data the dashboard already has */}
            <section className="mb-6">
              <h1 className="text-[26px] font-semibold leading-8 tracking-tight text-ink-1">
                {workingNow > 0 ? (
                  <span className="border-b-2 border-live">
                    {workingNow} agent{workingNow !== 1 ? 's' : ''} working.
                  </span>
                ) : (
                  <span>The den is quiet.</span>
                )}
              </h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] leading-5 text-ink-2">
                <span>
                  {activeProjectCount} {hiddenCount > 0 ? 'active ' : ''}project{activeProjectCount !== 1 ? 's' : ''}, {data.totalBacklogItems} card{data.totalBacklogItems !== 1 ? 's' : ''} in backlog
                  {(data.totalUncommitted ?? 0) > 0 && `, ${data.totalUncommitted} uncommitted file${data.totalUncommitted !== 1 ? 's' : ''}`}.
                </span>
                {hiddenCount > 0 && shown.size < PROJECT_STATUSES.length && (
                  <button
                    type="button"
                    onClick={() => setShown(new Set(PROJECT_STATUSES))}
                    className="text-ink-2 underline decoration-line-strong underline-offset-[3px] hover:text-ink-1 hover:decoration-ink-3"
                  >
                    {hiddenCount} more paused, complete or archived
                  </button>
                )}
                {newOutput > 0 && (
                  <button
                    type="button"
                    onClick={(e) => openNewOutput(e.currentTarget, null)}
                    aria-haspopup="dialog"
                    aria-expanded={newOutputOpen?.projectId === null}
                    className="flex items-center gap-1.5 rounded-md border border-line px-2 text-[12px] leading-6 text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-1"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
                    {newOutput} new output
                  </button>
                )}
              </p>
            </section>

            {/* What's waiting on the owner, and what runs next */}
            <DashboardAttention needsYou={data.needsYou ?? []} upcoming={data.upcoming ?? []} heldRunsNext24h={data.heldRunsNext24h ?? 0} />

            {/* Projects */}
            <section className="mb-10">
              <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-base font-semibold text-ink-1">Projects</h2>
                  <span className="font-mono text-[12px] text-ink-3">{visibleCount}</span>
                </div>
                <DenStatusFilter shown={shown} counts={counts} onToggle={(s) => setShown(toggleShown(shown, s))} />
                <div className="ml-auto">
                  {creatingFolder ? (
                    <NewFolderInput
                      onCreate={async (name) => { await folderApi('POST', { name }); setCreatingFolder(false); }}
                      onCancel={() => setCreatingFolder(false)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreatingFolder(true)}
                      className="flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2.5 text-[12px] text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink-1"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                        <path strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                        <path strokeLinecap="round" d="M12 11v5M9.5 13.5h5" />
                      </svg>
                      New folder
                    </button>
                  )}
                </div>
              </div>
              {statusError && (
                <div role="alert" className="mb-4 flex items-center gap-3 rounded-lg bg-danger/10 px-3 py-2 text-[13px] text-danger-text">
                  <span className="min-w-0 flex-1">{statusError}</span>
                  <button type="button" onClick={() => setStatusError(null)} className="text-[12px] underline underline-offset-2">Dismiss</button>
                </div>
              )}
              {sections.map((section) => {
                const key = sectionKey(section);
                const isCollapsed = grouped && collapsed.has(key);
                const lastIdx = section.tiles.length - 1;
                const indicatorAt = draggedId && dropTarget?.section === key ? dropTarget.index : null;
                return (
                  <div key={key} className={grouped ? 'mb-7' : ''}>
                    {grouped && (
                      <DenFolderHeader
                        folder={section.folder}
                        count={section.members.length}
                        collapsed={isCollapsed}
                        onToggle={() => toggleCollapsed(key)}
                        working={section.members.reduce((n, p) => n + (p.activeSessions ?? 0), 0)}
                        needYou={section.members.reduce((n, p) => n + (needYouByProject.get(p.id) ?? 0), 0)}
                        paused={section.members.filter((p) => projectStatus(p) === 'paused').length}
                        onRename={section.folder ? (name) => folderApi('PATCH', { id: section.folder!.id, name }) : undefined}
                        onDelete={section.folder ? () => setDeleteFolderTarget(section.folder) : undefined}
                        tileDragActive={reorderable && !!draggedId}
                        onTileDrop={() => void dropProject(section, section.tiles.length)}
                        draggableFolder={reorderable && !!section.folder}
                        onFolderDragStart={() => section.folder && setDraggedFolderId(section.folder.id)}
                        onFolderDragEnd={resetDrag}
                        folderDropActive={!!draggedFolderId && !!section.folder && draggedFolderId !== section.folder.id}
                        onFolderDrop={(pos) => section.folder && dropFolderOn(section.folder, pos)}
                      />
                    )}
                    {!isCollapsed && (
                      <>
                        <div
                          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                          onDragOver={reorderable ? (e) => handleSectionDragOver(e, section) : undefined}
                          onDragLeave={reorderable ? handleSectionDragLeave : undefined}
                          onDrop={reorderable ? (e) => {
                            e.preventDefault();
                            if (dropTarget?.section === key) void dropProject(section, dropTarget.index);
                            else resetDrag();
                          } : undefined}
                        >
                          {section.tiles.map((project, i) => {
                            const si = visibleTiles.indexOf(project);
                            return (
                              <div key={project.id} data-project-card className="relative">
                                {indicatorAt === i && (
                                  <div className="pointer-events-none absolute -left-2 top-0 bottom-0 w-0.5 rounded-full bg-accent" />
                                )}
                                {indicatorAt === section.tiles.length && i === lastIdx && grouped && (
                                  <div className="pointer-events-none absolute -right-2 top-0 bottom-0 w-0.5 rounded-full bg-accent" />
                                )}
                                <ProjectCard
                                  project={project}
                                  onDeleted={refreshData}
                                  unseenCount={unseenCounts[project.id] ?? 0}
                                  onUnseenClick={(anchor) => openNewOutput(anchor, project.id)}
                                  shortcutKey={si >= 0 && si < 10 ? (si === 9 ? 0 : si + 1) : undefined}
                                  draggable={reorderable}
                                  onDragStart={() => setDraggedId(project.id)}
                                  onDragEnd={resetDrag}
                                  onStatusRequest={(next) => requestStatus(project, next)}
                                  folderMenu={folderMenuFor(project)}
                                />
                              </div>
                            );
                          })}
                          {grouped && section.folder && section.members.length === 0 && (
                            <div className={`flex min-h-[88px] items-center justify-center rounded-xl border border-dashed px-4 text-center text-[13px] text-ink-3 ${indicatorAt === 0 ? 'border-accent bg-accent/5' : 'border-line-strong'}`}>
                              Empty. Drag a project here, or use a project&apos;s ⋯ menu.
                            </div>
                          )}
                          {!grouped && (
                            <div className="relative">
                              {indicatorAt === section.tiles.length && (
                                <div className="pointer-events-none absolute -left-2 top-0 bottom-0 w-0.5 rounded-full bg-accent" />
                              )}
                              {addProjectTile}
                            </div>
                          )}
                        </div>
                        {section.cold.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {section.cold.map((project) => (
                              <ProjectColdRow
                                key={project.id}
                                project={project}
                                onStatusRequest={(next) => requestStatus(project, next)}
                                onRemove={() => setRemoveCold(project)}
                                folderMenu={folderMenuFor(project)}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
              {grouped && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <div>{addProjectTile}</div>
                </div>
              )}
            </section>

            {/* Inaccessible Projects */}
            {visibleInaccessible.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-4 text-base font-semibold text-ink-3">
                  Unavailable
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleInaccessible.map((project) => (
                    <ProjectCard key={project.id} project={project} onDeleted={refreshData} unseenCount={unseenCounts[project.id] ?? 0} onUnseenClick={(anchor) => openNewOutput(anchor, project.id)} onStatusRequest={(next) => requestStatus(project, next)} draggable={false} />
                  ))}
                </div>
              </section>
            )}

            {/* Activity Feed */}
            <section>
              <ActivityFeed
                projectNames={Object.fromEntries(data.projects.map((p) => [p.id, p.name]))}
              />
            </section>
          </>
        ) : activeTab === 'atlas' ? (
          <>
            <p className="mb-6 text-sm text-ink-3">
              Codebase atlases across the workspace — one map per project
            </p>
            <AtlasRollup />
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-ink-3">
              Reusable skills, agents, and configs — manage and deploy across projects
            </p>
            <CliAssetsTab />
          </>
        )}

        {/* Last Refresh + Copyright */}
        <footer className="mt-12 border-t border-line pt-6 text-center text-[12px] text-ink-3">
          <p>Last refresh: {formatDateTime(data.lastRefresh)}</p>
          <p className="mt-1.5">
            &copy; 2026 SlyCode (<a href="https://slycode.ai" target="_blank" rel="noopener noreferrer" className="hover:text-accent transition-colors">slycode.ai</a>). All rights reserved.
            {slycodeVersion && <span className="ml-2 text-ink-3">v{slycodeVersion}</span>}
            {whatsNew.available && (
              <button
                type="button"
                onClick={openWhatsNew}
                className="relative ml-2 text-ink-3 hover:text-accent transition-colors underline-offset-2 hover:underline"
              >
                What&apos;s new
                {whatsNew.unseen && (
                  <span aria-label="(unread)" className="absolute -right-2 -top-px h-1.5 w-1.5 rounded-full bg-accent" />
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowChangelog(true)}
              className={`${whatsNew.unseen ? 'ml-4' : 'ml-2'} text-ink-3 hover:text-accent transition-colors underline-offset-2 hover:underline`}
            >
              Changelog
            </button>
            <a
              href={DISCORD_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 text-ink-3 hover:text-accent transition-colors underline-offset-2 hover:underline"
            >
              Discord
            </a>
          </p>
        </footer>
      </main>

      <AddProjectModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={refreshData}
      />

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}

      {newOutputOpen && (
        <NewOutputList
          anchor={newOutputOpen.anchor}
          items={newOutputItems(newOutputOpen.projectId)}
          heading={newOutputOpen.projectId === null
            ? 'New output'
            : `New output in ${data.projects.find((p) => p.id === newOutputOpen.projectId)?.name ?? 'project'}`}
          showProject={newOutputOpen.projectId === null}
          onClose={closeNewOutput}
        />
      )}

      {statusRequest && (
        <ProjectStatusDialog
          projectId={statusRequest.project.id}
          projectName={statusRequest.project.name}
          next={statusRequest.next}
          onCancel={() => setStatusRequest(null)}
          onConfirm={async () => {
            await postStatus(statusRequest.project.id, statusRequest.next);
            setStatusRequest(null);
          }}
        />
      )}

      <ConfirmDialog
        open={removeCold !== null}
        onClose={() => setRemoveCold(null)}
        onConfirm={async () => {
          const target = removeCold;
          setRemoveCold(null);
          if (!target) return;
          const res = await fetch(`/api/projects/${encodeURIComponent(target.id)}`, { method: 'DELETE' }).catch(() => null);
          if (!res?.ok) setStatusError(`${target.name}: removing the project failed`);
          await refreshData();
        }}
        title="Remove project"
        message={<>This removes <strong className="text-ink-1">{removeCold?.name}</strong> from SlyCode. Project files are not deleted.</>}
        confirmLabel="Remove"
      />

      <ConfirmDialog
        open={deleteFolderTarget !== null}
        onClose={() => setDeleteFolderTarget(null)}
        onConfirm={() => {
          const target = deleteFolderTarget;
          setDeleteFolderTarget(null);
          if (!target) return;
          folderApi('DELETE', undefined, `?id=${encodeURIComponent(target.id)}`).catch((e: Error) => setStatusError(e.message));
        }}
        title="Delete folder"
        message={<>Delete the <strong className="text-ink-1">{deleteFolderTarget?.name}</strong> folder? Its projects move to No folder. No projects are removed.</>}
        confirmLabel="Delete folder"
      />

      {/* Global Terminal */}
      <GlobalClaudePanel
        sessionNameOverride="global:global"
        cwdOverride={data.slycodeRoot}
        terminalClassOverride="global-terminal"
        isActive={isGlobalActive}
        label="Global Terminal"
        voiceTerminalId="dashboard-global"
        defaultExpanded={openGlobalRequested}
        onTerminalReady={(handle) => {
          if (handle) voice.registerTerminal('dashboard-global', handle);
          else voice.unregisterTerminal('dashboard-global');
        }}
      />
    </div>
  );
}
