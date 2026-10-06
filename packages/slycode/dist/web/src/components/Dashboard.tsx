'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { DashboardData, BridgeStats } from '@/lib/types';
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
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
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
      const project = accessibleProjects[n - 1];
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

  // --- Project drag-and-drop reordering ---
  const handleProjectDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const grid = gridRef.current;
    if (!grid) return;

    const cards = Array.from(grid.children).filter(
      (child) => child.getAttribute('data-project-card') !== null
    );
    if (cards.length === 0) { setDropIndex(0); return; }

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
      // Use midpoint between this row's bottom and next row's top as the boundary
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

    // Suppress indicator adjacent to the dragged card (would be a no-op drop)
    const dragIdx = accessibleProjects.findIndex((p) => p.id === draggedId);
    if (dragIdx !== -1 && (newDropIndex === dragIdx || newDropIndex === dragIdx + 1)) {
      setDropIndex(null);
    } else {
      setDropIndex(newDropIndex);
    }
  }, [draggedId, accessibleProjects]);

  const handleProjectDragLeave = useCallback((e: React.DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDropIndex(null);
    }
  }, []);

  const handleProjectDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const droppedId = e.dataTransfer.getData('text/plain');
    if (!droppedId || dropIndex === null) {
      setDropIndex(null);
      setDraggedId(null);
      return;
    }

    // Compute new order
    const currentIds = accessibleProjects.map((p) => p.id);
    const fromIndex = currentIds.indexOf(droppedId);
    if (fromIndex === -1) {
      setDropIndex(null);
      setDraggedId(null);
      return;
    }

    // Remove from old position and insert at new
    const reordered = [...currentIds];
    reordered.splice(fromIndex, 1);
    const insertAt = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
    reordered.splice(insertAt, 0, droppedId);

    // Append inaccessible projects at the end (preserve their relative order)
    const inaccessibleIds = inaccessibleProjects.map((p) => p.id);
    const allIds = [...reordered, ...inaccessibleIds];

    setDropIndex(null);
    setDraggedId(null);

    // Optimistic update: reorder projects in local state
    const projectMap = new Map(data.projects.map((p) => [p.id, p]));
    const reorderedProjects = allIds
      .map((id) => projectMap.get(id))
      .filter((p): p is typeof data.projects[number] => p !== undefined);
    setData((prev) => ({ ...prev, projects: reorderedProjects }));

    // Persist to server
    try {
      await fetch('/api/projects/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectIds: allIds }),
      });
    } catch (error) {
      console.error('Failed to persist project order:', error);
    }
  }, [dropIndex, accessibleProjects, inaccessibleProjects, data.projects]);

  const workingNow = data.projects.reduce((n, p) => n + (p.activeSessions ?? 0), 0);
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
                  {data.projects.length} project{data.projects.length !== 1 ? 's' : ''}, {data.totalBacklogItems} card{data.totalBacklogItems !== 1 ? 's' : ''} in backlog
                  {(data.totalUncommitted ?? 0) > 0 && `, ${data.totalUncommitted} uncommitted file${data.totalUncommitted !== 1 ? 's' : ''}`}.
                </span>
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
            <DashboardAttention needsYou={data.needsYou ?? []} upcoming={data.upcoming ?? []} />

            {/* Projects */}
            <section className="mb-10">
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-base font-semibold text-ink-1">Projects</h2>
                <span className="font-mono text-[12px] text-ink-3">{accessibleProjects.length}</span>
              </div>
              <div
                ref={gridRef}
                className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
                onDragOver={handleProjectDragOver}
                onDragLeave={handleProjectDragLeave}
                onDrop={handleProjectDrop}
              >
                {accessibleProjects.map((project, i) => (
                  <div key={project.id} data-project-card className="relative">
                    {draggedId && dropIndex === i && (
                      <div className="pointer-events-none absolute -left-2 top-0 bottom-0 w-0.5 rounded-full bg-accent" />
                    )}
                    <ProjectCard
                      project={project}
                      onDeleted={refreshData}
                      unseenCount={unseenCounts[project.id] ?? 0}
                      onUnseenClick={(anchor) => openNewOutput(anchor, project.id)}
                      shortcutKey={i < 10 ? (i === 9 ? 0 : i + 1) : undefined}
                      onDragStart={() => setDraggedId(project.id)}
                      onDragEnd={() => { setDraggedId(null); setDropIndex(null); }}
                    />
                  </div>
                ))}
                <div className="relative">
                  {draggedId && dropIndex === accessibleProjects.length && (
                    <div className="pointer-events-none absolute -left-2 top-0 bottom-0 w-0.5 rounded-full bg-accent" />
                  )}
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex h-full min-h-[140px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong p-4 text-[13px] text-ink-3 transition-colors hover:border-ink-3 hover:text-ink-1"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m7-7H5" />
                    </svg>
                    Add a project
                  </button>
                </div>
              </div>
            </section>

            {/* Inaccessible Projects */}
            {inaccessibleProjects.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-4 text-base font-semibold text-ink-3">
                  Unavailable
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {inaccessibleProjects.map((project) => (
                    <ProjectCard key={project.id} project={project} onDeleted={refreshData} unseenCount={unseenCounts[project.id] ?? 0} onUnseenClick={(anchor) => openNewOutput(anchor, project.id)} />
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
