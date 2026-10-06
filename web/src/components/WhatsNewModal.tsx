'use client';

import { useEffect, useId, useRef } from 'react';
import {
  AudioLines, Bug, CalendarSync, ExternalLink, MessageCircle, ShieldCheck, Smartphone, Sparkles, Terminal, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { formatReleaseDate, shortVersion, type WhatsNewEntry, type WhatsNewIcon } from '@/lib/whats-new';
import { useVisibleViewport } from '@/hooks/useVisibleViewport';

// ============================================================================
// Highlight visuals. Tile hue follows the reskin's one-meaning-per-hue rule:
// cyan = you/your voice, mint = working on the go, amber = scheduled.
// ============================================================================

const TILE = {
  accent: 'border-accent/30 bg-accent/10 text-accent',
  live: 'border-live/30 bg-live/10 text-live-text',
  agent: 'border-agent/30 bg-agent/10 text-agent-text',
  neutral: 'border-line-strong bg-surface-2 text-ink-2',
} as const;

const ICONS: Record<WhatsNewIcon, { Icon: LucideIcon | null; tile: keyof typeof TILE }> = {
  'audio-lines': { Icon: AudioLines, tile: 'accent' },
  palette: { Icon: null, tile: 'neutral' }, // drawn as the two-skin swatch below
  smartphone: { Icon: Smartphone, tile: 'live' },
  'calendar-sync': { Icon: CalendarSync, tile: 'agent' },
  sparkles: { Icon: Sparkles, tile: 'accent' },
  'shield-check': { Icon: ShieldCheck, tile: 'live' },
  terminal: { Icon: Terminal, tile: 'neutral' },
  zap: { Icon: Zap, tile: 'agent' },
  'message-circle': { Icon: MessageCircle, tile: 'accent' },
  bug: { Icon: Bug, tile: 'neutral' },
};

/** Half graphite, half paper, with the three meaning hues: both skins in one mark. */
function SkinSwatch() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
      <circle cx="13" cy="13" r="10" fill="#fafafa" stroke="#d4d4d8" />
      <path d="M13 3a10 10 0 0 0 0 20z" fill="#14171c" />
      <circle cx="8.6" cy="9.4" r="1.8" fill="#22c0ff" />
      <circle cx="8.6" cy="16.6" r="1.8" fill="#3ee6a8" />
      <circle cx="17.4" cy="13" r="1.8" fill="#c46200" />
    </svg>
  );
}

