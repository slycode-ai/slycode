/**
 * Voice provider switch (feature 087): pure view logic for the "Voice
 * provider" control in Voice Settings and its /api/messaging/tts proxy.
 *
 *  - parseSpeechHealth: tolerant read of the messaging GET/PUT payload
 *    ({ ok, ...SpeechHealth }) into a clean SpeechHealth, or null.
 *  - providerOptions: one view row per provider (active / selectable / why not).
 *  - interpretSwitchResponse: maps a PUT answer (200 / 409 / 400 / 503 / …)
 *    to switched | refused | error with the message to show.
 *
 * No React, no fetch — the route and the component both import from here.
 */

import type { SpeechHealth, SpeechProviderId, SpeechProviderSource, SpeechProviderStatus } from './speech-health';

export const TTS_PROVIDERS: ReadonlyArray<{ id: SpeechProviderId; label: string; keyEnv: string }> = [
  { id: 'elevenlabs', label: 'ElevenLabs', keyEnv: 'ELEVENLABS_API_KEY' },
  { id: 'gemini', label: 'Gemini', keyEnv: 'GEMINI_API_KEY' },
];

export const MESSAGING_DOWN_MESSAGE = 'The messaging service is not running. Start it to change the voice provider.';
export const NOT_IN_THIS_VERSION = 'Not available in this version of SlyCode.';

export function isSpeechProviderId(value: unknown): value is SpeechProviderId {
  return TTS_PROVIDERS.some((p) => p.id === value);
}

export function providerLabel(id: SpeechProviderId): string {
  return TTS_PROVIDERS.find((p) => p.id === id)?.label ?? id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const SOURCES: readonly SpeechProviderSource[] = ['state', 'env', 'auto'];
const MISSING_PROVIDER: SpeechProviderStatus = { configured: false, available: false, defaultVoice: null, defaultVoiceSource: null };

function parseProviderStatus(value: unknown): SpeechProviderStatus {
  if (!isRecord(value)) return MISSING_PROVIDER;
  const dv = value.defaultVoice;
  const dvs = value.defaultVoiceSource;
  return {
    configured: value.configured === true,
    available: value.available === true,
    defaultVoice: isRecord(dv) && typeof dv.id === 'string' && typeof dv.name === 'string' ? { id: dv.id, name: dv.name } : null,
    defaultVoiceSource: dvs === 'state' || dvs === 'env' || dvs === 'builtin' ? dvs : null,
  };
}

/**
 * The SpeechHealth inside a messaging /tts/provider answer, or null when the
 * body isn't one (wrong shape, `ok: false`, unknown provider). A provider
 * missing from `providers` (older messaging build) reads as not available.
 */
export function parseSpeechHealth(body: unknown): SpeechHealth | null {
  if (!isRecord(body) || body.ok === false) return null;
  if (!isSpeechProviderId(body.provider) || !isRecord(body.providers)) return null;
  const providers = {} as Record<SpeechProviderId, SpeechProviderStatus>;
  for (const p of TTS_PROVIDERS) providers[p.id] = parseProviderStatus(body.providers[p.id]);
  const reason = isRecord(body.reason) && typeof body.reason.code === 'string' && typeof body.reason.message === 'string'
    ? { code: body.reason.code as NonNullable<SpeechHealth['reason']>['code'], message: body.reason.message }
    : null;
  return {
    provider: body.provider,
    providerSource: SOURCES.includes(body.providerSource as SpeechProviderSource) ? (body.providerSource as SpeechProviderSource) : 'auto',
    revision: typeof body.revision === 'number' ? body.revision : 0,
    ready: body.ready === true,
    reason,
    providers,
    warnings: Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === 'string') : [],
  };
}

function bodyMessage(body: unknown): string | null {
  return isRecord(body) && typeof body.message === 'string' && body.message.trim() ? body.message : null;
}

/** Map a GET /api/messaging/tts answer to the health to show, or why there is none. */
export function interpretLoadResponse(status: number, body: unknown): { health: SpeechHealth; error: null } | { health: null; error: string } {
  const health = status === 200 ? parseSpeechHealth(body) : null;
  if (health) return { health, error: null };
  const message = bodyMessage(body);
  if (message) return { health: null, error: message };
  if (status === 503) return { health: null, error: MESSAGING_DOWN_MESSAGE };
  return { health: null, error: `Couldn't read the voice provider from the messaging service (HTTP ${status}).` };
}

export interface ProviderOption {
  id: SpeechProviderId;
  label: string;
  /** The install's current provider. Never clickable. */
  active: boolean;
  /** Not active and cannot be picked right now (see `reason`). */
  disabled: boolean;
  /** Why this provider can't be used (not in this build, key missing, service unreachable); null when usable. */
  reason: string | null;
  /** Hover text for the option. */
  title: string;
}

