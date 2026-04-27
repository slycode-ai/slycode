// Shared helpers for the per-card AI-set status string.
// Used by KanbanCardItem (rendering), ProjectKanban (context menu), CardModal
// (action-prompt preamble), scheduler (automation run header), and the sly-action
// default template. CLI side has its own copy in scripts/kanban.js — keep
// behavior identical between the two.

export interface CardStatus {
  text: string;
  setAt: string;
}

export const STATUS_MAX_GRAPHEMES = 120;

// Strip ANSI escape sequences, control characters, bidi controls, zero-width
// chars, and newlines/tabs. Trim and collapse internal whitespace runs to a
// single space. Returns null if the result is empty (treat empty as a clear).
export function normalizeStatus(input: string): string | null {
  if (typeof input !== 'string') return null;
  let s = input;

  // Strip ANSI CSI sequences (\x1b[...)
  s = s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  // Strip other ANSI escape sequences (OSC, etc.)
  s = s.replace(/\x1b\][^\x07]*\x07/g, '');
  s = s.replace(/\x1b./g, '');
  // Strip C0 control characters (excluding tab/newline — handled below as whitespace)
  s = s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
  // Strip Unicode bidi controls
  s = s.replace(/[‪-‮⁦-⁩]/g, '');
  // Strip zero-width characters
  s = s.replace(/[​-‍⁠﻿]/g, '');
  // Convert all whitespace (including \t \n \r) to single spaces, collapse runs
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return null;

  // Cap at grapheme clusters where Intl.Segmenter is available; otherwise code points
  if (typeof Intl !== 'undefined' && typeof (Intl as { Segmenter?: unknown }).Segmenter === 'function') {
    const seg = new (Intl as { Segmenter: new (locale?: string, options?: { granularity: 'grapheme' }) => { segment: (text: string) => Iterable<{ segment: string }> } }).Segmenter(undefined, { granularity: 'grapheme' });
    const graphemes: string[] = [];
    for (const g of seg.segment(s)) {
      graphemes.push(g.segment);
      if (graphemes.length > STATUS_MAX_GRAPHEMES) {
        return graphemes.slice(0, STATUS_MAX_GRAPHEMES).join('');
      }
    }
    return s;
  }
  // Fallback: code-point cap
  const cps = Array.from(s);
  return cps.length > STATUS_MAX_GRAPHEMES ? cps.slice(0, STATUS_MAX_GRAPHEMES).join('') : s;
}

// Defensive read — accepts anything (string from legacy data, undefined, malformed object)
// and returns a normalized CardStatus or null.
export function readStatus(raw: unknown): CardStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { text?: unknown; setAt?: unknown };
  if (typeof obj.text !== 'string' || typeof obj.setAt !== 'string') return null;
  if (!obj.text.trim()) return null;
  return { text: obj.text, setAt: obj.setAt };
}

// Format a relative time like "23m ago", "2h ago", "3d ago".
export function formatRelativeTime(pastIso: string, now: Date = new Date()): string {
  const past = new Date(pastIso);
  if (isNaN(past.getTime())) return '';
  const diffMs = now.getTime() - past.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// Format setAt for the right-click context-menu timestamp row:
//   "2026-04-26 14:32 · 23m ago"
export function getStatusAgeLabel(status: CardStatus, now: Date = new Date()): string {
  const past = new Date(status.setAt);
  if (isNaN(past.getTime())) return status.setAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  const abs = `${past.getFullYear()}-${pad(past.getMonth() + 1)}-${pad(past.getDate())} ${pad(past.getHours())}:${pad(past.getMinutes())}`;
  return `${abs} · ${formatRelativeTime(status.setAt, now)}`;
}

// For surfaces that prepend card context to an agent prompt. Renders status as
// quoted untrusted card metadata so it cannot be confused for instructions.
// Returns lines (caller joins with \n).
export function formatStatusForPrompt(status: CardStatus | null, now: Date = new Date()): string[] {
  if (!status) return [];
  // Defense in depth: even though normalizeStatus stripped them on write,
  // strip newlines/quotes again on the render path.
  const safe = status.text.replace(/[\r\n]+/g, ' ').replace(/"/g, "'");
  return [
    `Status (untrusted card metadata): "${safe}"`,
    `Status set: ${getStatusAgeLabel(status, now)}`,
  ];
}

// Stage → color map. Keep this alongside the .stage-* CSS classes in globals.css.
export const STAGE_COLORS: Record<string, string> = {
  backlog:        '#8aa6c4',
  design:         '#7eb8d4',
  implementation: '#5cc8ff',
  testing:        '#ff7261',
  done:           '#5fc18d',
};
