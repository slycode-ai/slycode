'use client';

import { useState } from 'react';
import type { HealthScore } from '@/lib/types';

interface HealthDotProps {
  health?: HealthScore;
  size?: 'sm' | 'md';
}

const levelColors = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

export function HealthDot({ health, size = 'sm' }: HealthDotProps) {
  const [showTooltip, setShowTooltip] = useState(false);

  if (!health) return null;

  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-3 w-3';

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        className={`inline-block rounded-full ${dotSize} ${levelColors[health.level]}`}
        title={`Health: ${health.score}/100`}
      />
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-void-800 px-3 py-2 text-xs text-void-200 shadow-(--shadow-overlay)">
          <div className="mb-1 font-medium">
            Health: {health.score}/100 ({health.level})
          </div>
          {health.factors.map((f) => (
            <div key={f.name} className="text-void-400">
              {f.name}: {f.value}/{f.maxValue}
            </div>
          ))}
          <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-void-800" />
        </div>
      )}
    </div>
  );
}
