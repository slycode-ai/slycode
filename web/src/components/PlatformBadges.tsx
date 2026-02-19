'use client';

import type { PlatformDetection } from '@/lib/types';

interface PlatformBadgesProps {
  platforms?: PlatformDetection;
}

const platformConfig = {
  claude: {
    label: 'Claude',
    bg: 'bg-blue-100 dark:bg-blue-900/40',
    text: 'text-blue-700 dark:text-blue-300',
  },
  gemini: {
    label: 'Gemini',
    bg: 'bg-purple-100 dark:bg-purple-900/40',
    text: 'text-purple-700 dark:text-purple-300',
  },
  codex: {
    label: 'Codex',
    bg: 'bg-emerald-100 dark:bg-emerald-900/40',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
} as const;

export function PlatformBadges({ platforms }: PlatformBadgesProps) {
  if (!platforms) return null;

  const detected = (Object.entries(platforms) as [keyof PlatformDetection, boolean][])
    .filter(([, enabled]) => enabled);

  if (detected.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {detected.map(([key]) => {
        const config = platformConfig[key];
        return (
          <span
            key={key}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${config.bg} ${config.text}`}
          >
            {config.label}
          </span>
        );
      })}
    </div>
  );
}
