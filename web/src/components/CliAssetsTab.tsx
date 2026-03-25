'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { usePolling } from '@/hooks/usePolling';
import type { PendingChange, AssetType, CliAssetsData, StoreData, ProviderId, UpdateEntry, UpdatesData } from '@/lib/types';
import { AssetMatrix } from './AssetMatrix';
import { StoreView } from './StoreView';
import { UpdatesView } from './UpdatesView';
import { AssetAssistant } from './AssetAssistant';

interface ProjectInfo {
  id: string;
  name: string;
}

interface CliAssetsResponse extends CliAssetsData {
  totalOutdated: number;
  projects: ProjectInfo[];
  storeData?: StoreData;
  activeProvider?: ProviderId;
}

type ActiveView = 'projects' | 'store' | 'updates';

interface FixTarget {
  assetName: string;
  assetType: AssetType;
  projectId?: string;
  provider?: ProviderId;
}

interface AssistantTarget {
  mode: 'create' | 'modify';
  provider?: ProviderId;
  assetType?: AssetType;
  assetName?: string;
}

interface ImportTarget {
  assetName: string;
  assetType: AssetType;
  sourceProjectId: string;
  provider: ProviderId;
}

const providerTabs: { id: ProviderId; label: string }[] = [
  { id: 'claude', label: 'Claude' },
  { id: 'agents', label: 'Agents' },
  { id: 'codex', label: 'Codex' },
  { id: 'gemini', label: 'Gemini' },
];