/**
 * One row per provider. `health` null = not loaded yet or messaging
 * unreachable: nothing is active and nothing is selectable, and
 * `unreachableReason` (when given) explains why.
 */
export function providerOptions(health: SpeechHealth | null, unreachableReason: string | null = null): ProviderOption[] {
  return TTS_PROVIDERS.map(({ id, label, keyEnv }) => {
    if (!health) {
      const reason = unreachableReason ?? 'Checking the voice service…';
      return { id, label, active: false, disabled: true, reason, title: reason };
    }
    const status = health.providers[id];
    const reason = !status.available
      ? NOT_IN_THIS_VERSION
      : !status.configured
        ? `${keyEnv} is not set in .env. Add it, then restart the messaging service.`
        : null;
    const active = health.provider === id;
    const title = active
      ? `Spoken replies use ${label}.${reason ? ` ${reason}` : ''}`
      : reason ?? `Switch spoken replies to ${label}`;
    return { id, label, active, disabled: !active && reason !== null, reason, title };
  });
}

/** Subtle hint for where the active provider came from; null when not worth showing. */
export function providerSourceHint(source: SpeechProviderSource): { text: string; title: string } | null {
  if (source !== 'env') return null;
  return { text: 'from .env', title: 'Set by TTS_PROVIDER in .env. Picking a provider here overrides it.' };
}

export interface VoiceCheck {
  projectId: string;
  projectName: string;
  voice: { id: string; name: string } | null;
  reason: string;
}

export interface VoiceRefusal extends VoiceCheck {
  fix: string;
}

export type SwitchResult =
  | { kind: 'switched'; health: SpeechHealth; unverified: VoiceCheck[] }
  | { kind: 'refused'; message: string; refusals: VoiceRefusal[] }
  | { kind: 'error'; message: string };

function parseVoiceCheck(value: unknown): VoiceCheck | null {
  if (!isRecord(value)) return null;
  const projectId = typeof value.projectId === 'string' ? value.projectId : '';
  const projectName = typeof value.projectName === 'string' && value.projectName ? value.projectName : projectId;
  if (!projectName) return null;
  const v = value.voice;
  const voice = isRecord(v) && typeof v.name === 'string'
    ? { id: typeof v.id === 'string' ? v.id : '', name: v.name || (typeof v.id === 'string' ? v.id : '') }
    : null;
  return { projectId, projectName, voice, reason: typeof value.reason === 'string' ? value.reason : '' };
}

function parseList<T>(value: unknown, parse: (v: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const item of value) {
    const parsed = parse(item);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Map a PUT /api/messaging/tts answer to what the control shows. */
export function interpretSwitchResponse(status: number, body: unknown): SwitchResult {
  const message = bodyMessage(body);
  if (status === 200) {
    const health = parseSpeechHealth(body);
    if (health) {
      const unverified = parseList(isRecord(body) ? body.unverified : undefined, parseVoiceCheck);
      return { kind: 'switched', health, unverified };
    }
    return { kind: 'error', message: message ?? 'The messaging service sent an answer the app could not read. Close and reopen Voice Settings to see the current provider.' };
  }
  if (status === 409 && isRecord(body) && body.error === 'unusable_voices') {
    const refusals = parseList(body.refusals, (v) => {
      const check = parseVoiceCheck(v);
      return check ? { ...check, fix: isRecord(v) && typeof v.fix === 'string' ? v.fix : '' } : null;
    });
    return {
      kind: 'refused',
      message: message ?? 'Not switched: some projects use voices the new provider can\'t play. Nothing changed.',
      refusals,
    };
  }
  if (message) return { kind: 'error', message };
  if (status === 503) return { kind: 'error', message: MESSAGING_DOWN_MESSAGE };
  return { kind: 'error', message: `The voice provider was not changed (HTTP ${status}).` };
}

/** "Kore", or a plain stand-in when the project has no voice. */
export function voiceLabel(voice: { name: string } | null): string {
  return voice?.name ? voice.name : 'no voice set';
}

/**
 * The "Couldn't check" note after a switch: one "<project> (<voice>)" item per
 * entry, plus the reason once when every entry shares it.
 */
export function unverifiedSummary(list: VoiceCheck[]): { items: string[]; sharedReason: string | null } {
  const items = list.map((u) => `${u.projectName} (${voiceLabel(u.voice)})`);
  const reasons = new Set(list.map((u) => u.reason).filter(Boolean));
  const sharedReason = reasons.size === 1 && list.every((u) => u.reason) ? [...reasons][0] : null;
  return { items, sharedReason };
}
