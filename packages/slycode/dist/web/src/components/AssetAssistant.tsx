'use client';

import { useState, useEffect } from 'react';
import type { ProviderId, AssetType } from '@/lib/types';

interface AssetAssistantProps {
  mode: 'create' | 'modify';
  provider?: ProviderId;
  assetType?: AssetType;
  assetName?: string;
  onClose: () => void;
}

const assetTypeOptions: { id: AssetType; label: string }[] = [
  { id: 'skill', label: 'Skill' },
  { id: 'agent', label: 'Agent' },
  { id: 'mcp', label: 'MCP Server' },
];

export function AssetAssistant({
  mode,
  provider: initialProvider,
  assetType: initialType,
  assetName: initialName,
  onClose,
}: AssetAssistantProps) {
  const selectedProvider = initialProvider || 'claude';
  const [selectedType, setSelectedType] = useState<AssetType>(initialType || 'skill');
  const [name, setName] = useState(initialName || '');
  const [description, setDescription] = useState('');
  const [changes, setChanges] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isCreate = mode === 'create';
  const title = isCreate ? 'Create New Asset' : `Modify: ${initialName}`;

  async function generatePrompt() {
    setLoading(true);
    setError(null);
    try {
      const body = isCreate
        ? { mode, provider: selectedProvider, assetType: selectedType, assetName: name, description }
        : { mode, provider: selectedProvider, assetType: selectedType, assetName: name, changes };

      const res = await fetch('/api/cli-assets/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to generate prompt');
        return;
      }

      const data = await res.json();
      setPrompt(data.prompt);
    } catch {
      setError('Failed to generate prompt');
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

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const canGenerate = isCreate
    ? name.trim() && description.trim()
    : name.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-void-700 bg-void-850 shadow-(--shadow-overlay)">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-void-700 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-void-100">{title}</h3>
            <p className="mt-0.5 text-sm text-void-400">
              {isCreate
                ? 'Design a new asset with LLM assistance'
                : 'Modify an existing asset with LLM assistance'}
            </p>
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

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!prompt && !loading && !error && (
            <div className="space-y-4">
              {/* Provider is determined at deployment time, not at store level */}

              {/* Asset type selector */}
              {isCreate && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-void-400">Asset Type</label>
                  <div className="flex gap-1">
                    {assetTypeOptions.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedType(t.id)}
                        className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                          selectedType === t.id
                            ? 'border border-neon-blue-400/40 bg-neon-blue-400/20 text-neon-blue-400'
                            : 'border border-void-700 text-void-400 hover:border-void-600 hover:text-void-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="mb-1 block text-xs font-medium text-void-400">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={!isCreate}
                  placeholder="e.g. code-review, testing-helper"
                  className="w-full rounded-md border border-void-700 bg-void-900 px-3 py-2 text-sm text-void-200 placeholder-void-500 focus:border-neon-blue-400/50 focus:outline-none disabled:opacity-60"
                  data-voice-target
                />
              </div>

              {/* Description (create) or Changes (modify) */}
              {isCreate ? (
                <div>
                  <label className="mb-1 block text-xs font-medium text-void-400">
                    What should this {selectedType} do?
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={selectedType === 'mcp'
                      ? "Name or URL of the MCP server package (e.g. @anthropic/mcp-server-filesystem, github.com/org/mcp-server)..."
                      : "Describe the purpose, behavior, and key features..."}
                    rows={5}
                    className="w-full rounded-md border border-void-700 bg-void-900 px-3 py-2 text-sm text-void-200 placeholder-void-500 focus:border-neon-blue-400/50 focus:outline-none"
                    data-voice-target
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-xs font-medium text-void-400">
                    What changes do you want?
                  </label>
                  <textarea
                    value={changes}
                    onChange={(e) => setChanges(e.target.value)}
                    placeholder="Describe what to change, add, or improve... (leave empty for general review)"
                    rows={5}
                    className="w-full rounded-md border border-void-700 bg-void-900 px-3 py-2 text-sm text-void-200 placeholder-void-500 focus:border-neon-blue-400/50 focus:outline-none"
                    data-voice-target
                  />
                </div>
              )}

              {/* Generate button */}
              <button
                onClick={generatePrompt}
                disabled={!canGenerate}
                className="rounded-md border border-neon-blue-400/40 bg-neon-blue-400/15 px-4 py-2 text-sm font-medium text-neon-blue-400 hover:bg-neon-blue-400/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate Prompt
              </button>
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-void-600 border-t-neon-blue-400" />
            </div>
          )}

          {error && (
            <div className="space-y-3">
              <div className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-400">{error}</div>
              <button
                onClick={() => { setError(null); setPrompt(null); }}
                className="text-sm text-void-400 hover:text-void-200"
              >
                Back
              </button>
            </div>
          )}

          {prompt && (
            <div className="space-y-3">
              <p className="text-sm text-void-300">
                {isCreate ? 'Creation' : 'Modification'} prompt ready:
              </p>
              <textarea
                readOnly
                value={prompt}
                className="h-64 w-full rounded-md border border-void-700 bg-void-900 p-3 font-mono text-xs text-void-300 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-void-700 px-5 py-3">
          <button onClick={onClose} className="rounded px-4 py-1.5 text-sm text-void-400 hover:text-void-200">
            {prompt ? 'Close' : 'Cancel'}
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
