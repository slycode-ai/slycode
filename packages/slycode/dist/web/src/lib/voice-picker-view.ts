/**
 * Web voice picker (feature 087 phase 3): pure view logic for the "Project
 * voices" picker in Voice Settings and its /api/messaging/voices proxies.
 *
 *  - Every search result and the project list carry the provider and switch
 *    revision they were fetched under (a Stamp). Set and preview send the
 *    stamp back; messaging answers 409 stale_provider when the install's
 *    provider changed since, and the picker refreshes instead of writing a
 *    voice into the wrong provider's slot.
 *  - Gemini gets gender and accent chips (accent = regional English, filtered
 *    by language code, which the catalogue tags reliably).
 *
 * No React, no fetch: the routes and the component both import from here.
 */

import type { SpeechProviderId } from './speech-health';
import { isSpeechProviderId, providerLabel } from './tts-provider-view';
import { CLONE_CONSENT_SECONDS, CLONE_SAMPLE_SECONDS, CLONE_SECONDS_TOLERANCE, consentFor, consentLocaleFor } from './consent-statements';

export const VOICES_DOWN_MESSAGE = 'The messaging service is not running. Start it to choose voices.';
export const STALE_PICK_MESSAGE = 'Provider changed; results refreshed.';
/** Messaging returns at most this many matches per search. */
export const SEARCH_PAGE_LIMIT = 50;

export interface Stamp {
  provider: SpeechProviderId;
  revision: number;
}

export interface PickerVoice {
  id: string;
  name: string;
  /** studio | library | custom (Gemini); premade | personal | community … (ElevenLabs). */
  category: string;
  description: string;
  accent: string | null;
  gender: string | null;
  /** A ready-made https sample (ElevenLabs); otherwise preview renders through messaging. */
  previewUrl: string | null;
  /** Designed (custom) voices expire a year after they are made. */
  expiresAt?: string | null;
  /** Custom voices only: how it was made (#0376). */
  origin?: 'designed' | 'cloned' | null;
  stamp: Stamp;
}

export type VoiceSource = 'project' | 'inherited' | 'env' | 'builtin';

export interface ProjectVoiceRow {
  projectId: string;
  name: string;
  voice: { id: string; name: string } | null;
  source: VoiceSource | null;
}

export const GENDER_CHIPS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
];

export const ACCENT_CHIPS: ReadonlyArray<{ language: string; label: string }> = [
  { language: 'en-US', label: 'American' },
  { language: 'en-GB', label: 'British' },
  { language: 'en-AU', label: 'Australian' },
  { language: 'en-IE', label: 'Irish' },
  { language: 'en-CA', label: 'Canadian' },
  { language: 'en-IN', label: 'Indian' },
  { language: 'en-NZ', label: 'New Zealand' },
  { language: 'en-ZA', label: 'South African' },
];

export interface SearchFilters {
  text: string;
  gender: string | null;
  language: string | null;
}

/**
 * Query string for /api/messaging/voices. It never names a provider: messaging
 * searches the ACTIVE one and stamps the answer, so a pick can't target an
 * inactive provider. `chipsFor` is the provider the chips were shown for;
 * chips only apply on Gemini (ElevenLabs search is by text).
 */