export function CliAssetsTab() {
  const [data, setData] = useState<CliAssetsResponse | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [fullSkillFolder, setFullSkillFolder] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [activeView, setActiveView] = useState<ActiveView>('projects');
  const [activeProvider, setActiveProvider] = useState<ProviderId>('claude');
  const [fixTarget, setFixTarget] = useState<FixTarget | null>(null);
  const [assistantTarget, setAssistantTarget] = useState<AssistantTarget | null>(null);
  const [importTarget, setImportTarget] = useState<ImportTarget | null>(null);
  const [updatesData, setUpdatesData] = useState<UpdatesData | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    skills: true,
    agents: true,
  });
  const [showIgnored, setShowIgnored] = useState(false);
  const [ignoredAssets, setIgnoredAssets] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = localStorage.getItem('cli-assets-ignored');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const fetchCliAssets = useCallback(async (signal: AbortSignal) => {
    try {
      // Fetch CLI assets + updates in parallel
      const [cliAssetsRes, updatesRes] = await Promise.all([
        fetch(`/api/cli-assets?provider=${activeProvider}`, { signal }),
        fetch('/api/cli-assets/updates', { signal }),
      ]);
      if (cliAssetsRes.ok) {
        const result: CliAssetsResponse = await cliAssetsRes.json();
        setData(result);
      }
      if (updatesRes.ok) {
        const result: UpdatesData = await updatesRes.json();
        setUpdatesData(result);
      }
    } catch {
      // ignore
    }
  }, [activeProvider]);

  // Initial fetch + poll every 10s for updates (fast enough to catch CLI agent changes)
  usePolling(fetchCliAssets, 10000);

  // Re-fetch immediately when provider changes
  const prevProviderRef = useRef(activeProvider);
  useEffect(() => {
    if (prevProviderRef.current !== activeProvider) {
      prevProviderRef.current = activeProvider;
      const controller = new AbortController();
      fetchCliAssets(controller.signal);
    }
  }, [activeProvider, fetchCliAssets]);

  async function refreshCliAssets() {
    setRefreshing(true);
    const controller = new AbortController();
    await fetchCliAssets(controller.signal);
    setRefreshing(false);
  }

  function handleQueueChange(change: PendingChange) {
    setPendingChanges(prev => {
      const existingIdx = prev.findIndex(c =>
        c.assetName === change.assetName &&
        c.assetType === change.assetType &&
        c.projectId === change.projectId
      );
      if (existingIdx >= 0) {
        return prev.filter((_, i) => i !== existingIdx);
      }
      // Tag with provider and source for store-based ops
      return [...prev, { ...change, provider: activeProvider, source: 'store' as const }];
    });
  }

  async function handleSync() {
    if (pendingChanges.length === 0) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/cli-assets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: pendingChanges, fullSkillFolder }),
      });
      if (res.ok) {
        setPendingChanges([]);
        await refreshCliAssets();
      }
    } catch {
      // ignore
    }
    setSyncing(false);
  }

  function handleImportToStore(assetName: string, assetType: AssetType, sourceProjectId: string) {
    // For non-skill types, import directly (single file, no ambiguity)
    if (assetType !== 'skill') {
      doImportToStore(assetName, assetType, sourceProjectId, false);
      return;
    }
    // For skills, show the import dialog so user can choose what to copy
    setImportTarget({ assetName, assetType, sourceProjectId, provider: activeProvider });
  }

  async function doImportToStore(assetName: string, assetType: AssetType, sourceProjectId: string, fullFolder: boolean) {
    try {
      const res = await fetch('/api/cli-assets/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: activeProvider,
          assetType,
          assetName,
          sourceProjectId,
          skillMainOnly: !fullFolder,
        }),
      });
      if (res.ok) {
        await refreshCliAssets();
      }
    } catch {
      // ignore
    }
  }

  function handleFix(assetName: string, assetType: AssetType, projectId?: string) {
    setFixTarget({ assetName, assetType, projectId, provider: activeProvider });
  }

  function handleAssistant(mode: 'create' | 'modify', assetName?: string, assetType?: AssetType) {
    setAssistantTarget({ mode, provider: activeProvider, assetType, assetName });
  }

  function ignoreAssetKey(name: string, type: AssetType) {
    return `${activeProvider}:${type}:${name}`;
  }

  function handleIgnore(assetName: string, assetType: AssetType) {
    setIgnoredAssets(prev => {
      const next = new Set(prev);
      next.add(ignoreAssetKey(assetName, assetType));
      localStorage.setItem('cli-assets-ignored', JSON.stringify([...next]));
      return next;
    });
  }

  function handleUnignore(assetName: string, assetType: AssetType) {
    setIgnoredAssets(prev => {
      const next = new Set(prev);
      next.delete(ignoreAssetKey(assetName, assetType));
      localStorage.setItem('cli-assets-ignored', JSON.stringify([...next]));
      return next;
    });
  }

  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-void-300 border-t-neon-blue-400" />
        <p className="text-sm text-void-400 dark:text-void-500">Scanning assets across projects, this can take a few seconds...</p>
      </div>
    );
  }

  // All projects including SlyCode (store-as-master mode)
  const projects = data.projects;

  // Store stats for the tab badge
  const storeAssetCount = data.storeData
    ? data.storeData.skills.length + data.storeData.agents.length + data.storeData.mcp.length
    : 0;

  const sections = [
    { key: 'skills' as const, label: 'Skills', rows: data.skills },
    { key: 'agents' as const, label: 'Agents', rows: data.agents },
  ];

  return (
    <div className="space-y-4">
      {/* Sticky header: view toggle + provider tabs + refresh */}
      <div className="sticky top-0 z-30 -mx-4 px-4 pb-2 pt-2 bg-void-50 dark:bg-void-950 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex items-center gap-4">
          <div className="flex gap-1 rounded-lg border border-void-200 bg-void-50 p-1 dark:border-void-700 dark:bg-void-900">
            <button
              onClick={() => setActiveView('projects')}
              className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                activeView === 'projects'
                  ? 'bg-white text-void-900 shadow-sm dark:bg-void-800 dark:text-void-100'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200'
              }`}
            >
              Project Assignment
              {data.totalOutdated > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                  {data.totalOutdated}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveView('store')}
              className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                activeView === 'store'
                  ? 'bg-white text-void-900 shadow-sm dark:bg-void-800 dark:text-void-100'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200'
              }`}
            >
              Asset Store
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                activeView === 'store'
                  ? 'bg-void-100 text-void-600 dark:bg-void-700 dark:text-void-300'
                  : 'bg-void-200/50 text-void-400 dark:bg-void-800 dark:text-void-500'
              }`}>
                {storeAssetCount}
              </span>
            </button>
            <button
              onClick={() => setActiveView('updates')}
              className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                activeView === 'updates'
                  ? 'bg-white text-void-900 shadow-sm dark:bg-void-800 dark:text-void-100'
                  : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200'
              }`}
            >
              Updates
              {(updatesData?.totalAvailable ?? 0) > 0 && (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                  updatesData?.entries.some(e => e.status === 'new')
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                }`}>
                  {updatesData!.totalAvailable}
                </span>
              )}
            </button>
          </div>

          {/* Provider sub-tabs (Project Assignment only — Store and Updates are provider-agnostic) */}
          {activeView === 'projects' && (
            <div className="flex gap-1 rounded-lg border border-void-200 bg-void-50 p-1 dark:border-void-700 dark:bg-void-900">
              {providerTabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveProvider(tab.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    activeProvider === tab.id
                      ? 'bg-white text-void-900 shadow-sm dark:bg-void-800 dark:text-void-100'
                      : 'text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* New Asset button (Store view) */}
          {activeView === 'store' && (
            <button
              onClick={() => handleAssistant('create')}
              className="flex items-center gap-1.5 rounded-md border border-neon-blue-400/40 bg-neon-blue-400/15 px-3 py-1.5 text-sm font-medium text-neon-blue-400 hover:bg-neon-blue-400/25 whitespace-nowrap"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New
            </button>
          )}

          <button
            onClick={refreshCliAssets}
            disabled={refreshing}
            title="Refresh assets"
            className="rounded-md border border-void-200 bg-void-50 p-1.5 text-void-500 transition-colors hover:bg-void-100 hover:text-void-700 dark:border-void-700 dark:bg-void-900 dark:hover:bg-void-800 dark:hover:text-void-200 disabled:opacity-50"
          >
            <svg
              className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Tab content — min-height prevents scroll jump when switching to shorter views */}
      <div className="min-h-[70vh]">

      {/* Sub-view description */}
      <p className="mb-3 text-xs text-void-400 dark:text-void-500">
        {activeView === 'projects' && 'Assign assets from the store to individual projects and keep them in sync.'}
        {activeView === 'store' && 'The canonical source for each asset. Deploy to projects across providers like Claude, Codex, and Gemini.'}
        {activeView === 'updates' && 'SlyCode updates land here. Review what changed and choose to accept or skip each one.'}
      </p>

      {/* Agents provider info */}
      {activeProvider === 'agents' && (
        <div className="mx-1 rounded-md border border-void-200 bg-void-50 px-3 py-2 text-xs text-void-500 dark:border-void-700 dark:bg-void-900 dark:text-void-400">
          <strong className="text-void-700 dark:text-void-300">Agents</strong> deploys to <code className="rounded bg-void-200 px-1 dark:bg-void-800">.agents/skills/</code> — the universal cross-tool directory read by both Codex CLI and Gemini CLI. Use this for skills that should work across tools without provider-specific overrides.
        </div>
      )}

      {/* Updates view */}
      {activeView === 'updates' && (
        <UpdatesView
          entries={updatesData?.entries ?? []}
          onAccept={async (entry: UpdateEntry) => {
            await fetch('/api/cli-assets/updates', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                assetType: entry.assetType,
                assetName: entry.name,
              }),
            });
            // Don't refresh yet — let the post-accept push prompt show first
          }}
          onDismiss={(entry: UpdateEntry) => {
            fetch('/api/cli-assets/updates', {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                assetType: entry.assetType,
                assetName: entry.name,
                contentHash: entry.contentHash,
              }),
            }).then(() => {
              // Optimistic remove from local state
              setUpdatesData(prev => {
                if (!prev) return prev;
                const filtered = prev.entries.filter(e => e.name !== entry.name);
                return { entries: filtered, totalAvailable: filtered.length };
              });
            });
          }}
          onPushToProjects={async (entry: UpdateEntry, fullSkillFolder: boolean) => {
            // Push the accepted asset from store → all projects that already have it
            // Fetch each provider's matrix to find every project+provider where it's installed
            const providers: ProviderId[] = ['claude', 'agents', 'codex', 'gemini'];
            const changes: PendingChange[] = [];

            const matrices = await Promise.all(
              providers.map(async (prov) => {
                try {
                  const res = await fetch(`/api/cli-assets?provider=${prov}`);
                  if (!res.ok) return { provider: prov, rows: [] as typeof data.skills };
                  const result: CliAssetsResponse = await res.json();
                  return { provider: prov, rows: [...(result.skills ?? []), ...(result.agents ?? [])] };
                } catch { return { provider: prov, rows: [] as typeof data.skills }; }
              })
            );

            for (const { provider, rows } of matrices) {
              const matchingRow = rows.find(r => r.name === entry.name && r.type === entry.assetType);
              if (!matchingRow) continue;
              for (const cell of matchingRow.cells) {
                if (cell.status !== 'missing') {
                  changes.push({
                    assetName: entry.name,
                    assetType: entry.assetType,
                    projectId: cell.projectId,
                    action: 'deploy' as const,
                    provider,
                    source: 'store' as const,
                  });
                }
              }
            }

            if (changes.length > 0) {
              await fetch('/api/cli-assets/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ changes, fullSkillFolder }),
              });
            }
            refreshCliAssets();
          }}
          onPushDeclined={() => refreshCliAssets()}
        />
      )}

      {/* Store view */}
      {activeView === 'store' && data.storeData && (
        <StoreView
          data={data.storeData}
          onFix={handleFix}
          onAssistant={handleAssistant}
          onRefresh={refreshCliAssets}
        />
      )}

      {/* Projects view */}
      {activeView === 'projects' && (
        <div className="space-y-4">

          {sections.map(({ key, label, rows }) => (
            <div key={key} className="rounded-lg border border-void-200 bg-white shadow-(--shadow-card) dark:border-void-700 dark:bg-void-850">
              <button
                onClick={() => toggleSection(key)}
                className="flex w-full items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-void-900 dark:text-void-100">
                    {label}
                  </h3>
                  <span className="rounded-full bg-void-100 px-2 py-0.5 text-xs text-void-600 dark:bg-void-700 dark:text-void-300">
                    {rows.length}
                  </span>
                </div>
                <svg
                  className={`h-4 w-4 text-void-400 transition-transform ${expandedSections[key] ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {expandedSections[key] && (
                <div className="border-t border-void-100 dark:border-void-700">
                  <AssetMatrix
                    rows={rows}
                    projects={projects}
                    pendingChanges={pendingChanges}
                    onQueueChange={handleQueueChange}
                    onImport={handleImportToStore}
                    onFix={handleFix}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Non-imported assets (in projects but not in store) */}
          {(() => {
            const visibleRows = data.nonImported.filter(row =>
              !ignoredAssets.has(ignoreAssetKey(row.name, row.type))
            );
            const ignoredRows = data.nonImported.filter(row =>
              ignoredAssets.has(ignoreAssetKey(row.name, row.type))
            );
            const displayRows = showIgnored ? data.nonImported : visibleRows;

            if (data.nonImported.length === 0) return null;

            return (
              <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 px-4 py-3">
                  <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                    Not in Asset Store
                  </h3>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {visibleRows.length}
                  </span>
                  <div className="flex-1" />
                  {ignoredRows.length > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-void-500 dark:text-void-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showIgnored}
                        onChange={(e) => setShowIgnored(e.target.checked)}
                        className="rounded border-void-400"
                      />
                      Show ignored ({ignoredRows.length})
                    </label>
                  )}
                </div>
                {displayRows.length > 0 && (
                  <div className="border-t border-amber-200 dark:border-amber-800/50">
                    <AssetMatrix
                      rows={displayRows}
                      projects={projects}
                      pendingChanges={pendingChanges}
                      onQueueChange={handleQueueChange}
                      onImport={handleImportToStore}
                      onFix={handleFix}
                      ignoredAssets={ignoredAssets}
                      ignoreKeyFn={ignoreAssetKey}
                      onIgnore={handleIgnore}
                      onUnignore={handleUnignore}
                    />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      </div>{/* end min-height wrapper */}

      {/* Pending changes bar */}
      {pendingChanges.length > 0 && (
        <div className="fixed bottom-0 left-4 right-72 z-40 flex h-12 items-center justify-between rounded-t-lg border border-neon-blue-400/30 bg-neon-blue-50 px-4 shadow-(--shadow-card) dark:border-neon-blue-400/30 dark:bg-void-850">
          <span className="text-sm font-medium text-neon-blue-700 dark:text-neon-blue-300">
            {pendingChanges.length} pending change{pendingChanges.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-3">
            {pendingChanges.some(c => c.assetType === 'skill' && c.action === 'deploy') && (
              <label className="flex items-center gap-1.5 text-xs text-void-600 dark:text-void-400">
                <input
                  type="checkbox"
                  checked={fullSkillFolder}
                  onChange={e => setFullSkillFolder(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-void-300 dark:border-void-600"
                />
                Copy entire skill folder
              </label>
            )}
            <button
              onClick={() => setPendingChanges([])}
              className="rounded px-4 py-1.5 text-sm text-void-600 hover:text-void-900 dark:text-void-400 dark:hover:text-void-200"
            >
              Cancel
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded bg-neon-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-neon-blue-500 disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Apply Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Fix compliance modal */}
      {fixTarget && (
        <ComplianceFixModal
          assetName={fixTarget.assetName}
          assetType={fixTarget.assetType}
          provider={fixTarget.provider || 'claude'}
          projectId={fixTarget.projectId}
          onClose={() => setFixTarget(null)}
        />
      )}

      {/* Asset Assistant */}
      {assistantTarget && (
        <AssetAssistant
          mode={assistantTarget.mode}
          provider={assistantTarget.provider}
          assetType={assistantTarget.assetType}
          assetName={assistantTarget.assetName}
          onClose={() => setAssistantTarget(null)}
        />
      )}

      {/* Import to Store dialog */}
      {importTarget && (
        <ImportDialog
          target={importTarget}
          onConfirm={async (fullFolder) => {
            const { assetName, assetType, sourceProjectId } = importTarget;
            setImportTarget(null);
            await doImportToStore(assetName, assetType, sourceProjectId, fullFolder);
          }}
          onClose={() => setImportTarget(null)}
        />
      )}
    </div>
  );
}

/**
 * Import Dialog — shows file listing and lets user choose SKILL.md only vs full folder.
 */
function ImportDialog({
  target,
  onConfirm,
  onClose,
}: {
  target: ImportTarget;
  onConfirm: (fullFolder: boolean) => void;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams({
      provider: target.provider,
      assetType: target.assetType,
      assetName: target.assetName,
      sourceProjectId: target.sourceProjectId,
    });
    fetch(`/api/cli-assets/store/preview?${params}`)
      .then(r => r.json())
      .then(data => {
        setFiles(data.files ?? []);
        setLoading(false);
      })
      .catch(() => {
        setFiles([]);
        setLoading(false);
      });
  }, [target]);

  const hasExtraFiles = files && files.length > 1;
  const skillMdOnly = files?.filter(f => f === 'SKILL.md') ?? [];
  const extraFiles = files?.filter(f => f !== 'SKILL.md') ?? [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white p-6 shadow-(--shadow-overlay) dark:bg-void-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-900/30">
            <svg className="h-5 w-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-void-900 dark:text-void-100">
              Import to Store
            </h3>
            <p className="text-sm text-void-500 dark:text-void-400">
              {target.assetName}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-void-300 border-t-purple-500" />
          </div>
        ) : (
          <>
            {/* File listing */}
            <div className="mb-4 rounded-lg border border-void-200 bg-void-50 dark:border-void-700 dark:bg-void-900">
              <div className="px-3 py-2 text-xs font-medium text-void-500 dark:text-void-400 border-b border-void-200 dark:border-void-700">
                Files in source ({files?.length ?? 0})
              </div>
              <div className="max-h-48 overflow-y-auto p-2">
                {files?.map(file => (
                  <div
                    key={file}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs font-mono ${
                      file === 'SKILL.md'
                        ? 'text-purple-700 dark:text-purple-300 font-semibold'
                        : 'text-void-500 dark:text-void-400'
                    }`}
                  >
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      {file === 'SKILL.md' ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      )}
                    </svg>
                    {file}
                  </div>
                ))}
              </div>
            </div>

            {hasExtraFiles && (
              <p className="mb-4 text-xs text-void-500 dark:text-void-400">
                This skill has {extraFiles.length} supporting file{extraFiles.length !== 1 ? 's' : ''} beyond SKILL.md.
                These may be project-specific (e.g. context-priming area references) and importing them would overwrite the store copies.
              </p>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => onConfirm(false)}
                className="flex items-center justify-between rounded-lg border border-purple-300 bg-purple-50 px-4 py-3 text-left transition-colors hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/20 dark:hover:bg-purple-900/40"
              >
                <div>
                  <div className="text-sm font-medium text-purple-700 dark:text-purple-300">
                    SKILL.md only
                  </div>
                  <div className="text-xs text-purple-500 dark:text-purple-400">
                    Import only the skill definition — leave supporting files unchanged
                  </div>
                </div>
                {!hasExtraFiles && (
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:bg-purple-900/40 dark:text-purple-300">
                    Only file
                  </span>
                )}
              </button>

              {hasExtraFiles && (
                <button
                  onClick={() => onConfirm(true)}
                  className="flex items-center justify-between rounded-lg border border-void-200 bg-void-50 px-4 py-3 text-left transition-colors hover:bg-void-100 dark:border-void-700 dark:bg-void-900 dark:hover:bg-void-800"
                >
                  <div>
                    <div className="text-sm font-medium text-void-700 dark:text-void-300">
                      Full folder
                    </div>
                    <div className="text-xs text-void-500 dark:text-void-400">
                      Import all {files?.length} files — overwrites existing store copies
                    </div>
                  </div>
                </button>
              )}

              <button
                onClick={onClose}
                className="mt-1 rounded-lg px-4 py-2 text-sm font-medium text-void-500 hover:text-void-700 dark:text-void-400 dark:hover:text-void-200"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Compliance Fix Modal — generates a prompt to fix non-compliant asset frontmatter.
 */
function ComplianceFixModal({
  assetName,
  assetType,
  provider,
  projectId,
  onClose,
}: {
  assetName: string;
  assetType: AssetType;
  provider: ProviderId;
  projectId?: string;
  onClose: () => void;
}) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function generateFixPrompt() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/cli-assets/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetName, assetType, provider, projectId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to generate fix prompt');
        return;
      }
      const data = await res.json();
      setPrompt(data.prompt);
    } catch {
      setError('Failed to generate fix prompt');
    }
    setLoading(false);
  }

  async function handleCopy() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  }

  function handleRunInTerminal() {
    if (!prompt) return;
    import('@/lib/terminal-events').then(({ pushToTerminal }) => {
      pushToTerminal(prompt);
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-void-700 bg-void-850 shadow-(--shadow-overlay)">
        <div className="flex items-center justify-between border-b border-void-700 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-void-100">Fix Asset Compliance</h3>
            <p className="mt-0.5 text-sm text-void-400">
              {assetName} ({assetType}) — missing or invalid frontmatter
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-void-400 hover:bg-void-800 hover:text-void-200">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!prompt && !loading && !error && (
            <div className="space-y-4">
              <p className="text-sm text-void-300">
                Generate a prompt that instructs an LLM to add proper frontmatter fields
                (name, version, updated, description, provider) to this asset.
              </p>
              <button
                onClick={generateFixPrompt}
                className="rounded-md border border-amber-400/40 bg-amber-400/15 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-400/25"
              >
                Generate Fix Prompt
              </button>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-void-600 border-t-amber-400" />
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-400">{error}</div>
          )}
          {prompt && (
            <div className="space-y-3">
              <p className="text-sm text-void-300">Fix prompt ready:</p>
              <textarea
                readOnly
                value={prompt}
                className="h-48 w-full rounded-md border border-void-700 bg-void-900 p-3 font-mono text-xs text-void-300 focus:outline-none"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-void-700 px-5 py-3">
          <button onClick={onClose} className="rounded px-4 py-1.5 text-sm text-void-400 hover:text-void-200">
            Close
          </button>
          {prompt && (
            <>
              <button
                onClick={handleCopy}
                className={`rounded px-3 py-1.5 text-sm font-medium ${
                  copied ? 'bg-green-400/20 text-green-400' : 'bg-void-800 text-void-300 hover:bg-void-700'
                }`}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                onClick={handleRunInTerminal}
                className="rounded bg-neon-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-neon-blue-500"
              >
                Run in Terminal
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
