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
export function recipeKind(recipe) {
    if (!recipe)
        return null;
    return recipe.type === 'replicated' ? 'cloned' : 'designed';
}
/** Older callers pass a boolean ("has a recipe" = a designed voice's). */
function kindOf(recipe) {
    return recipe === true ? 'designed' : recipe === false ? null : recipe;
}
export function isCustomVoiceId(id) {
    return id.startsWith('voice_');
}
/** Where a stored expiry date stands today. Null when there is no (valid) date. */
export function expiryState(expiresAt, now = Date.now()) {
    if (!expiresAt)
        return null;
    const at = Date.parse(expiresAt);
    if (!Number.isFinite(at))
        return null;
    const days = Math.ceil((at - now) / DAY_MS);
    const date = new Date(at).toISOString().slice(0, 10);
    if (at <= now)
        return { state: 'expired', days, date };
    return { state: days <= EXPIRY_WARNING_DAYS ? 'expiring' : 'ok', days, date };
}
/** The fix for a custom voice that is expiring, expired or gone; `projectId` targets the commands at one project. */
export function customVoiceFix(voiceId, recipe, projectId) {
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
export function expiryWarning(owner, voice, hasRecipe, now = Date.now(), projectId) {
    const st = expiryState(voice.expiresAt, now);
    if (!st || st.state === 'ok')
        return null;
    const when = st.state === 'expired'
        ? `expired on ${st.date}`
        : `expires on ${st.date} (${st.days === 1 ? 'tomorrow' : `in ${st.days} days`})`;
    return `${owner} voice '${voice.name}' (${voice.id}) ${when}: ${customVoiceFix(voice.id, hasRecipe, projectId)}.`;
}
/** The render error for an unusable custom voice, with the right fix. */
export function unusableVoiceMessage(providerLabel, why, voice, hasRecipe) {
    const what = why === 'expired'
        ? `custom voice '${voice.name}' (${voice.id}) expired${voice.expiresAt ? ` on ${voice.expiresAt.slice(0, 10)}` : ''}`
        : `custom voice '${voice.name}' (${voice.id}) no longer exists`;
    const fix = customVoiceFix(voice.id, hasRecipe);
    return `TTS provider (${providerLabel}): ${what}. To fix it, ${fix}.`;
}
/** The message when --recreate has nothing to rebuild from. */
export function noRecipeMessage(voiceId) {
    return `No recipe for ${voiceId}; run voice design "<description>" --name <name> to make a new voice.`;
}
/** The message when `voice design --recreate` is pointed at a cloned voice. */
export function clonedRecreateMessage(voiceId, name) {
    return `${name} (${voiceId}) is a cloned voice, and its recordings aren't kept. Clone it again from new recordings: Voice Settings → Change → Clone, or sly-messaging voice clone --sample <file.wav> --consent <file.wav> --recreate ${voiceId}.`;
}
/** File-name slug for a design sample. */
export function sampleSlug(name) {
    const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return slug || 'voice';
}
//# sourceMappingURL=custom-voices.js.map