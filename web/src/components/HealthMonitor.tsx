'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { SystemStats, BridgeStats } from '@/lib/types';
import { usePolling } from '@/hooks/usePolling';

// Threshold levels for color coding
const THRESHOLDS = {
  warning: 70,
  critical: 90,
};

// Refresh interval in milliseconds
const REFRESH_INTERVAL = 5000;


function getThresholdStyles(value: number): { background: string; glow: string } {
  if (value >= THRESHOLDS.critical) {
    return {
      background: 'linear-gradient(90deg, #ff3b5c, #ff6b81)',
      glow: '0 0 8px rgba(255, 59, 92, 0.5)',
    };
  }
  if (value >= THRESHOLDS.warning) {
    return {
      background: 'linear-gradient(90deg, #ff8c00, #ffaa00)',
      glow: '0 0 8px rgba(255, 140, 0, 0.5)',
    };
  }
  return {
    background: 'linear-gradient(90deg, #00e676, #00bfff)',
    glow: '0 0 8px rgba(0, 191, 255, 0.4)',
  };
}



function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)}G`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)}M`;
}

interface MiniBarProps {
  value: number;
  label: string;
}

function MiniBar({ value, label }: MiniBarProps) {
  const styles = getThresholdStyles(value);
  const percentage = Math.min(100, Math.max(0, value));
  const shortLabel = label === 'Memory' ? 'MEM' : label === 'Swap' ? 'SWP' : label.toUpperCase();

  return (
    <div
      className="relative h-3.5 w-10 overflow-hidden rounded bg-void-200 dark:bg-void-700"
      title={`${label}: ${value.toFixed(1)}%`}
    >
      <div
        className="h-full rounded transition-all duration-300"
        style={{ width: `${percentage}%`, background: styles.background, boxShadow: styles.glow }}
      />
      <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-white mix-blend-difference">
        {shortLabel}
      </span>
    </div>
  );
}

interface ExpandedBarProps {
  value: number;
  label: string;
  detail?: string;
}

function ExpandedBar({ value, label, detail }: ExpandedBarProps) {
  const styles = getThresholdStyles(value);
  const percentage = Math.min(100, Math.max(0, value));

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-void-600 dark:text-void-400">{label}</span>
        <span className="font-mono text-void-800 dark:text-void-200">
          {detail || `${value.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-void-200 dark:bg-void-700">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${percentage}%`, background: styles.background, boxShadow: styles.glow }}
        />
      </div>
    </div>
  );
}

