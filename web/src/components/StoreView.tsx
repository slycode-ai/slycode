'use client';

import { useState } from 'react';
import type { StoreData, StoreAssetInfo, AssetType } from '@/lib/types';
import { AssetViewer } from './AssetViewer';

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
  const [expandedSections, setExpandedSections] = useState({
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
    { key: 'skills' as const, label: 'Skills', assets: data.skills },
    { key: 'agents' as const, label: 'Agents', assets: data.agents },
  ];

  return (
    <div className="space-y-4">
      {/* Asset sections */}
      {sections.map(({ key, label, assets }) => (
        <div key={key} className="rounded-lg border border-void-200 bg-white shadow-(--shadow-card) dark:border-void-700 dark:bg-void-850">
          <button
            onClick={() => toggleSection(key)}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-void-900 dark:text-void-100">{label}</h3>
              <span className="rounded-full bg-void-100 px-2 py-0.5 text-xs text-void-600 dark:bg-void-700 dark:text-void-300">
                {assets.length}
              </span>
            </div>
            <svg
              className={`h-4 w-4 text-void-400 transition-transform ${expandedSections[key] ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections[key] && assets.length > 0 && (
            <div className="border-t border-void-100 dark:border-void-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-void-200 dark:border-void-700">
                    <th className="px-4 py-2 text-left text-xs font-medium text-void-500 dark:text-void-400">Asset</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-void-500 dark:text-void-400">Version</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-void-500 dark:text-void-400">Description</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-void-500 dark:text-void-400">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(asset => (
                    <tr key={asset.name} className="border-b border-void-100 dark:border-void-800">
                      <td className="px-4 py-2">
                        <button
                          onClick={() => setViewingAsset(asset)}
                          className="flex items-center gap-2 text-left font-medium text-void-900 hover:text-blue-600 dark:text-void-100 dark:hover:text-blue-400"
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
                      <td className="px-4 py-2 text-void-500 dark:text-void-400">
                        {asset.frontmatter?.version
                          ? `v${asset.frontmatter.version}`
                          : '-'}
                      </td>
                      <td className="px-4 py-2 text-xs text-void-500 dark:text-void-400 max-w-xs truncate">
                        {(asset.frontmatter?.description as string) || '-'}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setConfirmDelete({ name: asset.name, type: asset.type })}
                            className="rounded border border-red-400/30 bg-red-400/10 px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-400/20"
                            title="Delete from store"
                          >
                            Del
                          </button>
                          {!asset.isValid && onFix && (
                            <button
                              onClick={() => onFix(asset.name, asset.type)}
                              className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-500 hover:bg-amber-400/20"
                              title="Fix missing frontmatter"
                            >
                              Fix
                            </button>
                          )}
                          {onAssistant && (
                            <button
                              onClick={() => onAssistant('modify', asset.name, asset.type)}
                              className="rounded border border-void-600 bg-void-800 px-2 py-1 text-xs font-medium text-void-300 hover:bg-void-700 hover:text-void-200"
                              title="Modify with LLM assistance"
                            >
                              Modify
                            </button>
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
            <div className="border-t border-void-100 py-4 text-center text-sm text-void-500 dark:border-void-700 dark:text-void-400">
              No {label.toLowerCase()} in store
            </div>
          )}
        </div>
      ))}

      {/* MCP section */}
      {data.mcp.length > 0 && (
        <div className="rounded-lg border border-void-200 bg-white shadow-(--shadow-card) dark:border-void-700 dark:bg-void-850">
          <button
            onClick={() => toggleSection('mcp')}
            className="flex w-full items-center justify-between px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-void-900 dark:text-void-100">MCP Configs</h3>
              <span className="rounded-full bg-void-100 px-2 py-0.5 text-xs text-void-600 dark:bg-void-700 dark:text-void-300">
                {data.mcp.length}
              </span>
            </div>
            <svg
              className={`h-4 w-4 text-void-400 transition-transform ${expandedSections.mcp ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expandedSections.mcp && (
            <div className="border-t border-void-100 dark:border-void-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-void-200 dark:border-void-700">
                    <th className="px-4 py-2 text-left text-xs font-medium text-void-500 dark:text-void-400">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-void-500 dark:text-void-400">Description</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-void-500 dark:text-void-400">Version</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mcp.map(mcp => (
                    <tr key={mcp.name} className="border-b border-void-100 dark:border-void-800">
                      <td className="px-4 py-2 font-medium text-void-900 dark:text-void-100">
                        <span className="flex items-center gap-2">
                          {mcp.name}
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeColors.mcp}`}>
                            mcp
                          </span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-void-500 dark:text-void-400">
                        {(mcp.frontmatter?.description as string) || '-'}
                      </td>
                      <td className="px-4 py-2 text-void-500 dark:text-void-400">
                        {mcp.frontmatter?.version ? `v${mcp.frontmatter.version}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmDelete(null); }}
        >
          <div className="mx-4 w-full max-w-sm rounded-lg border border-void-700 bg-void-850 p-5 shadow-(--shadow-overlay)">
            <h3 className="text-sm font-semibold text-void-100">Delete from store?</h3>
            <p className="mt-2 text-sm text-void-400">
              This will permanently delete <strong className="text-void-200">{confirmDelete.name}</strong> ({confirmDelete.type}) from the canonical store.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="rounded px-3 py-1.5 text-sm text-void-400 hover:text-void-200"
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
