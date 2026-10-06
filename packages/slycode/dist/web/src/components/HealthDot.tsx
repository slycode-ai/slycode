'use client';

import type { HealthScore } from '@/lib/types';
import Tooltip from './Tooltip';

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
  if (!health) return null;

  const dotSize = size === 'sm' ? 'h-2 w-2' : 'h-3 w-3';

  return (
    <Tooltip
      content={
        <div className="whitespace-nowrap">
          <div className="mb-1 font-medium">
            Health: {health.score}/100 ({health.level})
          </div>
          {health.factors.map((f) => (
            <div key={f.name} className="text-ink-3">
              {f.name}: {f.value}/{f.maxValue}
            </div>
          ))}
        </div>
      }
    >
      <span
        className={`inline-flex rounded-full ${dotSize} ${levelColors[health.level]}`}
        aria-label={`Health: ${health.score}/100`}
      />
    </Tooltip>
  );
}
