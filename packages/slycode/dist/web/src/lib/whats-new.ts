/**
 * What's new release splash (feature #0379): content schema, validation and
 * the "which release notes should show" decision. Pure; no fs. The fs side
 * (content dir, state file, installed version) is whats-new.server.ts.
 *
 * Content is one JSON file per release, data/whats-new/<version>.json, copied
 * into the package at templates/whats-new/ by build/build-package.ts. A
 * version without a file never shows a splash.
 */
import { parseSemver } from './skill-update-status';
import { COMMUNITY_LINKS } from './community-links';

/** Icon keys the content may use; the modal maps each to a lucide icon. */
export const WHATS_NEW_ICONS = [
  'audio-lines', 'palette', 'smartphone', 'calendar-sync', 'sparkles',
  'shield-check', 'terminal', 'zap', 'message-circle', 'bug',
] as const;
export type WhatsNewIcon = (typeof WHATS_NEW_ICONS)[number];

export interface WhatsNewHighlight {
  icon: WhatsNewIcon;
  title: string;
  body: string;
}

export interface WhatsNewCta {
  title: string;
  body: string;
  label: string;
  /** Resolved https URL (named links like "discord" are resolved on validate). */
  url: string;
}

export interface WhatsNewEntry {
  version: string;
  /** YYYY-MM-DD, or YYYY-MM-xx while the day is not known yet. */
  date: string;
  headline: string;
  intro: string;
  highlights: WhatsNewHighlight[];
  footnote?: string;
  cta?: WhatsNewCta;
  /** File name in the same whats-new folder; replaces the built-in waveform hero. */
  image?: string;
}

/** Field length caps: they keep the splash from turning into a wall of text. */
export const WHATS_NEW_LIMITS = {
  headline: 60,
  intro: 220,
  highlightTitle: 28,
  highlightBody: 180,
  footnote: 140,
  ctaTitle: 48,
  ctaBody: 200,
  ctaLabel: 28,
} as const;

export const IMAGE_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.(webp|png|svg)$/i;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01]|xx)$/;

export type ValidateResult =
  | { ok: true; entry: WhatsNewEntry }
  | { ok: false; errors: string[] };

/** Compare two versions: 1 / 0 / -1, or null when either is unparsable. */
export function compareVersions(a: string | null | undefined, b: string | null | undefined): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  for (const k of ['major', 'minor', 'patch'] as const) {
    if (pa[k] !== pb[k]) return pa[k] > pb[k] ? 1 : -1;
  }
  return 0;
}

/** A content URL: a named community link, or an https URL. Null when neither. */
export function resolveContentUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  const named = (COMMUNITY_LINKS as Record<string, string>)[url.trim()];
  if (named) return named;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function text(raw: Record<string, unknown>, key: string, max: number, errors: string[], label = key): string | undefined {
  const v = raw[key];
  if (typeof v !== 'string' || !v.trim()) {
    errors.push(`${label}: required text`);
    return undefined;
  }
  const t = v.trim();
  if (t.length > max) errors.push(`${label}: ${t.length} chars, max ${max}`);
  return t;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate one content file. Unknown icons fall back to "sparkles" rather than
 * failing; everything else that is wrong is an error, and an entry with any
 * error is skipped (a broken file never renders a broken splash).
 */
export function validateEntry(raw: unknown): ValidateResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['root: expected an object'] };

  const version = text(raw, 'version', 32, errors);
  if (version && !parseSemver(version)) errors.push(`version: "${version}" is not a version`);
  const date = text(raw, 'date', 10, errors);
  if (date && !DATE_RE.test(date)) errors.push(`date: "${date}" must be YYYY-MM-DD or YYYY-MM-xx`);
  const headline = text(raw, 'headline', WHATS_NEW_LIMITS.headline, errors);
  const intro = text(raw, 'intro', WHATS_NEW_LIMITS.intro, errors);

  const highlights: WhatsNewHighlight[] = [];
  if (!Array.isArray(raw.highlights) || raw.highlights.length < 2 || raw.highlights.length > 4) {
    errors.push('highlights: 2 to 4 items');
  } else {
    raw.highlights.forEach((h, i) => {
      if (!isRecord(h)) { errors.push(`highlights[${i}]: expected an object`); return; }
      const title = text(h, 'title', WHATS_NEW_LIMITS.highlightTitle, errors, `highlights[${i}].title`);
      const body = text(h, 'body', WHATS_NEW_LIMITS.highlightBody, errors, `highlights[${i}].body`);
      const icon = (WHATS_NEW_ICONS as readonly string[]).includes(h.icon as string) ? (h.icon as WhatsNewIcon) : 'sparkles';
      if (title && body) highlights.push({ icon, title, body });
    });
  }

  let footnote: string | undefined;
  if (raw.footnote !== undefined) footnote = text(raw, 'footnote', WHATS_NEW_LIMITS.footnote, errors);

  let cta: WhatsNewCta | undefined;
  if (raw.cta !== undefined) {
    if (!isRecord(raw.cta)) {
      errors.push('cta: expected an object');
    } else {
      const title = text(raw.cta, 'title', WHATS_NEW_LIMITS.ctaTitle, errors, 'cta.title');
      const body = text(raw.cta, 'body', WHATS_NEW_LIMITS.ctaBody, errors, 'cta.body');
      const label = text(raw.cta, 'label', WHATS_NEW_LIMITS.ctaLabel, errors, 'cta.label');
      const url = resolveContentUrl(raw.cta.url);
      if (!url) errors.push('cta.url: an https URL or a named link (e.g. "discord")');
      if (title && body && label && url) cta = { title, body, label, url };
    }
  }

  let image: string | undefined;
  if (raw.image !== undefined) {
    if (typeof raw.image !== 'string' || !IMAGE_NAME_RE.test(raw.image)) {
      errors.push('image: a .webp, .png or .svg file name in the whats-new folder');
    } else {
      image = raw.image;
    }
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    entry: {
      version: version!, date: date!, headline: headline!, intro: intro!, highlights,
      ...(footnote ? { footnote } : {}),
      ...(cta ? { cta } : {}),
      ...(image ? { image } : {}),
    },
  };
}