export function searchQuery(chipsFor: SpeechProviderId | null, filters: SearchFilters): string {
  const params = new URLSearchParams();
  const provider = chipsFor;
  const text = filters.text.trim();
  if (text) params.set('q', text);
  if (provider === 'gemini') {
    if (filters.gender) params.set('gender', filters.gender);
    if (filters.language) params.set('language', filters.language);
  }
  return params.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function bodyMessage(body: unknown): string | null {
  return isRecord(body) ? str(body.message) : null;
}

function readStamp(body: Record<string, unknown>): Stamp | null {
  if (!isSpeechProviderId(body.provider) || typeof body.revision !== 'number') return null;
  return { provider: body.provider, revision: body.revision };
}

/** A non-2xx (or unreadable) answer from any picker route, as one line to show. */
function failureMessage(status: number, body: unknown): string {
  if (status === 503) return bodyMessage(body) ?? VOICES_DOWN_MESSAGE;
  return bodyMessage(body) ?? `The messaging service answered HTTP ${status}.`;
}

export type SearchResult =
  | { kind: 'ok'; stamp: Stamp; voices: PickerVoice[]; truncated: boolean }
  | { kind: 'stale'; message: string }
  | { kind: 'error'; message: string };

export function interpretSearchResponse(status: number, body: unknown): SearchResult {
  // A switch landed while messaging was searching: refresh, never show old-provider rows.
  if (status === 409 && isRecord(body) && body.error === 'stale_provider') return { kind: 'stale', message: STALE_PICK_MESSAGE };
  if (status < 200 || status >= 300 || !isRecord(body) || body.ok === false) return { kind: 'error', message: failureMessage(status, body) };
  const stamp = readStamp(body);
  if (!stamp || !Array.isArray(body.voices)) return { kind: 'error', message: 'The messaging service sent an unexpected voice list. Restart it so it runs the current version of SlyCode.' };
  const voices: PickerVoice[] = [];
  for (const raw of body.voices) {
    if (!isRecord(raw)) continue;
    const id = str(raw.voice_id);
    if (!id) continue;
    const labels = isRecord(raw.labels) ? raw.labels : {};
    const preview = str(raw.preview_url);
    voices.push({
      id,
      name: str(raw.name) ?? id,
      category: str(raw.category) ?? '',
      description: str(raw.description) ?? '',
      accent: str(labels.accent),
      gender: str(labels.gender),
      previewUrl: preview && preview.startsWith('https://') ? preview : null,
      expiresAt: str(raw.expiresAt),
      origin: labels.origin === 'cloned' || labels.origin === 'designed' ? labels.origin : null,
      stamp,
    });
  }
  return { kind: 'ok', stamp, voices, truncated: body.voices.length >= SEARCH_PAGE_LIMIT };
}

const SOURCES: readonly VoiceSource[] = ['project', 'inherited', 'env', 'builtin'];

function readVoice(value: unknown): { id: string; name: string } | null {
  if (!isRecord(value)) return null;
  const id = str(value.id);
  return id ? { id, name: str(value.name) ?? id } : null;
}

function readRow(raw: unknown): ProjectVoiceRow | null {
  if (!isRecord(raw)) return null;
  const projectId = str(raw.projectId);
  if (!projectId) return null;
  return {
    projectId,
    name: str(raw.name) ?? projectId,
    voice: readVoice(raw.effective),
    source: SOURCES.includes(raw.source as VoiceSource) ? (raw.source as VoiceSource) : null,
  };
}

/** The voice every project without its own uses, and where it comes from. */
export interface InstallDefault {
  voice: { id: string; name: string } | null;
  /** state = chosen in SlyCode (Telegram /voice), env = .env, builtin = the provider's own default. */
  source: 'state' | 'env' | 'builtin' | null;
}

export type ProjectsResult =
  | { kind: 'ok'; stamp: Stamp; rows: ProjectVoiceRow[]; installDefault: InstallDefault }
  | { kind: 'error'; message: string };

function readInstallDefault(value: unknown): InstallDefault {
  if (!isRecord(value)) return { voice: null, source: null };
  const source = value.source === 'state' || value.source === 'env' || value.source === 'builtin' ? value.source : null;
  return { voice: readVoice(value.voice), source };
}

export function interpretProjectsResponse(status: number, body: unknown): ProjectsResult {
  if (status === 404) return { kind: 'error', message: 'This version of the messaging service has no voice picker. Restart it so it runs the current version of SlyCode.' };
  if (status < 200 || status >= 300 || !isRecord(body) || body.ok === false) return { kind: 'error', message: failureMessage(status, body) };
  const stamp = readStamp(body);
  if (!stamp || !Array.isArray(body.projects)) return { kind: 'error', message: 'The messaging service sent an unexpected project list. Restart it so it runs the current version of SlyCode.' };
  const rows = body.projects.map(readRow).filter((r): r is ProjectVoiceRow => r !== null);
  return { kind: 'ok', stamp, rows, installDefault: readInstallDefault(body.installDefault) };
}

export type ChangeResult =
  | { kind: 'done'; voice: { id: string; name: string } | null; source: VoiceSource | null }
  | { kind: 'stale'; message: string }
  | { kind: 'error'; message: string };

/** A PUT (set) or DELETE (reset) answer from /api/messaging/voices/projects/:id. */
export function interpretChangeResponse(status: number, body: unknown): ChangeResult {
  if (status === 409 && isRecord(body) && body.error === 'stale_provider') return { kind: 'stale', message: STALE_PICK_MESSAGE };
  if (status < 200 || status >= 300 || !isRecord(body) || body.ok === false) return { kind: 'error', message: failureMessage(status, body) };
  return {
    kind: 'done',
    voice: readVoice(body.effective),
    source: SOURCES.includes(body.source as VoiceSource) ? (body.source as VoiceSource) : null,
  };
}

/** Why a preview didn't play: stale (refresh the picker) or a message for the row. */
export function interpretPreviewFailure(status: number, body: unknown): { kind: 'stale'; message: string } | { kind: 'error'; message: string } {
  if (status === 409 && isRecord(body) && body.error === 'stale_provider') return { kind: 'stale', message: STALE_PICK_MESSAGE };
  if (status === 404 && !(isRecord(body) && typeof body.error === 'string')) {
    return { kind: 'error', message: 'Previews need the current messaging service. Restart it so it runs the current version of SlyCode.' };
  }
  return { kind: 'error', message: failureMessage(status, body) };
}

/** The body for a set: the voice and the stamp it was found under. */
export function setBody(voice: PickerVoice): { voiceId: string; voiceName: string; provider: SpeechProviderId; revision: number } {
  return { voiceId: voice.id, voiceName: voice.name, provider: voice.stamp.provider, revision: voice.stamp.revision };
}

/** The body for a rendered preview. */
export function previewBody(voice: PickerVoice): { voiceId: string; voiceName: string; provider: SpeechProviderId; revision: number } {
  return setBody(voice);
}

/** Where a project's voice comes from, in the user's words. */
export function sourceText(source: VoiceSource | null): string {
  switch (source) {
    case 'project': return 'chosen for this project';
    case 'inherited': return 'install default';
    case 'env': return 'default from .env';
    case 'builtin': return 'built-in default';
    default: return 'no voice';
  }
}

/**
 * The picker opens on the project in view only (owner ruling, #0369): every
 * other registered project sits behind "Show other projects (N)". `current`
 * is null when the view has no project (global page) or it isn't registered.
 */
export function splitProjects(rows: ProjectVoiceRow[], currentProjectId: string | null | undefined): { current: ProjectVoiceRow | null; others: ProjectVoiceRow[] } {
  const current = currentProjectId ? rows.find((r) => r.projectId === currentProjectId) ?? null : null;
  return { current, others: current ? rows.filter((r) => r !== current) : rows };
}

/** The project id when the page is /project/<id>[/...]; null elsewhere (global page, viewers). */
export function projectIdFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/project\/([^/]+)/.exec(pathname ?? '');
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export function othersToggleLabel(count: number, hasCurrent: boolean, expanded: boolean): string {
  if (expanded) return hasCurrent ? 'Hide other projects' : 'Hide projects';
  return hasCurrent ? `Show other projects (${count})` : `Show projects (${count})`;
}

/**
 * The install default as a pickable row (#0376): it lives at the top of the
 * expanded project list, with Change, because it governs every project that
 * has no voice of its own. The id is a sentinel no registered project can
 * have; picks for it go to the install-default route.
 */
export const INSTALL_DEFAULT_ROW_ID = '__install_default__';

export function installDefaultRow(d: InstallDefault): ProjectVoiceRow {
  return { projectId: INSTALL_DEFAULT_ROW_ID, name: 'the install default', voice: d.voice, source: null };
}

export function isInstallDefaultRow(row: { projectId: string }): boolean {
  return row.projectId === INSTALL_DEFAULT_ROW_ID;
}

/** Where a set for this row goes. */
export function changeVoiceUrl(row: { projectId: string }): string {
  return isInstallDefaultRow(row) ? '/api/messaging/voices/default' : `/api/messaging/voices/projects/${encodeURIComponent(row.projectId)}`;
}

/**
 * A project row's voice line: its own voice says where it came from
 * ("Aimy, chosen for this project"); an inherited one reads
 * "Zuri (install default)".
 */
export function rowVoiceText(row: ProjectVoiceRow): string {
  if (!row.voice) return 'No voice';
  if (row.source === 'project') return `${row.voice.name}, ${sourceText(row.source)}`;
  return row.source ? `${row.voice.name} (install default)` : row.voice.name;
}

/** Where the install default comes from, in the user's words. */
export function installDefaultSource(source: InstallDefault['source']): string {
  switch (source) {
    case 'state': return 'last chosen in Telegram';
    case 'env': return 'from .env';
    case 'builtin': return 'built-in';
    default: return 'none set';
  }
}

/** The second line of a result row: what the voice sounds like, then where it's from. */
export function voiceDetail(v: PickerVoice): string {
  const parts: string[] = [];
  // Custom voices say how they were made, with their expiry, ahead of anything else.
  if (v.category === 'custom') {
    const made = v.origin === 'cloned' ? 'Cloned' : 'Designed';
    parts.push(v.expiresAt ? `${made}, expires ${formatExpiry(v.expiresAt)}` : made);
  }
  if (v.description) parts.push(v.description.replace(/\.$/, ''));
  const accent = v.accent && !v.description.toLowerCase().includes(v.accent.toLowerCase()) ? v.accent : null;
  if (accent) parts.push(accent);
  if (!parts.length && v.category) parts.push(v.category[0].toUpperCase() + v.category.slice(1));
  return parts.join(', ');
}

export function searchPlaceholder(provider: SpeechProviderId | null): string {
  return provider ? `Search ${providerLabel(provider)} voices` : 'Search voices';
}

/** "No matches" text that says what to change. */
export function emptyResultsText(filters: SearchFilters): string {
  const chips = !!(filters.gender || filters.language);
  if (filters.text.trim() && chips) return `No voices match "${filters.text.trim()}" with these filters. Clear a filter or try another word.`;
  if (filters.text.trim()) return `No voices match "${filters.text.trim()}". Try another word.`;
  if (chips) return 'No voices match these filters. Clear one to see more.';
  return 'No voices found.';
}

// --- Voice design (feature 087, web) -----------------------------------------

export const DESIGN_GENDERS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'female', label: 'Female' },
  { id: 'male', label: 'Male' },
  { id: 'neutral', label: 'Neutral' },
];

