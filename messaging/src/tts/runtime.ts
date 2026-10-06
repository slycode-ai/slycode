/**
 * Per-process TTS runtime (feature 087): the provider registry, the shared
 * SpeechRenderer and the install-wide resolution rules, bound to the
 * messaging state. index.ts routes and the Telegram commands go through this
 * so every path resolves provider and voice the same way.
 */
import type { StateManager } from '../state.js';
import type { VoiceConfig } from '../types.js';
import { SpeechRenderer } from '../tts-render.js';
import { TtsProviderError, VoicesUnavailableError } from './errors.js';
import { buildSpeechHealth, type SpeechHealth } from './health.js';
import { encoderStatus } from './audio-encode.js';
import { customVoiceFix, expiryWarning, recipeKind } from './custom-voices.js';
import {
  createTtsProviders, isTtsProviderId, parseProviderEnv, resolveActiveProvider, resolveVoice, PROVIDER_LABELS, PROVIDER_KEY_ENV, PROVIDER_VOICE_ENV,
  type ActiveProvider, type TtsProvider, type TtsProviderId, type TtsProviderRegistry, type VoiceRef, type VoiceSource,
} from './provider.js';

export interface SwitchProblem {
  projectId: string;
  projectName: string;
  voice: { id: string; name: string } | null;
  reason: string;
  fix: string;
}

export interface SwitchCheck {
  ok: boolean;
  status: number;
  error?: 'provider_unavailable' | 'provider_unconfigured' | 'unusable_voices';
  message?: string;
  refusals: SwitchProblem[];
  unverified: SwitchProblem[];
}

export interface ResolvedVoice {
  voice: VoiceRef;
  source: VoiceSource;
}

export class TtsRuntime {
  readonly registry: TtsProviderRegistry;
  readonly renderer: SpeechRenderer;

  constructor(
    readonly config: VoiceConfig,
    private readonly state: StateManager,
    opts: { registry?: TtsProviderRegistry; renderer?: SpeechRenderer } = {},
  ) {
    this.registry = opts.registry ?? createTtsProviders(config);
    this.renderer = opts.renderer ?? new SpeechRenderer();
  }

  /** The install's active provider right now (state switch → TTS_PROVIDER → auto). */
  active(): ActiveProvider {
    return resolveActiveProvider(this.state.getTtsProviderChoice().provider, this.config, this.registry);
  }

  revision(): number {
    return this.state.getTtsProviderChoice().revision;
  }

  health(): SpeechHealth {
    return buildSpeechHealth({
      encoder: encoderStatus(),
      active: this.active(),
      registry: this.registry,
      config: this.config,
      revision: this.revision(),
      storedDefault: (p) => this.state.getDefaultVoice(p),
      projectsWithoutVoice: (p) => this.state.getProjects()
        .filter((proj) => this.state.getProjectVoice(proj.id, p).effective === null)
        .map((proj) => proj.name || proj.id),
      expiryWarnings: (p) => this.expiryWarnings(p),
    });
  }

  /**
   * Designed voices within EXPIRY_WARNING_DAYS of expiry (or past it) for a
   * provider, one line per voice naming everything that uses it (projects,
   * the install default). The fix suggests --recreate only with a recipe.
   */
  expiryWarnings(provider: TtsProviderId, now = Date.now()): string[] {
    const users = new Map<string, { voice: { id: string; name: string; expiresAt?: string }; owners: string[] }>();
    const note = (owner: string, voice: { id: string; name: string; expiresAt?: string } | null) => {
      if (!voice?.expiresAt) return;
      const entry = users.get(voice.id) ?? { voice, owners: [] };
      entry.owners.push(owner);
      users.set(voice.id, entry);
    };
    for (const proj of this.state.getProjects()) {
      const slot = this.state.getProjectVoice(proj.id, provider);
      if (slot.source === 'project') note(`'${proj.name || proj.id}'`, slot.effective);
    }
    note('the install default', this.state.getDefaultVoice(provider));
    const out: string[] = [];
    for (const { voice, owners } of users.values()) {
      const projects = owners.filter((o) => o.startsWith("'"));
      const who = [
        projects.length ? `${projects.length === 1 ? 'Project' : 'Projects'} ${projects.join(', ')}` : '',
        owners.includes('the install default') ? (projects.length ? 'the install default' : 'The install default') : '',
      ].filter(Boolean).join(' and ');
      const line = expiryWarning(who, voice, recipeKind(this.state.getVoiceRecipe(voice.id)), now);
      if (line) out.push(line);
    }
    return out;
  }

