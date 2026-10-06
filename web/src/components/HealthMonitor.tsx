'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { SystemStats, BridgeStats } from '@/lib/types';
import { usePolling } from '@/hooks/usePolling';
import Tooltip from './Tooltip';

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
      background: 'var(--danger)',
      glow: 'none',
    };
  }
  if (value >= THRESHOLDS.warning) {
    return {
      background: 'var(--warn)',
      glow: 'none',
    };
  }
  return {
    background: 'var(--ink-3)',
    glow: 'none',
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
    <Tooltip content={`${label}: ${value.toFixed(1)}%`} placement="bottom">
      <div className="flex items-center gap-1 font-mono text-[10px] leading-4 text-ink-3">
        <span>{shortLabel}</span>
        <span className="relative h-1 w-6 overflow-hidden rounded-full bg-line-strong">
          <span
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
            style={{ width: `${percentage}%`, background: styles.background }}
          />
        </span>
      </div>
    </Tooltip>
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
        <span className="text-ink-2">{label}</span>
        <span className="font-mono text-ink-1">
          {detail || `${value.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
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
  nonResumableCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading: boolean;
}

function StopAllModal({ isOpen, terminalCount, nonResumableCount, onConfirm, onCancel, isLoading }: StopAllModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-sm rounded-lg bg-surface-2 p-6 shadow-(--shadow-overlay)">
        <h3 className="mb-2 text-lg font-semibold text-ink-1">
          Stop All Terminals?
        </h3>
        <p className="mb-4 text-sm text-ink-2">
          This will stop all {terminalCount} running terminal{terminalCount !== 1 ? 's' : ''}.
          Any active sessions will be terminated.
        </p>
        {nonResumableCount > 0 && (
          <p className="mb-4 rounded-md border border-amber-700/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            {nonResumableCount} session{nonResumableCount !== 1 ? 's have' : ' has'} no captured
            conversation id and won&apos;t be resumable after stopping.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-ink-2 hover:bg-surface-3"
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
  const [nonResumableCount, setNonResumableCount] = useState(0);

  // When the Stop All confirm opens, count live sessions with no captured
  // conversation id — they stop as non-resumable and deserve a warning (080)
  useEffect(() => {
    if (!showStopModal) {
      setNonResumableCount(0);
      return;
    }
    let cancelled = false;
    fetch('/api/bridge/sessions')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data?.sessions) return;
        const count = (data.sessions as Array<{ status?: string; hasHistory?: boolean }>).filter(
          s => (s.status === 'running' || s.status === 'detached') && !s.hasHistory
        ).length;
        setNonResumableCount(count);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [showStopModal]);
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
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2 py-1">
          {/* Mobile: compact status dot + terminal count */}
          <div className="flex items-center gap-1.5 sm:hidden">
            <Tooltip content={`CPU: ${cpuPercent.toFixed(0)}% | Mem: ${memoryPercent.toFixed(0)}%${hasSwap ? ` | Swap: ${swapPercent.toFixed(0)}%` : ''}`} placement="bottom">
              <div
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: worstStyles.background }}
              />
            </Tooltip>
            <span className="text-[10px] font-mono text-ink-2">
              {bridgeError ? '--' : bridgeTerminals}
            </span>
            {activelyWorking > 0 && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="live-dot absolute inset-0 m-auto !h-full !w-full"></span>
                
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
            <Tooltip content={`${bridgeTerminals} terminal${bridgeTerminals !== 1 ? 's' : ''} running`} placement="bottom">
              <div
                className="flex items-center gap-0.5 text-xs text-ink-2"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span className="font-mono">
                  {bridgeError ? '--' : bridgeTerminals}
                </span>
              </div>
            </Tooltip>

            {/* Active indicator */}
            {activelyWorking > 0 && (
              <Tooltip content={`${activelyWorking} actively working`} placement="bottom">
                <div
                  className="flex items-center gap-0.5"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="live-dot absolute inset-0 m-auto !h-full !w-full"></span>
                    
                  </span>
                  <span className="text-xs font-mono text-live-text">
                    {activelyWorking}
                  </span>
                </div>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Expanded View */}
        {isExpanded && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-surface-1 p-3 shadow-(--shadow-overlay)">
            <h4 className="mb-3 text-sm font-semibold text-ink-1">
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
            <div className="my-3 border-t border-line" />

            {/* Terminal Stats */}
            <div className="mb-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-2">Terminals running</span>
                <span className="font-mono text-ink-1">
                  {bridgeError ? '--' : bridgeTerminals}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-2">Actively working</span>
                <span className={`font-mono ${activelyWorking > 0 ? 'text-green-600 dark:text-green-400' : 'text-void-800 dark:text-void-200'}`}>
                  {bridgeError ? '--' : activelyWorking}
                </span>
              </div>
            </div>

            {/* Stop All Button */}
            {bridgeTerminals > 0 && !bridgeError && (
              <>
                <div className="my-3 border-t border-line" />
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
        nonResumableCount={nonResumableCount}
        onConfirm={handleStopAll}
        onCancel={() => setShowStopModal(false)}
        isLoading={isStoppingAll}
      />
    </>
  );
}
