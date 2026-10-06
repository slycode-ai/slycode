'use client';

import { useState, useEffect } from 'react';
import type { StoreData, StoreAssetInfo, AssetType, ProviderId, Project } from '@/lib/types';
import { AssetViewer } from './AssetViewer';
import Tooltip from './Tooltip';

interface StoreViewProps {
  data: StoreData;
  onFix?: (assetName: string, assetType: AssetType, projectId?: string) => void;
  onAssistant?: (mode: 'create' | 'modify', assetName?: string, assetType?: AssetType) => void;
  onRefresh?: () => void;
}

const typeBadgeColors: Record<string, string> = {
  skill: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  agent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  mcp: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};

export function StoreView({ data, onFix, onAssistant, onRefresh }: StoreViewProps) {
  const [viewingAsset, setViewingAsset] = useState<StoreAssetInfo | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ name: string; type: AssetType } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deployTarget, setDeployTarget] = useState<{ name: string } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    skills: true,
    agents: true,
    mcp: true,
  });

  function toggleSection(section: keyof typeof expandedSections) {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  }

  async function handleDelete(name: string, type: AssetType) {
    setDeleting(true);
    try {
      const res = await fetch('/api/cli-assets/store', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetType: type, assetName: name }),
      });
      if (res.ok) {
        onRefresh?.();
      }
    } catch { /* ignore */ }
    setDeleting(false);
    setConfirmDelete(null);
  }

  const sections = [
    { key: 'skills', label: 'Skills', assets: data.skills },
    { key: 'agents', label: 'Agents', assets: data.agents },
    { key: 'mcp', label: 'MCP Configs', assets: data.mcp },
  ];

  return (
    <div className="space-y-4">
      {/* Asset sections */}
      {sections.map(({ key, label, assets }) => (
        <div key={key} className="rounded-lg border border-line bg-surface-1 shadow-(--shadow-card)">
          <button
            onClick={() => toggleSection(key)}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink-1">{label}</h3>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
                {assets.length}
              </span>
            </div>
            <svg
              className={`h-4 w-4 text-ink-3 transition-transform ${expandedSections[key] ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections[key] && assets.length > 0 && (
            <div className="border-t border-line">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 text-left text-xs font-medium text-ink-3">Asset</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-ink-3">Version</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-ink-3">Description</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-ink-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(asset => (
                    <tr key={asset.name} className="border-b border-line">
                      <td className="px-4 py-2">
                        <button
                          onClick={() => setViewingAsset(asset)}
                          className="flex items-center gap-2 text-left font-medium text-ink-1 hover:text-accent"
                        >
                          {asset.name}
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeColors[asset.type]}`}>
                            {asset.type}
                          </span>
                          {!asset.isValid && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                              !
                            </span>
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-2 text-ink-3">
                        {asset.frontmatter?.version
                          ? `v${asset.frontmatter.version}`
                          : '-'}
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-3 max-w-xs truncate">
                        {(asset.frontmatter?.description as string) || '-'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {asset.type === 'mcp' && (
                            <Tooltip content="Deploy to project">
                              <button
                                onClick={() => setDeployTarget({ name: asset.name })}
                                className="rounded border border-accent/30 bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20"
                              >
                                Deploy
                              </button>
                            </Tooltip>
                          )}
                          <Tooltip content="Delete from store">
                            <button
                              onClick={() => setConfirmDelete({ name: asset.name, type: asset.type })}
                              className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-400/20"
                            >
                              Del
                            </button>
                          </Tooltip>
                          {!asset.isValid && onFix && (
                            <Tooltip content="Fix missing frontmatter">
                              <button
                                onClick={() => onFix(asset.name, asset.type)}
                                className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-500 hover:bg-amber-400/20"
                              >
                                Fix
                              </button>
                            </Tooltip>
                          )}
                          {onAssistant && (
                            <Tooltip content="Modify with LLM assistance">
                              <button
                                onClick={() => onAssistant('modify', asset.name, asset.type)}
                                className="rounded border border-line-strong bg-surface-1 px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-3 hover:text-ink-1"
                              >
                                Modify
                              </button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {expandedSections[key] && assets.length === 0 && (
            <div className="border-t border-line py-4 text-center text-sm text-ink-3">
              No {label.toLowerCase()} in store
            </div>
          )}
        </div>
      ))}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="mx-4 w-full max-w-sm rounded-lg border border-line bg-surface-2 p-5 shadow-(--shadow-overlay)">
            <h3 className="text-sm font-semibold text-ink-1">Delete from store?</h3>
            <p className="mt-2 text-sm text-ink-3">
              This will permanently delete <strong className="text-ink-1">{confirmDelete.name}</strong> ({confirmDelete.type}) from the canonical store.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded px-3 py-1.5 text-sm text-ink-3 hover:text-ink-1"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDelete.name, confirmDelete.type)}
                disabled={deleting}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset viewer modal */}
      {viewingAsset && (
        <StoreAssetViewerModal
          asset={viewingAsset}
          onClose={() => setViewingAsset(null)}
        />
      )}

      {/* MCP deploy dialog */}
      {deployTarget && (
        <McpDeployDialog
          mcpName={deployTarget.name}
          onClose={() => setDeployTarget(null)}
          onDeployed={() => { setDeployTarget(null); onRefresh?.(); }}
        />
      )}
    </div>
  );
}

/**
 * Deploy an MCP from the store to a project.
 */
function McpDeployDialog({ mcpName, onClose, onDeployed }: {
  mcpName: string;
  onClose: () => void;
  onDeployed: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderId>('claude');
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(data => {
        if (data.projects) setProjects(data.projects);
      })
      .catch(() => {});
  }, []);

  async function handleDeploy() {
    if (!selectedProject) return;
    setDeploying(true);
    setResult(null);
    try {
      const res = await fetch('/api/cli-assets/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          changes: [{
            assetName: mcpName,
            assetType: 'mcp',
            projectId: selectedProject,
            action: 'deploy',
            provider: selectedProvider,
            source: 'store',
          }],
        }),
      });
      const data = await res.json();
      const firstResult = data.results?.[0];
      if (res.ok && firstResult?.success && firstResult?.error) {
        // success=true but has error message means "already present — skipped"
        setResult({ success: true, message: firstResult.error });
      } else if (res.ok && firstResult?.success) {
        setResult({ success: true, message: `Deployed to ${projects.find(p => p.id === selectedProject)?.name || selectedProject}` });
        setTimeout(onDeployed, 1200);
      } else {
        setResult({ success: false, message: data.results?.[0]?.error || data.error || 'Deploy failed' });
      }
    } catch {
      setResult({ success: false, message: 'Network error' });
    }
    setDeploying(false);
  }

  const providers: { id: ProviderId; label: string }[] = [
    { id: 'claude', label: 'Claude' },
    { id: 'codex', label: 'Codex' },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 w-full max-w-sm rounded-lg border border-line bg-surface-2 p-5 shadow-(--shadow-overlay)">
        <h3 className="text-sm font-semibold text-ink-1">
          Deploy MCP: <span className="text-accent">{mcpName}</span>
        </h3>

        <div className="mt-4 space-y-3">
          {/* Project picker */}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-3">Project</label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-1 focus:border-accent/50 focus:outline-none"
            >
              <option value="">Select project...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Provider picker */}
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-3">Provider</label>
            <div className="flex gap-1">
              {providers.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedProvider(p.id)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    selectedProvider === p.id
                      ? 'border border-accent/40 bg-accent/20 text-accent'
                      : 'border border-line text-ink-3 hover:border-line-strong hover:text-ink-1'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Result message */}
          {result && (
            <div className={`rounded-md border p-2 text-xs ${
              result.success
                ? 'border-green-400/30 bg-green-400/10 text-st-done'
                : 'border-red-400/30 bg-red-400/10 text-danger-text'
            }`}>
              {result.message}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-ink-3 hover:text-ink-1"
          >
            Cancel
          </button>
          <button
            onClick={handleDeploy}
            disabled={!selectedProject || deploying}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Simplified asset viewer for store assets.
 */
function StoreAssetViewerModal({ asset, onClose }: { asset: StoreAssetInfo; onClose: () => void }) {
  const assetInfo = {
    name: asset.name,
    type: asset.type,
    path: asset.path,
    frontmatter: asset.frontmatter,
    isValid: asset.isValid,
  };

  return (
    <AssetViewer
      asset={assetInfo}
      pathPrefix="store/"
      onClose={onClose}
    />
  );
}