  /** The active provider, or a TtsProviderError('tts_unconfigured') carrying the health reason. */
  requireActive(): TtsProvider {
    const health = this.health();
    const active = this.active();
    if (!health.ready || !active.provider) {
      throw new TtsProviderError('tts_unconfigured', health.reason?.message ?? `TTS provider (${PROVIDER_LABELS[active.id]}) is not ready`);
    }
    return active.provider;
  }

  /**
   * A specific provider for a caller that names one (e.g. `voice set --provider`),
   * defaulting to the active one. Unknown or unavailable providers fail loudly.
   */
  providerFor(requested: unknown): TtsProvider {
    if (requested === undefined || requested === null || requested === '') {
      const active = this.active();
      if (!active.provider) throw new TtsProviderError('provider_unavailable', this.health().reason?.message ?? `TTS provider (${PROVIDER_LABELS[active.id]}) is not available`);
      return active.provider;
    }
    if (!isTtsProviderId(requested)) {
      throw new TtsProviderError('bad_request', `Unknown TTS provider '${String(requested)}'. Use elevenlabs or gemini.`);
    }
    const provider = this.registry[requested];
    if (!provider) {
      throw new TtsProviderError('provider_unavailable', `TTS provider (${PROVIDER_LABELS[requested]}) is not available in this version of SlyCode.`);
    }
    return provider;
  }

  /** Voice for a render triggered by a session (Telegram /voice): explicit → project/ambient slot → env → built-in. */
  voiceForSession(provider: TtsProvider, session: string | undefined, explicit?: string): ResolvedVoice {
    return resolveVoice(provider, { explicit, slot: this.state.resolveSessionSlot(session, provider.id) });
  }

  /** Voice for a programmatic render (speak, generate): explicit → project/session slot → env → built-in. */
  voiceForContext(provider: TtsProvider, ctx: { projectId?: string; session?: string }, explicit?: string): ResolvedVoice {
    return resolveVoice(provider, { explicit, slot: this.state.resolveContextSlot(ctx, provider.id) });
  }