export const DESIGN_HINT = 'Keywords or a sentence, e.g. "warm, dry-witted Australian engineer, mid-40s"';
export const DESIGN_COST_NOTE = 'Costs about 3¢ at Google and takes about 20 seconds.';
/** What a design usually takes; the progress bar fills towards it and waits. */
export const DESIGN_EXPECTED_SECONDS = 22;

export interface DesignForm {
  description: string;
  name: string;
  gender: string | null;
  language: string | null;
}

/** Why the form can't be sent yet, or null. Mirrors messaging's own checks so a slip never costs a call. */
export function designFormProblem(form: DesignForm): string | null {
  if (!form.description.trim()) return 'Describe the voice first.';
  if (form.description.trim().length > 2000) return 'The description is too long (2,000 characters at most).';
  if (!form.name.trim()) return 'Give the voice a name.';
  if (form.name.trim().length > 100) return 'The name is too long (100 characters at most).';
  return null;
}

/** The request for /api/messaging/voices/design: the form plus the list's revision. */
export function designBody(form: DesignForm, stamp: Stamp): Record<string, unknown> {
  return {
    description: form.description.trim(),
    name: form.name.trim(),
    revision: stamp.revision,
    ...(form.gender ? { gender: form.gender } : {}),
    ...(form.language ? { language: form.language } : {}),
  };
}

