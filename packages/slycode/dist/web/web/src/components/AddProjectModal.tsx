'use client';

import { useState, useEffect } from 'react';

// ============================================================================
// Types
// ============================================================================

interface AnalysisItem {
  path: string;
  status: 'present' | 'missing';
  localVersion?: string;
  masterVersion?: string;
  match?: boolean;
  details?: { count?: number };
  group?: string;
  provider?: string;
  essential?: boolean;
}

interface AnalysisGroup {
  id: string;
  name: string;
  description: string;
  items: AnalysisItem[];
}

interface AnalysisReport {
  exists: boolean;
  empty: boolean;
  items: AnalysisItem[];
  groups: AnalysisGroup[];
  providers: string[];
}

interface ScaffoldResult {
  action: string;
  path: string;
  group?: string;
  provider?: string;
  count?: number;
  seedCards?: number;
  items?: string[];
  error?: string;
}

interface AddProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

type Phase = 'details' | 'providers' | 'review' | 'creating' | 'summary';

// ============================================================================
// Constants
// ============================================================================

const PROVIDER_INFO = [
  {
    id: 'claude',
    name: 'Claude',
    filename: 'CLAUDE.md',
    description: 'Anthropic Claude Code',
    color: 'neon-blue',
  },
  {
    id: 'codex',
    name: 'Codex',
    filename: 'AGENTS.md',
    description: 'OpenAI Codex CLI',
    color: 'emerald',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    filename: 'GEMINI.md',
    description: 'Google Gemini CLI',
    color: 'amber',
  },
];

// ============================================================================
// Component
// ============================================================================

