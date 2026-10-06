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
export declare const EXPIRY_WARNING_DAYS = 30;
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
export declare function recipeKind(recipe: VoiceRecipe | null | undefined): RecipeKind;
export declare function isCustomVoiceId(id: string): boolean;
export type ExpiryState = {
    state: 'ok' | 'expiring' | 'expired';
    days: number;
    date: string;
};
/** Where a stored expiry date stands today. Null when there is no (valid) date. */
export declare function expiryState(expiresAt: string | undefined, now?: number): ExpiryState | null;
/** The fix for a custom voice that is expiring, expired or gone; `projectId` targets the commands at one project. */
export declare function customVoiceFix(voiceId: string, recipe: boolean | RecipeKind, projectId?: string): string;
/** One warning line for a voice within the warning window or past it; null when fine. */
export declare function expiryWarning(owner: string, voice: {
    id: string;
    name: string;
    expiresAt?: string;
}, hasRecipe: boolean | RecipeKind, now?: number, projectId?: string): string | null;
/** The render error for an unusable custom voice, with the right fix. */
export declare function unusableVoiceMessage(providerLabel: string, why: 'expired' | 'missing', voice: {
    id: string;
    name: string;
    expiresAt?: string;
}, hasRecipe: boolean | RecipeKind): string;
/** The message when --recreate has nothing to rebuild from. */
export declare function noRecipeMessage(voiceId: string): string;
/** The message when `voice design --recreate` is pointed at a cloned voice. */
export declare function clonedRecreateMessage(voiceId: string, name: string): string;
/** File-name slug for a design sample. */
export declare function sampleSlug(name: string): string;