function HighlightTile({ icon }: { icon: WhatsNewIcon }) {
  const { Icon, tile } = ICONS[icon] ?? ICONS.sparkles;
  return (
    <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border ${TILE[tile]}`}>
      {Icon ? <Icon size={22} strokeWidth={1.75} aria-hidden /> : <SkinSwatch />}
    </div>
  );
}

// Speech-like envelope, deterministic so every render (and both themes) match.
const WAVE = Array.from({ length: 64 }, (_, i) => {
  const t = i / 64;
  const env = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.85 + 0.15;
  const v = Math.abs(Math.sin(i * 0.9) * 0.55 + Math.sin(i * 0.37 + 1) * 0.35 + Math.sin(i * 2.3) * 0.18);
  return { h: Math.max(6, Math.round(72 * Math.min(1, env * (0.25 + v)))), lit: i >= 17 && i <= 21 };
});

// Discord blurple is the one colour outside the token set: the invitation
// should read as Discord's, not as an app control.
const DISCORD_BTN = 'bg-[#5865F2] text-white hover:bg-[#4f5bd9]';
const DISCORD_TILE = 'border-[#5865F2]/35 bg-[#5865F2]/12 text-[#4752c4] dark:text-[#8f98ff]';

// ============================================================================
// Modal
// ============================================================================

interface WhatsNewModalProps {
  entry: WhatsNewEntry;
  onClose: () => void;
  /** "Full changelog": the gate closes the splash and opens ChangelogModal. */
  onOpenChangelog: () => void;
  /** Clicking the call to action counts as seeing the splash (it stays open). */
  onCtaClick?: () => void;
}

export function WhatsNewModal({ entry, onClose, onOpenChangelog, onCtaClick }: WhatsNewModalProps) {
  const headingId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const gotItRef = useRef<HTMLButtonElement>(null);
  const viewport = useVisibleViewport();

  // Focus "Got it" on open, restore focus on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    gotItRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  // Escape closes; Tab stays inside the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        style={viewport ? { maxHeight: viewport.height - 16 } : undefined}
        className="whats-new-panel flex max-h-[calc(100dvh-1rem)] w-full max-w-[600px] flex-col overflow-hidden rounded-t-2xl border border-line bg-surface-1 text-ink-1 shadow-(--shadow-overlay) max-sm:border-b-0 sm:max-h-[min(860px,calc(100dvh-3rem))] sm:rounded-2xl"
      >
        {/* Hero: version and a voice waveform that draws in once */}
        <div className="relative shrink-0 border-b border-line bg-surface-2 px-5 pb-4 pt-4 sm:px-6">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
            <img src="/slycode_logo_light.webp" alt="" className="h-[22px] w-[22px] object-contain mix-blend-multiply dark:hidden" />
            <img src="/slycode_logo.webp" alt="" className="hidden h-[22px] w-[22px] object-contain mix-blend-lighten dark:block" />
            SlyCode
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close what's new"
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink-1 max-sm:h-11 max-sm:w-11"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="mt-4 grid grid-cols-[auto_1fr] items-end gap-5">
            <div className="leading-none">
              <div className="text-[52px] font-semibold tracking-[-0.045em] tabular-nums sm:text-[64px]">
                {shortVersion(entry.version)}
              </div>
              <div className="mt-2 text-xs text-ink-3">Released {formatReleaseDate(entry.date)}</div>
            </div>
            {entry.image ? (
              <img
                src={`/api/whats-new/asset/${encodeURIComponent(entry.image)}`}
                alt=""
                className="h-[72px] w-full rounded-lg object-cover"
              />
            ) : (
              <div className="whats-new-wave flex h-14 min-w-0 items-center gap-[3px] overflow-hidden sm:h-[72px]" aria-hidden>
                {WAVE.map((b, i) => (
                  <i
                    key={i}
                    className={`block w-1 shrink-0 rounded-sm ${b.lit ? 'bg-live' : 'bg-accent'}`}
                    style={{ height: `${Math.round((b.h / 72) * 100)}%`, ['--n' as string]: i }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-1 pt-5 sm:px-6">
          <h2 id={headingId} className="max-w-[30ch] text-[21px] font-semibold leading-tight tracking-[-0.015em] sm:text-2xl">
            {entry.headline}
          </h2>
          <p className="mt-2.5 max-w-[60ch] text-[15px] leading-relaxed text-ink-2">{entry.intro}</p>

          <ul className="mt-5 grid grid-cols-1 border-t border-line sm:grid-cols-2">
            {entry.highlights.map((h, i) => (
              <li
                key={h.title}
                className={`grid grid-cols-[44px_1fr] items-start gap-3 border-b border-line py-3.5 sm:py-4 ${
                  i % 2 === 1 ? 'sm:border-l sm:pl-4' : 'sm:pr-4'
                }`}
              >
                <HighlightTile icon={h.icon} />
                <div>
                  <h3 className="mb-1 mt-px text-sm font-semibold">{h.title}</h3>
                  <p className="text-[13px] leading-normal text-ink-2">{h.body}</p>
                </div>
              </li>
            ))}
          </ul>

          {entry.footnote && <p className="mt-3.5 text-[13px] leading-normal text-ink-3">{entry.footnote}</p>}

          {entry.cta && (
            <div className="mb-4 mt-4 grid grid-cols-[44px_1fr] gap-3.5 rounded-xl border border-line bg-surface-2 p-4">
              <div className={`grid h-11 w-11 place-items-center rounded-xl border ${DISCORD_TILE}`}>
                <MessageCircle size={22} strokeWidth={1.75} aria-hidden />
              </div>
              <div>
                <h3 className="mb-1 mt-px text-[15px] font-semibold">{entry.cta.title}</h3>
                <p className="max-w-[54ch] text-[13px] leading-relaxed text-ink-2">{entry.cta.body}</p>
                <div className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-2">
                  <a
                    href={entry.cta.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={onCtaClick}
                    className={`inline-flex h-9 items-center gap-2 rounded-lg px-3.5 text-[13px] font-semibold transition-colors max-sm:h-11 ${DISCORD_BTN}`}
                  >
                    {entry.cta.label}
                    <ExternalLink size={14} strokeWidth={2} aria-hidden />
                  </a>
                  <span className="font-mono text-xs text-ink-3">{entry.cta.url.replace(/^https:\/\//, '').replace(/\/$/, '')}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Actions, pinned */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-1 px-5 py-3.5 max-sm:pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6">
          <button
            type="button"
            onClick={onOpenChangelog}
            className="py-1.5 text-[13px] text-ink-2 underline-offset-[3px] transition-colors hover:text-accent hover:underline max-sm:min-h-11"
          >
            Full changelog
          </button>
          <button
            ref={gotItRef}
            type="button"
            onClick={onClose}
            className="h-[38px] rounded-lg bg-primary px-5 text-sm font-semibold text-on-primary transition-[filter] hover:brightness-110 max-sm:h-11"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
