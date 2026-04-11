'use client';

import { useState } from 'react';
import type { AssetRow, AssetCell, PendingChange, AssetType, AssetCellStatus } from '@/lib/types';
import { AssetViewer } from './AssetViewer';

interface ProjectInfo {
  id: string;
  name: string;
}

interface AssetMatrixProps {
  rows: AssetRow[];
  projects: ProjectInfo[];
  pendingChanges: PendingChange[];
  onQueueChange: (change: PendingChange) => void;
  onImport?: (assetName: string, assetType: AssetType, sourceProjectId: string) => void;
  onFix?: (assetName: string, assetType: AssetType, projectId?: string) => void;
  ignoredAssets?: Set<string>;
  ignoreKeyFn?: (name: string, type: AssetType) => string;
  onIgnore?: (assetName: string, assetType: AssetType) => void;
  onUnignore?: (assetName: string, assetType: AssetType) => void;
}

const typeBadgeColors: Record<string, string> = {
  skill: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  agent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

const statusIcons: Record<AssetCellStatus, { icon: string; color: string }> = {
  current: { icon: '\u2713', color: 'text-green-500' },
  outdated: { icon: '\u26A0', color: 'text-amber-500' },
  missing: { icon: '\u2715', color: 'text-void-400' },
};

/**
 * Compare two semver strings. Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
function compareVersions(a?: string, b?: string): number {
  if (!a || !b) return 0;
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const va = partsA[i] || 0;
    const vb = partsB[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

function isPending(changes: PendingChange[], assetName: string, assetType: AssetType, projectId: string): PendingChange | undefined {
  return changes.find(c =>
    c.assetName === assetName && c.assetType === assetType && c.projectId === projectId
  );
}

export function AssetMatrix({ rows, projects, pendingChanges, onQueueChange, onImport, onFix, ignoredAssets, ignoreKeyFn, onIgnore, onUnignore }: AssetMatrixProps) {
  const [viewingAsset, setViewingAsset] = useState<AssetRow | null>(null);
  const [viewingProjectId, setViewingProjectId] = useState<string | undefined>(undefined);

  if (rows.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-void-500 dark:text-void-400">
        No assets found
      </p>
    );
  }

  function handleCellClick(row: AssetRow, projectId: string, status: AssetCellStatus, cell?: AssetCell) {
    const existing = isPending(pendingChanges, row.name, row.type, projectId);

    if (existing) {
      // Toggle off — remove from pending by adding inverse (handled in parent)
      onQueueChange(existing);
      return;
    }

    // Don't deploy store→project when project version is newer
    if (cell && status === 'outdated' && compareVersions(cell.projectVersion, cell.masterVersion) > 0) {
      return;
    }

    // Left-click on outdated/missing = queue deploy
    if (status === 'outdated' || status === 'missing') {
      onQueueChange({
        assetName: row.name,
        assetType: row.type,
        projectId,
        action: 'deploy',
      });
    }
  }

  function handleCellContext(e: React.MouseEvent, row: AssetRow, projectId: string, status: AssetCellStatus) {
    e.preventDefault();

    const existing = isPending(pendingChanges, row.name, row.type, projectId);

    if (existing) {
      onQueueChange(existing);
      return;
    }

    // Right-click on current/outdated = queue remove
    if (status === 'current' || status === 'outdated') {
      onQueueChange({
        assetName: row.name,
        assetType: row.type,
        projectId,
        action: 'remove',
      });
    }
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-void-200 dark:border-void-700">
              <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-xs font-medium text-void-500 dark:bg-void-850 dark:text-void-400">
                Asset
              </th>
              {projects.map(p => (
                <th
                  key={p.id}
                  className="px-3 py-2 text-center text-xs font-medium text-void-500 dark:text-void-400"
                >
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const isImported = row.isImported;
              const isIgnored = ignoredAssets && ignoreKeyFn ? ignoredAssets.has(ignoreKeyFn(row.name, row.type)) : false;

              // Find cells where project version is newer than store version
              const aheadCells = isImported
                ? row.cells.filter(c => c.status === 'outdated' && compareVersions(c.projectVersion, c.masterVersion) > 0)
                : [];
              const hasNewerProject = aheadCells.length > 0;

              return (
                <tr
                  key={`${row.type}-${row.name}`}
                  className={`border-b border-void-100 dark:border-void-800 ${
                    isIgnored ? 'opacity-40' : !row.masterAsset.isValid && isImported ? 'opacity-60' : ''
                  }`}
                >
                  {/* Asset name column */}
                  <td className="sticky left-0 z-10 bg-white dark:bg-void-850">
                    <div className="flex items-center gap-2 px-3 py-2">
                      {isImported ? (
                        <button
                          onClick={() => { setViewingProjectId(undefined); setViewingAsset(row); }}
                          className="text-left font-medium text-void-900 hover:text-blue-600 dark:text-void-100 dark:hover:text-blue-400"
                        >
                          {row.name}
                        </button>
                      ) : (
                        <span className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              const sourceCell = row.cells.find(c => c.status !== 'missing');
                              setViewingProjectId(sourceCell?.projectId);
                              setViewingAsset(row);
                            }}
                            className="text-left font-medium text-void-600 hover:text-blue-600 dark:text-void-400 dark:hover:text-blue-400"
                          >
                            {row.name}
                          </button>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${typeBadgeColors[row.type]}`}>
                            {row.type}
                          </span>
                        </span>
                      )}

                      {!row.masterAsset.isValid && isImported && (
                        <span className="flex items-center gap-1">
                          <span
                            className="cursor-help text-amber-500"
                            title="Frontmatter missing required fields (name, version, updated, description)"
                          >
                            {'\u26A0'}
                          </span>
                          {onFix && (
                            <button
                              onClick={() => onFix(row.name, row.type)}
                              className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 hover:bg-amber-400/20"
                            >
                              Fix
                            </button>
                          )}
                        </span>
                      )}

                      {hasNewerProject && onImport && (
                        <button
                          onClick={() => {
                            // Pick the project with the newest version
                            const best = [...aheadCells].sort((a, b) =>
                              compareVersions(b.projectVersion, a.projectVersion)
                            )[0];
                            onImport(row.name, row.type, best.projectId);
                          }}
                          className="rounded border border-blue-400/30 bg-blue-400/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-500 hover:bg-blue-400/20 dark:border-blue-400/30 dark:bg-blue-400/10 dark:text-blue-400 dark:hover:bg-blue-400/20"
                          title={`Project v${aheadCells[0].projectVersion} is newer than store v${aheadCells[0].masterVersion}`}
                        >
                          {'\u2191'} Update Store
                        </button>
                      )}

                      <div className="flex-1" />
                      {!isImported && onIgnore && onUnignore && ignoreKeyFn && ignoredAssets && (
                        ignoredAssets.has(ignoreKeyFn(row.name, row.type)) ? (
                          <button
                            onClick={() => onUnignore(row.name, row.type)}
                            className="rounded-md border border-void-300 bg-void-100 px-3 py-1 text-xs font-medium text-void-500 hover:bg-void-200 dark:border-void-700 dark:bg-void-800 dark:text-void-400 dark:hover:bg-void-700"
                          >
                            Unignore
                          </button>
                        ) : (
                          <button
                            onClick={() => onIgnore(row.name, row.type)}
                            className="rounded-md border border-void-300 bg-void-50 px-3 py-1 text-xs font-medium text-void-400 hover:bg-void-100 dark:border-void-700 dark:bg-void-800/50 dark:text-void-500 dark:hover:bg-void-700"
                            title="Hide from Not in Store"
                          >
                            Ignore
                          </button>
                        )
                      )}
                      {!isImported && onImport && (
                        <button
                          onClick={() => {
                            // Find a project that has this asset for import
                            const sourceCell = row.cells.find(c => c.status !== 'missing');
                            if (sourceCell) {
                              onImport(row.name, row.type, sourceCell.projectId);
                            }
                          }}
                          className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-300 dark:hover:bg-purple-900/50"
                        >
                          Import to Store
                        </button>
                      )}
                    </div>
                  </td>

                  {/* Project cells */}
                  {row.cells.map(cell => {
                    const pending = isPending(pendingChanges, row.name, row.type, cell.projectId);
                    const isProjectAhead = cell.status === 'outdated' &&
                      compareVersions(cell.projectVersion, cell.masterVersion) > 0;
                    const { icon, color } = isProjectAhead
                      ? { icon: '\u2191', color: 'text-blue-500' }
                      : statusIcons[cell.status];

                    let bgClass = '';
                    if (pending?.action === 'deploy') {
                      bgClass = 'bg-green-50 dark:bg-green-900/20';
                    } else if (pending?.action === 'remove') {
                      bgClass = 'bg-red-50 dark:bg-red-900/20';
                    }

                    const tooltip = cell.status === 'missing'
                      ? 'Not installed'
                      : cell.status === 'current'
                        ? `Up to date (v${cell.masterVersion || '?'})`
                        : isProjectAhead
                          ? `Project v${cell.projectVersion} is newer than store v${cell.masterVersion}`
                          : `Store: ${cell.masterVersion || '?'} | Project: ${cell.projectVersion || '?'}`;

                    return (
                      <td
                        key={cell.projectId}
                        className={`px-3 py-2 text-center ${bgClass}`}
                        title={pending ? `Pending: ${pending.action}` : tooltip}
                      >
                        <button
                          onClick={() => handleCellClick(row, cell.projectId, cell.status, cell)}
                          onContextMenu={(e) => handleCellContext(e, row, cell.projectId, cell.status)}
                          className={`inline-flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-void-100 dark:hover:bg-void-800 ${
                            pending?.action === 'remove' ? 'line-through text-red-500' : color
                          }`}
                        >
                          {pending?.action === 'deploy' ? (
                            <span className="text-green-500">{'\u2191'}</span>
                          ) : pending?.action === 'remove' ? (
                            <span className="text-red-500">{'\u2715'}</span>
                          ) : (
                            icon
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewingAsset && (
        <AssetViewer
          asset={viewingAsset.masterAsset}
          projectId={viewingProjectId}
          onClose={() => { setViewingAsset(null); setViewingProjectId(undefined); }}
        />
      )}
    </>
  );
}
