'use client';

import { useState, useEffect } from 'react';
import type { AssetInfo } from '@/lib/types';
import { MarkdownContent } from './MarkdownContent';

interface AssetViewerProps {
  asset: AssetInfo;
  projectId?: string;  // If set, reads from this project instead of master
  pathPrefix?: string; // Override the default '.claude/' prefix (e.g. 'store/')
  onClose: () => void;
}

const typeBadgeColors: Record<string, string> = {
  skill: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  agent: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  mcp: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};

/**
 * Strip YAML frontmatter (--- delimited block at start of file)
 */
function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content;
  const endIdx = content.indexOf('---', 3);
  if (endIdx === -1) return content;
  return content.slice(endIdx + 3).trimStart();
}

export function AssetViewer({ asset, projectId, pathPrefix, onClose }: AssetViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadContent() {
      try {
        // Build the file path based on asset type
        const basePath = (pathPrefix ?? '.claude/') + asset.path;
        const params = new URLSearchParams({ path: basePath });
        if (projectId) params.set('projectId', projectId);
        const res = await fetch(`/api/file?${params}`);
        if (res.ok) {
          const data = await res.json();
          setContent(data.content);
        } else {
          setContent('Failed to load asset content.');
        }
      } catch {
        setContent('Failed to load asset content.');
      }
      setLoading(false);
    }
    loadContent();
  }, [asset.path]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const markdownBody = content ? stripFrontmatter(content) : '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-void-700 bg-void-850 shadow-(--shadow-overlay)">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-void-700 px-5 py-4">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold text-void-100">{asset.name}</h3>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${typeBadgeColors[asset.type]}`}>
              {asset.type}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-void-400 hover:bg-void-800 hover:text-void-200"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Frontmatter detail panel */}
        <div className="border-b border-void-800 px-5 py-3">
          {asset.frontmatter ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                {(['version', 'updated', 'description'] as const).map(field => {
                  const value = asset.frontmatter?.[field];
                  return (
                    <span key={field} className={value ? 'text-void-300' : field === 'version' ? 'text-red-400' : 'text-amber-400'}>
                      <span className="text-void-500">{field}:</span>{' '}
                      {value
                        ? (field === 'description'
                          ? String(value).length > 60 ? String(value).slice(0, 60) + '...' : String(value)
                          : String(value))
                        : <span className="italic">missing</span>}
                    </span>
                  );
                })}
              </div>
              {/* Show any extra fields */}
              {Object.keys(asset.frontmatter).filter(k => !['name', 'version', 'updated', 'description', 'converted_from'].includes(k)).length > 0 && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-void-500">
                  {Object.entries(asset.frontmatter)
                    .filter(([k]) => !['name', 'version', 'updated', 'description', 'converted_from'].includes(k))
                    .map(([k, v]) => (
                      <span key={k}>
                        {k}: <span className="text-void-400">{String(v)}</span>
                      </span>
                    ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-xs text-red-400">No frontmatter found</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-void-600 border-t-neon-blue-400" />
            </div>
          ) : (
            <MarkdownContent>{markdownBody}</MarkdownContent>
          )}
        </div>
      </div>
    </div>
  );
}