export type DesignResult =
  | { kind: 'designed'; voice: { id: string; name: string; expiresAt: string | null }; sample: { contentType: string; data: string } | null; warnings: string[] }
  | { kind: 'stale'; message: string }
  | { kind: 'error'; message: string };

export function interpretDesignResponse(status: number, body: unknown): DesignResult {
  if (status === 409 && isRecord(body) && body.error === 'stale_provider') return { kind: 'stale', message: STALE_PICK_MESSAGE };
  if (status < 200 || status >= 300 || !isRecord(body) || body.ok === false) return { kind: 'error', message: failureMessage(status, body) };
  const v = isRecord(body.voice) ? body.voice : null;
  const id = v ? str(v.id) : null;
  if (!v || !id) return { kind: 'error', message: 'The messaging service sent no voice back. Reopen the voice list to see whether it was made.' };
  const sample = isRecord(body.sample) && str(body.sample.data) && str(body.sample.contentType)?.startsWith('audio/')
    ? { contentType: str(body.sample.contentType)!, data: str(body.sample.data)! }
    : null;
  return {
    kind: 'designed',
    voice: { id, name: str(v.name) ?? id, expiresAt: str(v.expiresAt) },
    sample,
    warnings: Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === 'string') : [],
  };
}

/** The designed voice as a list row, so "Use for this project" goes through the normal (stamped) set. */
export function designedAsPickerVoice(voice: { id: string; name: string; expiresAt: string | null }, form: DesignForm, stamp: Stamp): PickerVoice {
  return {
    id: voice.id, name: voice.name, category: 'custom', description: form.description.trim(),
    accent: null, gender: form.gender, previewUrl: null, expiresAt: voice.expiresAt, stamp,
  };
}

