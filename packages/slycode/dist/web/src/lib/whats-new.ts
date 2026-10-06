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

function newest(entries: WhatsNewEntry[]): WhatsNewEntry | null {
  let best: WhatsNewEntry | null = null;
  for (const e of entries) {
    if (!best || (compareVersions(e.version, best.version) ?? 0) > 0) best = e;
  }
  return best;
}

/** Newest entry at or below the installed version (the footer reopen target). */
export function latestEntry(entries: WhatsNewEntry[], installed: string | null): WhatsNewEntry | null {
  return newest(entries.filter(e => {
    const c = compareVersions(e.version, installed);
    return c !== null && c <= 0;
  }));
}

/**
 * The splash to show on load: the newest entry with lastSeen < version <= installed.
 * lastSeen null means an install from before this feature, so the newest entry
 * at or below installed shows. Only ever one splash, never a stack.
 */
export function pickEntry(entries: WhatsNewEntry[], installed: string | null, lastSeen: string | null): WhatsNewEntry | null {
  const latest = latestEntry(entries, installed);
  if (!latest) return null;
  if (lastSeen === null) return latest;
  const c = compareVersions(latest.version, lastSeen);
  // An unparsable lastSeen is treated like a missing one.
  return c === null || c > 0 ? latest : null;
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
