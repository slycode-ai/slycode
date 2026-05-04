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
import { CliAssetsTab } from './CliAssetsTab';
import { ActivityFeed } from './ActivityFeed';
import { ThemeToggle } from './ThemeToggle';
import { VersionUpdateToast } from './VersionUpdateToast';
import { sumProjectActivityCounts } from '@/lib/session-keys';
import { ChangelogModal } from './ChangelogModal';
import { useVoice } from '@/contexts/VoiceContext';

interface DashboardProps {
  data: DashboardData;
}

type Tab = 'projects' | 'cli-assets';

export function Dashboard({ data: initialData }: DashboardProps) {
  const [data, setData] = useState<DashboardData>(initialData);
  const [isLive, setIsLive] = useState(false);
  const connectionIdRef = useRef<string | null>(null);
  const [isGlobalActive, setIsGlobalActive] = useState(false);
  const voice = useVoice();
  const [bridgeCounts, setBridgeCounts] = useState<Record<string, number> | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('projects');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [slycodeVersion, setSlycodeVersion] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);

  // Auto-open the global terminal when arriving via /global or /?openGlobal=1.
  // Strip the param after consuming so a refresh doesn't re-trigger.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const openGlobalRequested = searchParams.get('openGlobal') === '1';
  const consumedOpenGlobalRef = useRef(false);

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

  // Stat badge helper
  function statBadge(value: number | undefined, threshold: number) {
    if (value === undefined) return 'text-void-950 dark:text-void-100';
    return value > threshold
      ? 'text-neon-orange-500 dark:text-neon-orange-400'
      : 'text-void-950 dark:text-void-100';
  }

  return (
    <div className="relative min-h-screen bg-void-50 dark:bg-void-950">
      {/* Subtle radial gradient overlay (dark mode only) */}
      <div
        className="pointer-events-none fixed inset-0 hidden dark:block"
        style={{
          background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(0,191,255,0.04) 0%, rgba(255,140,0,0.02) 30%, transparent 70%)',
        }}
      />

      {/* Connection status + theme toggle + version update toast */}
      <ConnectionStatusIndicator position="top-right" />
      <VersionUpdateToast />
      <div className="absolute right-4 top-4 z-10">
        <ThemeToggle />
      </div>

      {/* Hero Section */}
      <div className="relative flex flex-col items-center pb-2 pt-10">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/slycode_light.webp"
          alt="SlyCode"
          className="logo-breathe h-auto w-[200px] mix-blend-multiply dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/slycode.webp"
          alt="SlyCode"
          className="logo-breathe hidden h-auto w-[200px] mix-blend-lighten dark:block"
        />
        <p
          className="mt-1 text-xs font-medium uppercase tracking-[0.3em] text-neon-blue-500 dark:text-neon-blue-400/70"
          style={{ textShadow: '0 0 8px rgba(0,191,255,0.3)' }}
        >
          Code Den
        </p>

        {/* Search bar */}
        <div className="mx-auto mt-6 flex w-full max-w-lg items-center gap-3">
          <SearchBar
            onResultClick={(result) => {
              window.location.href = `/project/${result.projectId}?card=${result.cardId}`;
            }}
          />
          {isLive && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-neon-blue-500 dark:text-neon-blue-400">
              <span
                className="h-2 w-2 rounded-full bg-neon-blue-400 animate-pulse"
                style={{ boxShadow: '0 0 6px rgba(0,191,255,0.6)' }}
              />
              Live
            </span>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="border-b border-void-100 dark:border-void-700">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <button
              onClick={() => setActiveTab('projects')}
              className="rounded-xl border border-void-200 bg-white p-4 text-left shadow-(--shadow-card) transition-all hover:border-neon-blue-400/30 hover:shadow-[0_8px_30px_rgba(0,0,0,0.18)] dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.7)] dark:border-void-700 dark:bg-void-850 dark:hover:border-neon-blue-400/25"
            >
              <p className="text-sm text-void-400">Code Den</p>
              <p className="text-2xl font-bold text-void-950 dark:text-void-100">
                {data.projects.length}
              </p>
            </button>
            <div className="rounded-xl border border-void-200 bg-white p-4 shadow-(--shadow-card) dark:border-void-700 dark:bg-void-850">
              <p className="text-sm text-void-400">Backlog Items</p>
              <p className={`text-2xl font-bold ${statBadge(data.totalBacklogItems, 20)}`}>
                {data.totalBacklogItems}
              </p>
            </div>
            <button
              onClick={() => setActiveTab('cli-assets')}
              className="rounded-xl border border-void-200 bg-white p-4 text-left shadow-(--shadow-card) transition-all hover:border-neon-blue-400/30 hover:shadow-[0_8px_30px_rgba(0,0,0,0.18)] dark:hover:shadow-[0_8px_30px_rgba(0,0,0,0.7)] dark:border-void-700 dark:bg-void-850 dark:hover:border-neon-blue-400/25"
            >
              <p className="text-sm text-void-400">Outdated Assets</p>
              <p className={`text-2xl font-bold ${statBadge(data.totalOutdatedAssets, 0)}`}>
                {data.totalOutdatedAssets ?? 0}
              </p>
            </button>
            <div className="rounded-xl border border-void-200 bg-white p-4 shadow-(--shadow-card) dark:border-void-700 dark:bg-void-850">
              <p className="text-sm text-void-400">Uncommitted</p>
              <p className={`text-2xl font-bold ${statBadge(data.totalUncommitted, 0)}`}>
                {data.totalUncommitted ?? 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-void-100 dark:border-void-700">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <nav className="flex gap-6">
            <button
              onClick={() => setActiveTab('projects')}
              className={`border-b-2 py-3 text-sm font-medium transition-colors ${
                activeTab === 'projects'
                  ? 'border-neon-blue-400 text-neon-blue-500 dark:text-neon-blue-400'
                  : 'border-transparent text-void-500 hover:text-void-300 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              Code Den
            </button>
            <button
              onClick={() => setActiveTab('cli-assets')}
              className={`flex items-center gap-2 border-b-2 py-3 text-sm font-medium transition-colors ${
                activeTab === 'cli-assets'
                  ? 'border-neon-blue-400 text-neon-blue-500 dark:text-neon-blue-400'
                  : 'border-transparent text-void-500 hover:text-void-300 dark:text-void-400 dark:hover:text-void-300'
              }`}
            >
              CLI Assets
              {(data.totalOutdatedAssets ?? 0) > 0 && (
                <span className="rounded-full border border-neon-orange-400/20 bg-neon-orange-400/10 px-2 py-0.5 text-xs font-medium text-neon-orange-500 dark:text-neon-orange-400">
                  {data.totalOutdatedAssets}
                </span>
              )}
            </button>
          </nav>
        </div>
      </div>

      {/* Main Content */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        {activeTab === 'projects' ? (
          <>
            <p className="mb-6 text-sm text-void-400 dark:text-void-500">
              Your registered projects and their kanban boards
            </p>
            {/* Projects */}
            <section className="mb-8">
              <h2 className="mb-4 text-lg font-semibold text-void-950 dark:text-void-100">
                Projects
              </h2>
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
                      <div className="pointer-events-none absolute -left-1 top-0 bottom-0 w-1 rounded-full bg-neon-blue-400 shadow-[0_0_8px_rgba(0,191,255,0.5)]" />
                    )}
                    <ProjectCard
                      project={project}
                      onDeleted={refreshData}
                      shortcutKey={i < 10 ? (i === 9 ? 0 : i + 1) : undefined}
                      onDragStart={() => setDraggedId(project.id)}
                      onDragEnd={() => { setDraggedId(null); setDropIndex(null); }}
                    />
                  </div>
                ))}
                <div className="relative">
                  {draggedId && dropIndex === accessibleProjects.length && (
                    <div className="pointer-events-none absolute -left-1 top-0 bottom-0 w-1 rounded-full bg-neon-blue-400 shadow-[0_0_8px_rgba(0,191,255,0.5)]" />
                  )}
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="flex min-h-[120px] w-full items-center justify-center rounded-xl border-2 border-dashed border-void-200 p-4 transition-all hover:border-neon-blue-400/30 dark:border-void-700 dark:hover:border-neon-blue-400/30"
                  >
                    <div className="text-center">
                      <span className="text-3xl text-void-400 dark:text-void-500">+</span>
                      <p className="mt-1 text-sm text-void-500 dark:text-void-400">Add Project</p>
                    </div>
                  </button>
                </div>
              </div>
            </section>

            {/* Inaccessible Projects */}
            {inaccessibleProjects.length > 0 && (
              <section className="mb-8">
                <h2 className="mb-4 text-lg font-semibold text-void-500 dark:text-void-400">
                  Unavailable
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {inaccessibleProjects.map((project) => (
                    <ProjectCard key={project.id} project={project} onDeleted={refreshData} />
                  ))}
                </div>
              </section>
            )}

            {/* Activity Feed */}
            <section>
              <ActivityFeed />
            </section>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-void-400 dark:text-void-500">
              Reusable skills, agents, and configs — manage and deploy across projects
            </p>
            <CliAssetsTab />
          </>
        )}

        {/* Last Refresh + Copyright */}
        <footer className="mt-8 text-center text-sm text-void-400 dark:text-void-600">
          <p>Last refresh: {new Date(data.lastRefresh).toLocaleString()}</p>
          <p className="mt-2 text-xs text-void-500 dark:text-void-400">
            &copy; 2026 SlyCode (<a href="https://slycode.ai" target="_blank" rel="noopener noreferrer" className="hover:text-neon-blue-500 dark:hover:text-neon-blue-400 transition-colors">slycode.ai</a>). All rights reserved.
            {slycodeVersion && <span className="ml-2 text-void-400 dark:text-void-500">v{slycodeVersion}</span>}
            <button
              type="button"
              onClick={() => setShowChangelog(true)}
              className="ml-2 text-void-400 hover:text-neon-blue-500 dark:text-void-500 dark:hover:text-neon-blue-400 transition-colors underline-offset-2 hover:underline"
            >
              Changelog
            </button>
          </p>
        </footer>
      </main>

      <AddProjectModal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        onCreated={refreshData}
      />

      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}

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