  /**
   * Check a switch to `target` against what is known (design §2). Refusals:
   * no key; a project with no voice at all; a stored voice that is expired
   * (by its stored expiresAt) or confirmed missing; an invalid env default
   * that some project would use. Voices that cannot be checked because the
   * provider is unreachable are reported as `unverified` and do not block.
   * ElevenLabs ids are not re-verified (no expiry; they were in use).
   */
  async validateSwitch(target: TtsProviderId, now = Date.now()): Promise<SwitchCheck> {
    const provider = this.registry[target];
    if (!provider) return { ok: false, status: 400, error: 'provider_unavailable', message: `TTS provider (${PROVIDER_LABELS[target]}) is not available in this version of SlyCode.`, refusals: [], unverified: [] };
    if (!provider.isConfigured()) {
      return { ok: false, status: 400, error: 'provider_unconfigured', message: `${PROVIDER_KEY_ENV[target]} is not set in .env; add it and restart the messaging service, then switch.`, refusals: [], unverified: [] };
    }
    const refusals: SwitchProblem[] = [];
    const unverified: SwitchProblem[] = [];
    const lookups = new Map<string, Promise<'ok' | 'missing' | 'unverified'>>();
    const check = (id: string) => {
      if (!provider.getVoice) return Promise.resolve<'ok'>('ok');
      if (!lookups.has(id)) {
        lookups.set(id, provider.getVoice(id).then(
          (v) => (v === null ? 'missing' : 'ok'),
          (err) => (err instanceof VoicesUnavailableError ? 'unverified' : 'missing'),
        ));
      }
      return lookups.get(id)!;
    };
    const env = provider.envDefaultVoice();
    const envName = PROVIDER_VOICE_ENV[target];
    const envState = env ? await check(env.id) : 'ok';
    for (const project of this.state.getProjects()) {
      const projectName = project.name || project.id;
      const slot = this.state.getProjectVoice(project.id, target);
      let voice: { id: string; name: string; expiresAt?: string } | null = slot.effective;
      let fromEnv = false;
      if (!voice && env) { voice = env; fromEnv = true; }
      if (!voice) voice = provider.builtinDefaultVoice();
      if (!voice) {
        refusals.push({ projectId: project.id, projectName, voice: null, reason: `has no ${provider.label} voice and there is no install default`,
          fix: `set ${envName} in .env, or run \`sly-messaging voice set <voice> --provider ${target} --project ${project.id}\`` });
        continue;
      }
      if (voice.expiresAt && Date.parse(voice.expiresAt) <= now) {
        refusals.push({ projectId: project.id, projectName, voice: { id: voice.id, name: voice.name }, reason: `voice '${voice.name}' expired on ${voice.expiresAt.slice(0, 10)}`,
          fix: this.state.getVoiceRecipe(voice.id)
            ? customVoiceFix(voice.id, recipeKind(this.state.getVoiceRecipe(voice.id)), project.id)
            : `\`sly-messaging voice set <voice> --provider ${target} --project ${project.id}\` (or voice clear --provider ${target})` });
        continue;
      }
      const state = fromEnv ? envState : await check(voice.id);
      if (state === 'missing') {
        refusals.push({ projectId: project.id, projectName, voice: { id: voice.id, name: voice.name },
          reason: fromEnv ? `${envName}=${voice.id} is not a ${provider.label} voice` : `voice '${voice.name}' (${voice.id}) no longer exists at ${provider.label}`,
          fix: fromEnv ? `fix ${envName} in .env and restart the messaging service`
            : this.state.getVoiceRecipe(voice.id) ? customVoiceFix(voice.id, recipeKind(this.state.getVoiceRecipe(voice.id)), project.id)
            : `\`sly-messaging voice set <voice> --provider ${target} --project ${project.id}\` (or voice clear --provider ${target})` });
      } else if (state === 'unverified') {
        unverified.push({ projectId: project.id, projectName, voice: { id: voice.id, name: voice.name }, reason: `${provider.label} voices could not be reached to check it`, fix: '' });
      }
    }
    if (refusals.length) {
      return { ok: false, status: 409, error: 'unusable_voices', message: `Switching to ${provider.label} would leave ${refusals.length === 1 ? 'a project' : `${refusals.length} projects`} without a usable voice. Nothing was changed.`, refusals, unverified };
    }
    return { ok: true, status: 200, refusals: [], unverified };
  }

  /** Validate, then switch. Returns the check (with the new health on success). */
  async switchProvider(target: TtsProviderId): Promise<SwitchCheck & { health?: SpeechHealth }> {
    const check = await this.validateSwitch(target);
    if (!check.ok) return check;
    this.state.setTtsProvider(target);
    return { ...check, health: this.health() };
  }

  /** Raw TTS_PROVIDER value that was set but not understood (for a startup warning), else null. */
  invalidProviderEnv(): string | null {
    const raw = (this.config.ttsProviderEnv ?? '').trim();
    return raw && !parseProviderEnv(raw) ? raw : null;
  }

  providerIds(): TtsProviderId[] {
    return Object.keys(this.registry) as TtsProviderId[];
  }
}