/** 4 Oct 2027 — unambiguous in any locale. */
export function formatExpiry(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// --- Voice cloning (#0376, web) ----------------------------------------------

export const CLONE_COST_NOTE = 'Costs a few cents at Google and takes about 30 seconds. Google keeps the voice for a year; your recordings are sent once and not kept.';
/** What a clone usually takes; the progress bar fills towards it and waits. */
export const CLONE_EXPECTED_SECONDS = 25;

/** A finished take, already converted to 24 kHz mono WAV. */
export interface CloneTake {
  wavBase64: string;
  seconds: number;
}

export interface CloneForm {
  name: string;
  locale: string;
  sample: CloneTake | null;
  consent: CloneTake | null;
}

/** Why the clone can't be sent yet, or null. Mirrors messaging's checks so a slip never costs a call. */
export function cloneFormProblem(form: CloneForm): string | null {
  const within = (t: CloneTake, r: { min: number; max: number }) =>
    t.seconds >= r.min - CLONE_SECONDS_TOLERANCE && t.seconds <= r.max + CLONE_SECONDS_TOLERANCE;
  if (!form.sample) return 'Record or upload your voice sample first.';
  if (!within(form.sample, CLONE_SAMPLE_SECONDS)) return `The sample is ${roundSeconds(form.sample.seconds)} s; Google needs ${CLONE_SAMPLE_SECONDS.min}–${CLONE_SAMPLE_SECONDS.max} s.`;
  if (!form.consent) return 'Record the consent statement.';
  if (!within(form.consent, CLONE_CONSENT_SECONDS)) return `The consent recording is ${roundSeconds(form.consent.seconds)} s; it needs ${CLONE_CONSENT_SECONDS.min}–${CLONE_CONSENT_SECONDS.max} s.`;
  if (!consentFor(form.locale)) return 'Choose the language you read the statement in.';
  if (!form.name.trim()) return 'Give the voice a name.';
  if (form.name.trim().length > 100) return 'The name is too long (100 characters at most).';
  return null;
}

/** One decimal, no trailing ".0". */
export function roundSeconds(seconds: number): string {
  return String(Math.round(seconds * 10) / 10);
}

/** The request for /api/messaging/voices/clone: both recordings, the name, the locale and the list's revision. */
export function cloneBody(form: CloneForm, stamp: Stamp): Record<string, unknown> {
  return {
    name: form.name.trim(),
    locale: form.locale,
    sample: form.sample?.wavBase64 ?? '',
    consent: form.consent?.wavBase64 ?? '',
    revision: stamp.revision,
  };
}

/** A clone answers in the design shape. */
export const interpretCloneResponse = interpretDesignResponse;

/** The cloned voice as a list row, so "Use for this project" goes through the normal (stamped) set. */
export function clonedAsPickerVoice(voice: { id: string; name: string; expiresAt: string | null }, stamp: Stamp): PickerVoice {
  return {
    id: voice.id, name: voice.name, category: 'custom', description: '', accent: null, gender: null,
    previewUrl: null, expiresAt: voice.expiresAt, origin: 'cloned', stamp,
  };
}

/** The consent locale to start on: the accent filter's language if Google has a statement for it, else en-US. */
export function initialConsentLocale(language: string | null | undefined): string {
  return consentLocaleFor(language);
}
