/**
 * Designed Gemini voices (feature 087 phase 4): the local recipe record and
 * the wording shared by every place that talks about a custom voice's
 * expiry or loss (voice show, health warnings, render errors, voice delete).
 *
 * Google can't extend a designed voice (1-year life) and `GET /voices/{id}`
 * fails once it is deleted, so the recipe is kept locally from creation:
 * `voice design --recreate <id>` rebuilds a similar (never identical) voice
 * from it. Fixes suggest --recreate ONLY when a recipe exists.
 *
 * Cloned voices (#0376) keep a recipe too, but only their name, consent
 * locale and dates: the two recordings are used for the create call and
 * never kept (owner ruling), so an expired clone is made again by recording
 * again, never by --recreate.
 */

/** Warn this many days before a custom voice expires. */
export const EXPIRY_WARNING_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** What `voice design` (or `voice clone`) used, kept in messaging-state.json under customVoices[id]. */
export interface VoiceRecipe {
  provider: 'gemini';
  /** prompted = designed from a description; replicated = cloned from recordings. Missing on older recipes = prompted. */
  type?: 'prompted' | 'replicated';
  name: string;
  /** The design description; empty for a clone. */
  description: string;
  /** Clone only: the consent statement's locale (e.g. en-AU). */
  locale?: string;
  gender?: string;
  language?: string;
  model: string;
  createdAt: string;
  expiresAt?: string;
  /** Removed at Google with `voice delete`; the recipe is kept so it can be recreated. */
  deleted?: boolean;
  deletedAt?: string;
  /** Set when this voice was rebuilt from another voice's recipe. */
  recreatedFrom?: string;
  /** Set on the old recipe when --recreate made a replacement. */
  replacedBy?: string;
}

/** What a stored recipe can do for an expired or lost voice: rebuild it (designed), re-record it (cloned), or nothing. */
export type RecipeKind = 'designed' | 'cloned' | null;

export function recipeKind(recipe: VoiceRecipe | null | undefined): RecipeKind {
  if (!recipe) return null;
  return recipe.type === 'replicated' ? 'cloned' : 'designed';
}

/** Older callers pass a boolean ("has a recipe" = a designed voice's). */
function kindOf(recipe: boolean | RecipeKind): RecipeKind {
  return recipe === true ? 'designed' : recipe === false ? null : recipe;
}

export function isCustomVoiceId(id: string): boolean {
  return id.startsWith('voice_');
}

export type ExpiryState = { state: 'ok' | 'expiring' | 'expired'; days: number; date: string };

/** Where a stored expiry date stands today. Null when there is no (valid) date. */
export function expiryState(expiresAt: string | undefined, now = Date.now()): ExpiryState | null {
  if (!expiresAt) return null;
  const at = Date.parse(expiresAt);
  if (!Number.isFinite(at)) return null;
  const days = Math.ceil((at - now) / DAY_MS);
  const date = new Date(at).toISOString().slice(0, 10);
  if (at <= now) return { state: 'expired', days, date };
  return { state: days <= EXPIRY_WARNING_DAYS ? 'expiring' : 'ok', days, date };
}

/** The fix for a custom voice that is expiring, expired or gone; `projectId` targets the commands at one project. */
export function customVoiceFix(voiceId: string, recipe: boolean | RecipeKind, projectId?: string): string {
  const project = projectId ? ` --project ${projectId}` : '';
  const kind = kindOf(recipe);
  if (kind === 'cloned') {
    return `clone it again from new recordings (Voice Settings → Change → Clone, or \`sly-messaging voice clone --sample <file.wav> --consent <file.wav> --recreate ${voiceId} --set${project}\`; the old recordings aren't kept), or pick another with \`voice set <voice> --provider gemini${project}\``;
  }
  return kind === 'designed'
    ? `recreate it from its saved recipe with \`sly-messaging voice design --recreate ${voiceId} --set${project}\` (similar, not identical), or pick another with \`voice set <voice> --provider gemini${project}\``
    : `design a new one with \`sly-messaging voice design "<description>" --name <name> --set${project}\`, or pick another with \`voice set <voice> --provider gemini${project}\``;
}

/** One warning line for a voice within the warning window or past it; null when fine. */
export function expiryWarning(
  owner: string,
  voice: { id: string; name: string; expiresAt?: string },
  hasRecipe: boolean | RecipeKind,
  now = Date.now(),
  projectId?: string,
): string | null {
  const st = expiryState(voice.expiresAt, now);
  if (!st || st.state === 'ok') return null;
  const when = st.state === 'expired'
    ? `expired on ${st.date}`
    : `expires on ${st.date} (${st.days === 1 ? 'tomorrow' : `in ${st.days} days`})`;
  return `${owner} voice '${voice.name}' (${voice.id}) ${when}: ${customVoiceFix(voice.id, hasRecipe, projectId)}.`;
}

/** The render error for an unusable custom voice, with the right fix. */
export function unusableVoiceMessage(
  providerLabel: string,
  why: 'expired' | 'missing',
  voice: { id: string; name: string; expiresAt?: string },
  hasRecipe: boolean | RecipeKind,
): string {
  const what = why === 'expired'
    ? `custom voice '${voice.name}' (${voice.id}) expired${voice.expiresAt ? ` on ${voice.expiresAt.slice(0, 10)}` : ''}`
    : `custom voice '${voice.name}' (${voice.id}) no longer exists`;
  const fix = customVoiceFix(voice.id, hasRecipe);
  return `TTS provider (${providerLabel}): ${what}. To fix it, ${fix}.`;
}

/** The message when --recreate has nothing to rebuild from. */
export function noRecipeMessage(voiceId: string): string {
  return `No recipe for ${voiceId}; run voice design "<description>" --name <name> to make a new voice.`;
}

/** The message when `voice design --recreate` is pointed at a cloned voice. */
export function clonedRecreateMessage(voiceId: string, name: string): string {
  return `${name} (${voiceId}) is a cloned voice, and its recordings aren't kept. Clone it again from new recordings: Voice Settings → Change → Clone, or sly-messaging voice clone --sample <file.wav> --consent <file.wav> --recreate ${voiceId}.`;
}

/** File-name slug for a design sample. */
export function sampleSlug(name: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'voice';
}