interface StopAllModalProps {
  isOpen: boolean;
  terminalCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function StopAllModal({ isOpen, terminalCount, onConfirm, onCancel, isLoading }: StopAllModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-sm rounded-lg bg-void-50 p-6 shadow-(--shadow-overlay) dark:bg-void-800">
        <h3 className="mb-2 text-lg font-semibold text-void-900 dark:text-void-100">
          Stop All Terminals?
        </h3>
        <p className="mb-4 text-sm text-void-600 dark:text-void-400">
          This will stop all {terminalCount} running terminal{terminalCount !== 1 ? 's' : ''}.
          Any active sessions will be terminated.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-void-300 px-4 py-2 text-sm font-medium text-void-700 hover:bg-void-50 dark:border-void-600 dark:text-void-300 dark:hover:bg-void-700"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isLoading ? 'Stopping...' : 'Stop All'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function HealthMonitor() {
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null);
  const [bridgeStats, setBridgeStats] = useState<BridgeStats | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [showStopModal, setShowStopModal] = useState(false);
  const [isStoppingAll, setIsStoppingAll] = useState(false);
  const [bridgeError, setBridgeError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    // Fetch system stats
    try {
      const systemRes = await fetch('/api/system-stats', { signal });
      if (systemRes.ok) {
        const data = await systemRes.json();
        setSystemStats(data);
      }
    } catch {
      // Silently ignore — network errors are expected during sleep/wake
    }

    // Fetch bridge stats
    try {
      const bridgeRes = await fetch('/api/bridge/stats', { signal });
      if (bridgeRes.ok) {
        const data = await bridgeRes.json();
        setBridgeStats(data);
        setBridgeError(false);
      } else {
        setBridgeError(true);
      }
    } catch {
      setBridgeError(true);
    }
  }, []);

  usePolling(fetchStats, REFRESH_INTERVAL);

  // Click-outside dismiss
  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded]);

  const handleStopAll = async () => {
    setIsStoppingAll(true);
    try {
      const res = await fetch('/api/bridge/sessions/stop-all', {
        method: 'POST',
      });
      if (res.ok) {
        // Refresh stats after stopping
        await fetchStats();
      }
    } catch (err) {
      console.error('Failed to stop all sessions:', err);
    } finally {
      setIsStoppingAll(false);
      setShowStopModal(false);
    }
  };

  const cpuPercent = systemStats?.cpu ?? 0;
  const memoryPercent = systemStats
    ? (systemStats.memory.used / systemStats.memory.total) * 100
    : 0;
  const swapPercent = systemStats?.swap?.total
    ? (systemStats.swap.used / systemStats.swap.total) * 100
    : 0;
  const hasSwap = (systemStats?.swap?.total ?? 0) > 0;

  const bridgeTerminals = bridgeStats?.bridgeTerminals ?? 0;
  const activelyWorking = bridgeStats?.activelyWorking ?? 0;

  const worstMetric = Math.max(cpuPercent, memoryPercent, hasSwap ? swapPercent : 0);
  const worstStyles = getThresholdStyles(worstMetric);

  return (
    <>
      <div
        ref={containerRef}
        className="relative cursor-pointer"
        onClick={() => setIsExpanded(prev => !prev)}
      >
        {/* Compact View */}
        <div className="flex items-center gap-2 rounded-lg border border-void-200 bg-void-50 px-2 py-1 dark:border-void-700 dark:bg-void-800">
          {/* Mobile: compact status dot + terminal count */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <div
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: worstStyles.background }}
              title={`CPU: ${cpuPercent.toFixed(0)}% | Mem: ${memoryPercent.toFixed(0)}%${hasSwap ? ` | Swap: ${swapPercent.toFixed(0)}%` : ''}`}
            />
            <span className="text-[10px] font-mono text-void-600 dark:text-void-400">
              {bridgeError ? '--' : bridgeTerminals}
            </span>
            {activelyWorking > 0 && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-green-500"></span>
              </span>
            )}
          </div>

          {/* Desktop: full bars */}
          <div className="hidden sm:flex items-center gap-2">
            {/* CPU */}
            <MiniBar value={cpuPercent} label="CPU" />

            {/* Memory */}
            <MiniBar value={memoryPercent} label="Memory" />

            {/* Swap - only show if swap is configured */}
            {hasSwap && <MiniBar value={swapPercent} label="Swap" />}

            {/* Terminal count */}
            <div
              className="flex items-center gap-0.5 text-xs text-void-600 dark:text-void-400"
              title={`${bridgeTerminals} terminal${bridgeTerminals !== 1 ? 's' : ''} running`}
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="font-mono">
                {bridgeError ? '--' : bridgeTerminals}
              </span>
            </div>

            {/* Active indicator */}
            {activelyWorking > 0 && (
              <div
                className="flex items-center gap-0.5"
                title={`${activelyWorking} actively working`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500"></span>
                </span>
                <span className="text-xs font-mono text-green-600 dark:text-green-400">
                  {activelyWorking}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Expanded View */}
        {isExpanded && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-void-200 bg-white p-3 shadow-(--shadow-overlay) dark:border-void-700 dark:bg-void-800">
            <h4 className="mb-3 text-sm font-semibold text-void-900 dark:text-void-100">
              System Health
            </h4>

            {/* System Stats */}
            <div className="mb-3 space-y-2">
              <ExpandedBar
                value={cpuPercent}
                label="CPU"
                detail={`${cpuPercent.toFixed(1)}%`}
              />
              <ExpandedBar
                value={memoryPercent}
                label="Memory"
                detail={
                  systemStats
                    ? `${formatBytes(systemStats.memory.used)} / ${formatBytes(systemStats.memory.total)}`
                    : '--'
                }
              />
              {hasSwap && (
                <ExpandedBar
                  value={swapPercent}
                  label="Swap"
                  detail={
                    systemStats?.swap
                      ? `${formatBytes(systemStats.swap.used)} / ${formatBytes(systemStats.swap.total)}`
                      : '--'
                  }
                />
              )}
            </div>

            {/* Separator */}
            <div className="my-3 border-t border-void-200 dark:border-void-700" />

            {/* Terminal Stats */}
            <div className="mb-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-void-600 dark:text-void-400">Terminals running</span>
                <span className="font-mono text-void-800 dark:text-void-200">
                  {bridgeError ? '--' : bridgeTerminals}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-void-600 dark:text-void-400">Actively working</span>
                <span className={`font-mono ${activelyWorking > 0 ? 'text-green-600 dark:text-green-400' : 'text-void-800 dark:text-void-200'}`}>
                  {bridgeError ? '--' : activelyWorking}
                </span>
              </div>
            </div>

            {/* Stop All Button */}
            {bridgeTerminals > 0 && !bridgeError && (
              <>
                <div className="my-3 border-t border-void-200 dark:border-void-700" />
                <button
                  onClick={() => setShowStopModal(true)}
                  className="w-full rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                >
                  Stop All Terminals
                </button>
              </>
            )}

            {bridgeError && (
              <p className="text-xs text-red-500">Bridge unavailable</p>
            )}
          </div>
        )}
      </div>

      {/* Stop All Confirmation Modal */}
      <StopAllModal
        isOpen={showStopModal}
        terminalCount={bridgeTerminals}
        onConfirm={handleStopAll}
        onCancel={() => setShowStopModal(false)}
        isLoading={isStoppingAll}
      />
    </>
  );
}