/** Newest first. Unparsable versions never reach here (validateEntry rejects them). */
function newestFirst(entries: WhatsNewEntry[]): WhatsNewEntry[] {
  return [...entries].sort((a, b) => compareVersions(b.version, a.version) ?? 0);
}

/** True when lo < version <= hi; a null bound is open on that side. */
function inRange(version: string, lo: string | null, hi: string | null): boolean {
  if (lo !== null && (compareVersions(version, lo) ?? 0) <= 0) return false;
  if (hi !== null) {
    const c = compareVersions(version, hi);
    if (c === null || c > 0) return false;
  }
  return true;
}

/**
 * Every release with content at or below the installed version, newest first.
 * The footer reopen opens on the first (the current release) and pages back
 * through the rest. Empty when installed is unknown.
 */
export function historyEntries(entries: WhatsNewEntry[], installed: string | null): WhatsNewEntry[] {
  if (!installed || !parseSemver(installed)) return [];
  return newestFirst(entries.filter(e => inRange(e.version, null, installed)));
}

/** Newest entry at or below the installed version (the footer reopen target). */
export function latestEntry(entries: WhatsNewEntry[], installed: string | null): WhatsNewEntry | null {
  return historyEntries(entries, installed)[0] ?? null;
}

/**
 * The splash pages to show on load: every release with content where
 * lastSeen < version <= installed, newest first, so someone who jumps several
 * releases pages through all of them in one splash. Releases without a content
 * file simply aren't there. lastSeen null (an install from before this feature,
 * or an unparsable state file) means every entry at or below installed.
 */
export function unseenEntries(entries: WhatsNewEntry[], installed: string | null, lastSeen: string | null): WhatsNewEntry[] {
  const seen = lastSeen && parseSemver(lastSeen) ? lastSeen : null;
  return historyEntries(entries, installed).filter(e => inRange(e.version, seen, null));
}

/**
 * Authoring preview, independent of installed version and seen state:
 *   ?whatsnew=<v>                 → that one release
 *   ?whatsnew-from=<a>            → every release newer than a (a multi-page jump from a)
 *   ?whatsnew-from=<a>&whatsnew=<b> → releases in (a, b], like updating from a to b
 * Null when neither is given; an empty list when nothing matches.
 */
export function previewEntries(entries: WhatsNewEntry[], opts: { version?: string | null; from?: string | null }): WhatsNewEntry[] | null {
  const version = opts.version?.trim() || null;
  const from = opts.from?.trim() || null;
  if (!version && !from) return null;
  if (!from) {
    const one = findEntry(entries, version!);
    return one ? [one] : [];
  }
  if (!parseSemver(from) || (version && !parseSemver(version))) return [];
  return newestFirst(entries.filter(e => inRange(e.version, from, version)));
}

/** Entry for the ?whatsnew=<version> preview; "0.5" matches "0.5.0". */
export function findEntry(entries: WhatsNewEntry[], version: string): WhatsNewEntry | null {
  return entries.find(e => compareVersions(e.version, version) === 0) ?? null;
}

/** "0.5.0" → "0.5"; "0.5.2" stays. */
export function shortVersion(version: string): string {
  return version.replace(/^(\d+\.\d+)\.0$/, '$1');
}

/**
 * Pages where the splash may open on its own. Login/setup come before a
 * session; the doc and HTML viewers are single-document windows (and print
 * targets) where a release splash would be in the way. Reopen and
 * ?whatsnew= preview work anywhere.
 */
export function splashAllowedOnPath(pathname: string): boolean {
  return !/^\/(login|setup|doc-viewer|html-viewer)(\/|$)/.test(pathname);
}

/** Display date: "6 October 2026", or "October 2026" while the day is a placeholder. */
export function formatReleaseDate(date: string): string {
  const [y, m, d] = date.split('-');
  const month = new Date(Number(y), Number(m) - 1, 1).toLocaleString('en-GB', { month: 'long' });
  return d === 'xx' ? `${month} ${y}` : `${Number(d)} ${month} ${y}`;
}

/** Splash paging: move by delta, clamped to [0, count-1]. Page 0 is the newest release. */
export function stepPage(index: number, delta: number, count: number): number {
  return Math.min(Math.max(index + delta, 0), Math.max(count - 1, 0));
}