export function AddProjectModal({ open, onClose, onCreated }: AddProjectModalProps) {
  const [phase, setPhase] = useState<Phase>('details');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectPath, setProjectPath] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [error, setError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisReport | null>(null);
  const [itemActions, setItemActions] = useState<Record<string, string>>({});
  const [selectedProviders, setSelectedProviders] = useState<string[]>(['claude']);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [createResult, setCreateResult] = useState<{ project: unknown; scaffold: { results: ScaffoldResult[] } } | null>(null);

  function reset() {
    setPhase('details');
    setName('');
    setDescription('');
    setProjectPath('');
    setTagsInput('');
    setError('');
    setAnalyzing(false);
    setAnalysis(null);
    setItemActions({});
    setSelectedProviders(['claude']);
    setExpandedGroups({});
    setCreateResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  // ---- Phase transitions ----

  function handleDetailsNext() {
    if (!name.trim() || !projectPath.trim()) {
      setError('Name and path are required');
      return;
    }
    setError('');
    setPhase('providers');
  }

  function toggleProvider(providerId: string) {
    setSelectedProviders((prev) => {
      if (prev.includes(providerId)) {
        if (prev.length === 1) return prev; // Must have at least one
        return prev.filter((p) => p !== providerId);
      }
      return [...prev, providerId];
    });
  }

  async function handleProvidersNext() {
    if (selectedProviders.length === 0) {
      setError('Select at least one provider');
      return;
    }
    setError('');
    setAnalyzing(true);

    try {
      const res = await fetch('/api/projects/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: projectPath.trim(),
          providers: selectedProviders,
        }),
      });
      const report = await res.json();
      if (!res.ok) {
        setError(report.error || 'Analysis failed');
        setAnalyzing(false);
        return;
      }
      setAnalysis(report);

      // Pre-populate actions: only missing items get 'create', everything present is 'skip'
      // Existing skills are never overwritten here — updates go through CLI assets management
      const actions: Record<string, string> = {};
      for (const item of report.items) {
        if (item.status === 'missing') {
          actions[item.path] = 'create';
        } else {
          actions[item.path] = 'skip';
        }
      }
      setItemActions(actions);

      // Set expand state: for existing projects, expand groups that have missing items
      const isNew = !report.exists || report.empty;
      const expanded: Record<string, boolean> = {};
      for (const group of report.groups) {
        const hasMissing = group.items.some(
          (i: AnalysisItem) => i.status === 'missing'
        );
        expanded[group.id] = isNew ? false : hasMissing;
      }
      setExpandedGroups(expanded);

      setPhase('review');
    } catch {
      setError('Failed to analyze directory');
    }
    setAnalyzing(false);
  }

  async function handleCreate() {
    setPhase('creating');
    setError('');

    try {
      const tags = tagsInput
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          path: projectPath.trim(),
          tags,
          providers: selectedProviders,
          scaffoldConfig: { items: itemActions },
        }),
      });

      const result = await res.json();
      if (!res.ok) {
        setError(result.error || 'Failed to create project');
        setPhase('review');
        return;
      }

      setCreateResult(result);
      setPhase('summary');
      onCreated();
    } catch {
      setError('Failed to create project');
      setPhase('review');
    }
  }

  function toggleAction(itemPath: string) {
    setItemActions((prev) => {
      const current = prev[itemPath];
      if (current === 'skip') return { ...prev, [itemPath]: 'create' };
      if (current === 'create') return { ...prev, [itemPath]: 'skip' };
      return prev;
    });
  }

  function toggleGroupExpand(groupId: string) {
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }

  function toggleGroupAction(groupId: string) {
    if (!analysis) return;
    const group = analysis.groups.find((g) => g.id === groupId);
    if (!group) return;

    // Only missing items are actionable — existing items are never overwritten
    const actionableItems = group.items.filter(
      (i) => i.status === 'missing'
    );
    if (actionableItems.length === 0) return;

    // If all actionable items are being created, skip them all. Otherwise, create them all.
    const allActive = actionableItems.every(
      (i) => itemActions[i.path] === 'create'
    );
    setItemActions((prev) => {
      const next = { ...prev };
      for (const item of actionableItems) {
        next[item.path] = allActive ? 'skip' : 'create';
      }
      return next;
    });
  }

  // Escape key handler
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase !== 'creating') {
        e.stopImmediatePropagation();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const isNewDir = analysis && (!analysis.exists || analysis.empty);

  // ---- Phase indicator ----
  const phases: { key: Phase; label: string }[] = [
    { key: 'details', label: 'Details' },
    { key: 'providers', label: 'Providers' },
    { key: 'review', label: 'Review' },
  ];
  const currentPhaseIdx = phases.findIndex((p) => p.key === phase);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg border border-void-700 bg-void-850 p-6 shadow-(--shadow-overlay)">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-void-100">
            {phase === 'summary' ? 'Project Created' : 'Add Project'}
          </h2>
          <button
            onClick={handleClose}
            className="rounded p-1 text-void-400 hover:bg-void-800 hover:text-void-200"
          >
            &times;
          </button>
        </div>

        {/* Phase indicator (for details/providers/review) */}
        {currentPhaseIdx >= 0 && (
          <div className="mb-4 flex items-center gap-2">
            {phases.map((p, idx) => (
              <div key={p.key} className="flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
                    idx <= currentPhaseIdx
                      ? 'bg-blue-600 text-white'
                      : 'bg-void-700 text-void-500'
                  }`}
                >
                  {idx + 1}
                </div>
                <span
                  className={`text-xs ${
                    idx <= currentPhaseIdx ? 'text-void-200' : 'text-void-500'
                  }`}
                >
                  {p.label}
                </span>
                {idx < phases.length - 1 && (
                  <div className={`h-px w-4 ${idx < currentPhaseIdx ? 'bg-blue-600' : 'bg-void-700'}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mb-4 rounded bg-red-900/50 p-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* ================================================================ */}
        {/* Phase 1: Details                                                 */}
        {/* ================================================================ */}
        {phase === 'details' && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-void-300">
                Project Name <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Project"
                className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 text-sm text-void-100 placeholder-void-500 focus:border-neon-blue-400 focus:outline-none"
                data-voice-target
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-void-300">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about?"
                rows={2}
                className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 text-sm text-void-100 placeholder-void-500 focus:border-neon-blue-400 focus:outline-none"
                data-voice-target
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-void-300">
                Directory Path <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="/home/user/projects/my-project"
                className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 font-mono text-sm text-void-100 placeholder-void-500 focus:border-neon-blue-400 focus:outline-none"
                data-voice-target
              />
              <p className="mt-1 text-xs text-void-500">
                Absolute path. Will be created if it doesn&apos;t exist.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-void-300">
                Tags
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="python, web, api (comma-separated)"
                className="w-full rounded border border-void-700 bg-void-800 px-3 py-2 text-sm text-void-100 placeholder-void-500 focus:border-neon-blue-400 focus:outline-none"
                data-voice-target
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={handleClose}
                className="rounded px-4 py-2 text-sm text-void-400 hover:text-void-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDetailsNext}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* Phase 2: Provider Selection                                      */}
        {/* ================================================================ */}
        {phase === 'providers' && (
          <div className="space-y-4">
            <p className="text-sm text-void-400">
              Which AI coding agents will you use with this project?
            </p>
            <div className="space-y-2">
              {PROVIDER_INFO.map((p) => {
                const selected = selectedProviders.includes(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggleProvider(p.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                      selected
                        ? 'border-blue-500/50 bg-blue-600/10'
                        : 'border-void-700 bg-void-800/50 hover:border-void-600'
                    }`}
                  >
                    <div
                      className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                        selected
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-void-600 bg-void-800'
                      }`}
                    >
                      {selected && (
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-void-100">{p.name}</span>
                        <span className="rounded bg-void-700 px-1.5 py-0.5 font-mono text-xs text-void-400">
                          {p.filename}
                        </span>
                      </div>
                      <span className="text-xs text-void-500">{p.description}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-void-500">
              Each selected provider gets its own instruction file with shared project conventions and provider-specific tips.
            </p>
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setPhase('details')}
                className="rounded px-4 py-2 text-sm text-void-400 hover:text-void-200"
              >
                Back
              </button>
              <button
                onClick={handleProvidersNext}
                disabled={analyzing}
                className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {analyzing ? 'Analyzing...' : 'Next'}
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* Phase 3: Grouped Review                                          */}
        {/* ================================================================ */}
        {phase === 'review' && analysis && (
          <div className="space-y-4">
            {isNewDir ? (
              <div className="rounded border border-void-700 bg-void-800/50 p-3">
                <p className="text-sm text-void-300">
                  {!analysis.exists
                    ? 'Directory does not exist — it will be created with full scaffolding.'
                    : 'Directory is empty — full scaffolding will be applied.'}
                </p>
              </div>
            ) : (
              <p className="text-sm text-void-400">
                Existing project detected. Review what will be added:
              </p>
            )}

            <div className="space-y-2">
              {analysis.groups.map((group) => {
                const expanded = expandedGroups[group.id] ?? false;
                const missingCount = group.items.filter((i) => i.status === 'missing').length;
                const presentCount = group.items.filter(
                  (i) => i.status === 'present'
                ).length;
                const actionableCount = missingCount;
                const activeCount = group.items.filter(
                  (i) =>
                    i.status === 'missing' &&
                    itemActions[i.path] !== 'skip'
                ).length;

                return (
                  <div
                    key={group.id}
                    className="overflow-hidden rounded border border-void-700 bg-void-800/30"
                  >
                    {/* Group header */}
                    <div className="flex items-center justify-between px-3 py-2">
                      <button
                        onClick={() => toggleGroupExpand(group.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        <svg
                          className={`h-3 w-3 flex-shrink-0 text-void-500 transition-transform ${
                            expanded ? 'rotate-90' : ''
                          }`}
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-void-200">
                            {group.name}
                          </span>
                          <span className="ml-2 text-xs text-void-500">
                            {group.items.length} items
                          </span>
                        </div>
                      </button>
                      <div className="flex items-center gap-2">
                        {/* Status badges */}
                        {presentCount > 0 && (
                          <span className="rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
                            {presentCount} ok
                          </span>
                        )}
                        {missingCount > 0 && (
                          <span className="rounded-full bg-blue-900/30 px-2 py-0.5 text-xs text-blue-400">
                            {missingCount} new
                          </span>
                        )}
                        {/* Group-level toggle */}
                        {actionableCount > 0 && !isNewDir && (
                          <button
                            onClick={() => toggleGroupAction(group.id)}
                            className={`rounded px-2 py-0.5 text-xs font-medium ${
                              activeCount === actionableCount
                                ? 'bg-blue-600/20 text-blue-400'
                                : activeCount === 0
                                  ? 'bg-void-700 text-void-400'
                                  : 'bg-blue-600/10 text-blue-400'
                            }`}
                          >
                            {activeCount === actionableCount ? 'All' : activeCount === 0 ? 'None' : `${activeCount}/${actionableCount}`}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Group description */}
                    {expanded && (
                      <div className="border-t border-void-700/50 px-3 py-1.5">
                        <p className="text-xs text-void-500">{group.description}</p>
                      </div>
                    )}

                    {/* Expanded items */}
                    {expanded && (
                      <div className="border-t border-void-700/50">
                        {[...group.items].sort((a, b) => (b.essential ? 1 : 0) - (a.essential ? 1 : 0)).map((item) => {
                          const action = itemActions[item.path] || 'skip';
                          const isMissing = item.status === 'missing';
                          const isPresent = item.status === 'present';
                          const hasDifferentVersion =
                            isPresent && item.match === false;

                          return (
                            <div
                              key={item.path}
                              className={`flex flex-col border-b border-void-700/30 px-3 py-1.5 last:border-0 ${item.essential ? 'bg-amber-900/10' : ''}`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex min-w-0 items-center gap-2">
                                  {isMissing && (
                                    <span
                                      className="flex-shrink-0 text-blue-400"
                                      title="Will be created"
                                    >
                                      +
                                    </span>
                                  )}
                                  {isPresent && (
                                    <span
                                      className="flex-shrink-0 text-green-400"
                                      title={hasDifferentVersion ? `Local: ${item.localVersion}, Store: ${item.masterVersion}` : 'Up to date'}
                                    >
                                      &#x2713;
                                    </span>
                                  )}
                                  <span className="truncate font-mono text-xs text-void-300">
                                    {item.path}
                                  </span>
                                  {item.essential && (
                                    <span className="flex-shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
                                      Required
                                    </span>
                                  )}
                                  {hasDifferentVersion && (
                                    <span className="flex-shrink-0 text-xs text-void-600">
                                      v{item.localVersion}
                                    </span>
                                  )}
                                </div>
                                {isMissing && (
                                  <button
                                    onClick={() => toggleAction(item.path)}
                                    className={`flex-shrink-0 rounded px-2 py-0.5 text-xs font-medium ${
                                      action === 'skip'
                                        ? 'bg-void-700 text-void-400'
                                        : 'bg-blue-600/20 text-blue-400'
                                    }`}
                                  >
                                    {action === 'skip' ? 'Skip' : 'Create'}
                                  </button>
                                )}
                              </div>
                              {/* Warning when essential skill is skipped */}
                              {item.essential && isMissing && action === 'skip' && (
                                <p className="mt-1 text-[11px] text-amber-400/80">
                                  SlyCode requires this skill to function properly.
                                </p>
                              )}
                              {/* Warning when essential skill already exists (may be overwritten by updates) */}
                              {item.essential && isPresent && (
                                <p className="mt-1 text-[11px] text-void-500">
                                  Exists — will be kept. Updates are managed via CLI Assets.
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Warning if essential skills are being skipped */}
            {analysis.items.some(i => i.essential && i.status === 'missing' && itemActions[i.path] === 'skip') && (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-xs font-medium text-amber-400">
                  Essential skills skipped
                </p>
                <p className="mt-0.5 text-[11px] text-amber-400/70">
                  Kanban and messaging skills are required for SlyCode&apos;s core functionality (card management, Telegram integration). The project will scaffold but some features won&apos;t work.
                </p>
              </div>
            )}

            <div className="flex justify-between pt-2">
              <button
                onClick={() => setPhase('providers')}
                className="rounded px-4 py-2 text-sm text-void-400 hover:text-void-200"
              >
                Back
              </button>
              <button
                onClick={handleCreate}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500"
              >
                Create Project
              </button>
            </div>
          </div>
        )}

        {/* ================================================================ */}
        {/* Phase 4: Creating                                                */}
        {/* ================================================================ */}
        {phase === 'creating' && (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-void-600 border-t-neon-blue-400" />
            <p className="text-sm text-void-400">Scaffolding project...</p>
          </div>
        )}

        {/* ================================================================ */}
        {/* Phase 5: Summary                                                 */}
        {/* ================================================================ */}
        {phase === 'summary' && createResult && (
          <div className="space-y-4">
            <div className="rounded border border-green-800 bg-green-900/30 p-4">
              <p className="font-medium text-green-300">
                Project &quot;{name}&quot; created successfully!
              </p>
            </div>

            {/* Results grouped by action */}
            {(() => {
              const results = createResult.scaffold?.results || [];
              const created = results.filter(
                (r: ScaffoldResult) => r.action === 'created' || r.action === 'copied' || r.action === 'initialized'
              );
              const skipped = results.filter((r: ScaffoldResult) => r.action === 'skipped');

              return (
                <div className="space-y-3">
                  {created.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-green-400">
                        Created ({created.length})
                      </p>
                      <div className="rounded border border-void-700 bg-void-800/30">
                        {created.map((r: ScaffoldResult, i: number) => (
                          <div
                            key={i}
                            className="border-b border-void-700/30 px-3 py-1 last:border-0"
                          >
                            <span className="font-mono text-xs text-void-300">
                              {r.path}
                            </span>
                            {r.count != null && (
                              <span className="ml-2 text-xs text-void-500">
                                ({r.count} items)
                              </span>
                            )}
                            {r.seedCards != null && (
                              <span className="ml-2 text-xs text-void-500">
                                ({r.seedCards} seed cards)
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {skipped.length > 0 && (
                    <div>
                      <p className="mb-1 text-xs font-medium text-void-500">
                        Skipped ({skipped.length})
                      </p>
                      <div className="rounded border border-void-700/50 bg-void-800/20">
                        {skipped.map((r: ScaffoldResult, i: number) => (
                          <div
                            key={i}
                            className="border-b border-void-700/30 px-3 py-1 last:border-0"
                          >
                            <span className="font-mono text-xs text-void-500">
                              {r.path}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Next steps */}
            <div className="rounded border border-void-700 bg-void-800/30 p-3">
              <p className="mb-2 text-xs font-medium text-void-300">Next steps:</p>
              <ul className="space-y-1 text-xs text-void-400">
                <li>&#8226; Navigate to the project to pick up your setup cards</li>
                <li>
                  &#8226; Customize your{' '}
                  {selectedProviders.map((p) => {
                    const info = PROVIDER_INFO.find((pi) => pi.id === p);
                    return info?.filename;
                  }).filter(Boolean).join(', ')}{' '}
                  with project-specific details
                </li>
                <li>&#8226; Run context-priming to initialize area references</li>
              </ul>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="rounded bg-void-700 px-4 py-2 text-sm font-medium text-void-200 hover:bg-void-600"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
