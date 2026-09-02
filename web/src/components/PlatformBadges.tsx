'use client';

import type { PlatformDetection } from '@/lib/types';
import { useProviders, shortProviderLabel } from '@/lib/use-providers';

interface PlatformBadgesProps {
  platforms?: PlatformDetection;
}

// Neutral styling for a provider the registry hasn't described (or before the
// registry has loaded) — never throw on an unknown key.
const FALLBACK_BADGE = {
  bg: 'bg-void-700/60',
  text: 'text-void-200',
};

export function PlatformBadges({ platforms }: PlatformBadgesProps) {
  const { providers } = useProviders();
  if (!platforms) return null;

  const detected = Object.entries(platforms).filter(([, enabled]) => enabled);
  if (detected.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {detected.map(([key]) => {
        const entry = providers.find(p => p.id === key);
        const style = entry?.color?.tailwind ?? FALLBACK_BADGE;
        const label = entry ? shortProviderLabel(entry) : key;
        return (
          <span
            key={key}
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
