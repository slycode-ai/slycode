/**
 * TTS HTTP routes (feature 087; moved out of index.ts unchanged in behaviour):
 * POST /voice (Telegram voice reply), POST /tts/generate, POST /tts/render
 * (speak), GET|PUT|DELETE /projects/:id/voice, GET /tts/project-voices,
 * GET /voices/search, POST /voices/preview, POST /voices/design,
 * DELETE /voices/:id, GET|PUT /tts/provider. Everything provider- and voice-related goes through
 * TtsRuntime; channel access, the audio archive and the switch message are
 * injected so the routes can be tested without Telegram.
 *
 * Structural invariant: /tts/generate, /tts/render, the project-voice,
 * voice-search, preview, design and provider routes never reference the channel.
 */
import fs from 'fs';
import path from 'path';
import express, { type Request, type Router } from 'express';
import type { Channel } from '../types.js';
import type { StateManager } from '../state.js';
import { RenderTimeoutError, RenderCancelledError, encodeSource, TTS_PREVIEW_TIMEOUT_MS, TTS_RENDER_TIMEOUT_MS, TTS_VOICE_TIMEOUT_MS, TTS_GENERATE_TIMEOUT_MS, voiceTextLimitError } from '../tts.js';
import { TtsProviderError, VoiceLookupError, VoiceUnusableError, VoicesUnavailableError } from './errors.js';
import { clonedRecreateMessage, customVoiceFix, expiryWarning, isCustomVoiceId, noRecipeMessage, recipeKind, sampleSlug, unusableVoiceMessage, type VoiceRecipe } from './custom-voices.js';
import { PROVIDER_LABELS as TTS_LABELS, isTtsProviderId, type AudioFormat, type DesignedVoice, type SourceAudio, type TtsProvider, type VoiceRef } from './provider.js';
import { parseWav, pcmSeconds } from './audio-encode.js';
import { CLONE_CONSENT_SECONDS, CLONE_SAMPLE_SECONDS, CLONE_SECONDS_TOLERANCE, DEFAULT_CONSENT_LOCALE, consentFor } from './consent-statements.js';
import type { TtsRuntime } from './runtime.js';
import { resolveCanonicalProjectId } from '../session-keys.js';
import { FileSendError, preflightWritePath } from '../file-send.js';
import { buildGeneratedFilename, todayDateString } from '../audio-utils.js';

export interface TtsRouteDeps {
  tts: TtsRuntime;
  state: StateManager;
  /** The messaging channel (Telegram), or null when none is configured. */
  channel: () => Channel | null;
  noChannelError: string;
  /** The ambient session name (Telegram target) for callers that pass none. */
  sessionName: () => string;
  contextSlug: (session: string | undefined) => string;
  archive: (buffer: Buffer, ext: '.ogg' | '.mp3', slug: string) => void;
  /** Trailing "switch to card" message after media (Telegram). */
  afterVoiceSent: (session: string | undefined) => Promise<void>;
  workspaceRoot: () => string;
  /** Encoder for design samples (default: encodeSource); injected by tests. */
  encodeSample?: (source: SourceAudio, format: AudioFormat) => Promise<Buffer>;
}

/**
 * Map a render failure to an HTTP response (feature 087): provider errors keep
 * their stable code; deadline → 504; caller hang-up → 499; anything else is a
 * provider failure (502).
 */
export function ttsErrorResponse(err: unknown): { status: number; body: { ok: false; error: string; message: string } } {
  if (err instanceof TtsProviderError) return { status: err.status, body: { ok: false, error: err.code, message: err.message } };
  if (err instanceof RenderTimeoutError) return { status: 504, body: { ok: false, error: 'render_timeout', message: err.message } };
  if (err instanceof RenderCancelledError) return { status: 499, body: { ok: false, error: 'render_cancelled', message: err.message } };
  return { status: 502, body: { ok: false, error: 'tts_failed', message: (err as Error).message } };
}

/** What a voice preview says: short, neutral, and the same for every voice so clips compare fairly. */
export const VOICE_PREVIEW_TEXT = "Hi there. This is how I'll sound when I read your replies aloud.";

/**
 * Routes whose bodies are bigger than the service-wide 16 KB JSON limit.
 * The app's global parser skips these and the route parses its own body.
 * Only the clone upload (two base64 WAVs, about 3 MB) is here (#0376).
 */
export const CLONE_PATH = '/voices/clone';
export const LARGE_BODY_PATHS: ReadonlySet<string> = new Set([CLONE_PATH]);
const CLONE_BODY_LIMIT = '6mb';

/** The app-wide JSON parser with the large-body routes left to parse their own (#0376). */
export function serviceJsonParser(limit = '16kb'): express.RequestHandler {
  const small = express.json({ limit });
  return (req, res, next) => (LARGE_BODY_PATHS.has(req.path) ? next() : small(req, res, next));
}

export function createTtsRouter(deps: TtsRouteDeps): Router {
  const router = express.Router();
  const { tts, state } = deps;

  /**
   * ttsErrorResponse plus the phase 4 rule: an unusable designed voice gets
   * its fix from the local recipe store (--recreate only when a recipe exists).
   */
  const errorResponse = (err: unknown): ReturnType<typeof ttsErrorResponse> => {
    if (err instanceof VoiceUnusableError) {
      const recipe = state.getVoiceRecipe(err.voice.id);
      const voice = { ...err.voice, name: err.voice.name !== err.voice.id ? err.voice.name : recipe?.name ?? err.voice.name };
      return { status: err.status, body: { ok: false, error: err.code, message: unusableVoiceMessage(TTS_LABELS.gemini, err.why, voice, recipeKind(recipe)) } };
    }
    return ttsErrorResponse(err);
  };

  router.post('/voice', async (req, res) => {
    try {
      const { message, session } = req.body;
      if (!message) return res.status(400).json({ error: 'message is required' });
      const channel = deps.channel();
      if (!channel) return res.status(400).json({ error: deps.noChannelError });
      // Same cap as /tts/generate (feature 087). Before this, a longer reply
      // failed inside the provider's API instead of with a clear reason.
      const tooLong = voiceTextLimitError(message);
      if (tooLong) return res.status(400).json({ error: tooLong });
      let provider: TtsProvider;
      try {
        provider = tts.requireActive();
      } catch (err) {
        return res.status(400).json({ error: `Voice messaging (TTS) is not configured. ${(err as Error).message} Tell the user, or use text mode instead.` });
      }
      if (!channel.isReady()) return res.status(400).json({ error: 'No active chat. Send a message from the channel first.' });

      await channel.sendChatAction('upload_voice');
      // Resolve voice from the CALLER's session/project, not the ambient
      // Telegram target. An automation for project X must render in X's voice
      // even if the user last navigated the messaging UI to a different
      // project. Falls back to the ambient voice when no session is supplied.
      const { voice } = tts.voiceForSession(provider, session || deps.sessionName());

      // Render the source once (cached), then encode to OGG; if that fails,
      // fall back to MP3 from the same source without re-hitting the provider.
      const job = tts.renderer.admit({ provider, providerRevision: tts.revision(), voice, text: message, timeoutMs: TTS_VOICE_TIMEOUT_MS, purpose: 'voice', speed: tts.config.ttsSpeed });
      const { source } = await tts.renderer.renderSource(job);

      let audioBuffer: Buffer;
      let format: 'ogg' | 'mp3';
      try {
        audioBuffer = await tts.renderer.encodeWithin(job, source, 'ogg');
        format = 'ogg';
      } catch {
        audioBuffer = await tts.renderer.encodeWithin(job, source, 'mp3');
        format = 'mp3';
      }

      const contextSlug = deps.contextSlug(session || deps.sessionName());
      deps.archive(audioBuffer, format === 'ogg' ? '.ogg' : '.mp3', contextSlug);

      await channel.sendVoice(audioBuffer, format);
      // Switch button trails the audio (media can't carry an inline keyboard).
      // Sent AFTER the voice so that in text+voice ("both") mode the standalone
      // switch message never lands sandwiched right after the text reply — which
      // already carries the button inline. It belongs to the media, so it
      // follows the media.
      await deps.afterVoiceSent(session);
      res.json({ success: true });
    } catch (err) {
      if (err instanceof TtsProviderError) {
        const r = errorResponse(err);
        return res.status(r.status).json({ error: r.body.message });
      }
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /tts/generate — render TTS audio and write to disk. Never emits to
  // any channel. Structural invariant: this handler must not reference
  // `channel` anywhere.
  router.post('/tts/generate', async (req, res) => {
    try {
      const { text, voiceId, format, outDir, filename, projectId, session } = req.body ?? {};

      if (typeof text !== 'string' || text.length === 0) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'text must be a non-empty string' });
      }
      const maxText = parseInt(process.env.TTS_GENERATE_MAX_TEXT || '5000', 10);
      if (text.length > maxText) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: `text exceeds ${maxText} characters` });
      }
      const fmt: 'ogg' | 'mp3' | 'wav' = format ?? 'ogg';
      if (fmt !== 'ogg' && fmt !== 'mp3' && fmt !== 'wav') {
        return res.status(400).json({ ok: false, error: 'bad_request', message: "format must be 'ogg', 'mp3' or 'wav'" });
      }
      if (voiceId !== undefined && (typeof voiceId !== 'string' || voiceId.length === 0)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'voiceId must be a non-empty string when provided' });
      }
      if (outDir !== undefined && typeof outDir !== 'string') {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'outDir must be a string' });
      }
      if (filename !== undefined && (typeof filename !== 'string' || filename.length === 0)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'filename must be a non-empty string when provided' });
      }
      if (projectId !== undefined && (typeof projectId !== 'string' || projectId.length === 0)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'projectId must be a non-empty string when provided' });
      }
      if (session !== undefined && (typeof session !== 'string' || session.length === 0)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'session must be a non-empty string when provided' });
      }
      let provider: TtsProvider;
      try {
        provider = tts.requireActive();
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }

      // An explicit projectId that matches no registry project is a caller
      // error — fail loudly instead of silently rendering the default voice.
      // Don't enumerate the registry in the error — defense-in-depth against a
      // future scenario where this endpoint is reachable beyond localhost.
      if (projectId !== undefined && !resolveCanonicalProjectId(projectId, state.getProjects())) {
        return res.status(404).json({
          ok: false,
          error: 'unknown_project',
          message: `Unknown project: '${projectId}'. Pass a project id, name, or session key.`,
        });
      }

      // Resolve the effective voice for the active provider. Explicit voiceId
      // always wins; then the per-project voice for the given projectId/session;
      // then the install default; then the env default; then the provider's
      // built-in voice.
      let resolved;
      try {
        resolved = tts.voiceForContext(provider, { projectId, session }, voiceId);
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      // Filenames hash the voice only when it was chosen (explicit/project);
      // env/built-in defaults hash as null, exactly as before feature 087.
      const filenameVoiceId = resolved.source === 'env' || resolved.source === 'builtin' ? null : resolved.voice.id;

      const workspaceRoot = deps.workspaceRoot();
      const defaultDirRel = process.env.TTS_GENERATE_DEFAULT_DIR || path.join('data', 'generated-audio');
      const dirInput = outDir ?? path.join(defaultDirRel, todayDateString());
      const dirAbsolute = path.isAbsolute(dirInput) ? dirInput : path.resolve(workspaceRoot, dirInput);

      const effectiveFilename = filename ?? buildGeneratedFilename({ text, voiceId: filenameVoiceId, format: fmt });
      const finalAbsolutePath = path.join(dirAbsolute, effectiveFilename);

      // Sensitive-path guard runs before TTS to save provider cost on a
      // request that's going to be refused anyway.
      try {
        await preflightWritePath(finalAbsolutePath);
      } catch (err) {
        if (err instanceof FileSendError) {
          return res.status(err.httpStatus).json({ ok: false, error: err.code, message: err.message });
        }
        throw err;
      }

      let buffer: Buffer;
      try {
        const result = await tts.renderer.renderSpeech({
          provider, providerRevision: tts.revision(), voice: resolved.voice, text, format: fmt, timeoutMs: TTS_GENERATE_TIMEOUT_MS, purpose: 'generate', speed: tts.config.ttsSpeed,
        });
        buffer = result.buffer;
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }

      try {
        await fs.promises.mkdir(dirAbsolute, { recursive: true });
        const fh = await fs.promises.open(finalAbsolutePath, 'wx');
        try {
          await fh.writeFile(buffer);
        } finally {
          await fh.close();
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          return res.status(409).json({ ok: false, error: 'file_exists', message: `File already exists: ${finalAbsolutePath}` });
        }
        return res.status(500).json({ ok: false, error: 'write_failed', message: (err as Error).message });
      }

      const relativePath = finalAbsolutePath.startsWith(workspaceRoot + path.sep)
        ? path.relative(workspaceRoot, finalAbsolutePath)
        : finalAbsolutePath;

      return res.json({
        ok: true,
        path: relativePath,
        absolutePath: finalAbsolutePath,
        filename: path.basename(finalAbsolutePath),
        format: fmt,
        bytes: buffer.length,
        durationMs: null,
        voiceId: resolved.voice.id,
        provider: provider.id,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // POST /tts/render — render TTS audio and return the bytes inline (feature
  // 086, used by the bridge's speak orchestration). Never writes to disk and
  // never emits to any channel. Structural invariant: this handler must not
  // reference `channel` anywhere.
  router.post('/tts/render', async (req, res) => {
    try {
      const { text, voiceId, format, projectId, session } = req.body ?? {};

      if (typeof text !== 'string' || text.length === 0) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'text must be a non-empty string' });
      }
      const maxText = parseInt(process.env.TTS_GENERATE_MAX_TEXT || '5000', 10);
      if (text.length > maxText) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: `text exceeds ${maxText} characters` });
      }
      const fmt: 'mp3' = format ?? 'mp3';
      if (fmt !== 'mp3') {
        return res.status(400).json({ ok: false, error: 'bad_request', message: "format must be 'mp3'" });
      }
      if (voiceId !== undefined && (typeof voiceId !== 'string' || voiceId.length === 0)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'voiceId must be a non-empty string when provided' });
      }
      if (projectId !== undefined && (typeof projectId !== 'string' || projectId.length === 0)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'projectId must be a non-empty string when provided' });
      }
      if (session !== undefined && (typeof session !== 'string' || session.length === 0)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'session must be a non-empty string when provided' });
      }
      let provider: TtsProvider;
      try {
        provider = tts.requireActive();
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      if (projectId !== undefined && !resolveCanonicalProjectId(projectId, state.getProjects())) {
        return res.status(404).json({
          ok: false,
          error: 'unknown_project',
          message: `Unknown project: '${projectId}'. Pass a project id, name, or session key.`,
        });
      }

      // Same voice resolution as /tts/generate: explicit → project/session → install default → env → built-in.
      let resolved;
      try {
        resolved = tts.voiceForContext(provider, { projectId, session }, voiceId);
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }

      // A caller that hangs up (bridge timeout, killed CLI) must not keep a paid
      // render queued: abort it so undispatched work is dropped from the queue.
      const abort = new AbortController();
      // Client disconnect = the RESPONSE closing before it finished. (A request's
      // 'close' fires as soon as its body has been read on current Node, so it
      // cannot be used to detect a hang-up.)
      res.on('close', () => { if (!res.writableFinished) abort.abort(); });
      try {
        const result = await tts.renderer.renderSpeech({
          provider, providerRevision: tts.revision(), voice: resolved.voice, text, format: 'mp3', timeoutMs: TTS_RENDER_TIMEOUT_MS, signal: abort.signal, purpose: 'speak', speed: tts.config.ttsSpeed,
        });
        return res.json({
          ok: true,
          voiceId: result.voiceId,
          provider: result.provider,
          format: 'mp3',
          bytes: result.buffer.length,
          cached: result.cached,
          dataBase64: result.buffer.toString('base64'),
        });
      } catch (err) {
        if (err instanceof RenderCancelledError && (res.writableEnded || res.destroyed)) return;
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // --- Project voice (feature 086) ------------------------------------------
  // GET/PUT/DELETE /projects/:id/voice — read, set or clear a project's own
  // TTS voice without going through Telegram. `:id` accepts a project id,
  // sessionKey, alias or display name; the literal `_session` resolves the
  // project from `?session=` / body.session (the caller's SLYCODE_SESSION).
  // Writes touch ONLY the project's entry (no top-level mirror) and persist
  // strictly. Never references `channel`.
  function resolveProjectParam(req: Request): string | null {
    const raw = String(req.params.id);
    const session = (typeof req.query.session === 'string' && req.query.session)
      || (typeof req.body?.session === 'string' ? req.body.session : undefined);
    if (raw === '_session') return state.resolveProjectIdFrom({ session });
    return state.resolveProjectIdFrom({ projectId: raw });
  }

  // Payload reports the ACTIVE provider's voice (stored/effective/source, as
  // before feature 087) plus every provider's slot — a switch rewrites none.
  function projectVoicePayload(projectId: string, provider: TtsProvider) {
    const v = state.getProjectVoice(projectId, provider.id);
    let effective: { id: string; name: string } | null = v.effective;
    let source: 'project' | 'inherited' | 'env' | 'builtin' | null = v.source;
    if (!effective) {
      const env = provider.envDefaultVoice();
      const builtin = provider.builtinDefaultVoice();
      if (env) { effective = { id: env.id, name: env.name }; source = 'env'; }
      else if (builtin) { effective = { id: builtin.id, name: builtin.name }; source = 'builtin'; }
    }
    // Designed voices near or past expiry (phase 4): voice show prints these.
    const projectName = state.getProjects().find((p) => p.id === projectId)?.name || projectId;
    const warning = v.effective ? expiryWarning(`Project '${projectName}'`, v.effective, recipeKind(state.getVoiceRecipe(v.effective.id)), Date.now(), projectId) : null;
    return { ok: true, projectId, provider: provider.id, stored: v.stored, effective, source, slots: state.getProjectVoiceSlots(projectId), warnings: warning ? [warning] : [] };
  }

  function providerFromRequest(req: Request): TtsProvider {
    const raw = (typeof req.query.provider === 'string' && req.query.provider) || req.body?.provider;
    return tts.providerFor(raw);
  }

  router.get('/projects/:id/voice', (req, res) => {
    const projectId = resolveProjectParam(req);
    if (!projectId) {
      return res.status(404).json({ ok: false, error: 'unknown_project', message: `Unknown project: '${req.params.id}'.` });
    }
    let provider: TtsProvider;
    try {
      provider = providerFromRequest(req);
    } catch (err) {
      const r = errorResponse(err);
      return res.status(r.status).json(r.body);
    }
    res.json(projectVoicePayload(projectId, provider));
  });

  /**
   * The voice a stamped set names (project or install default): checked
   * against the provider, stale picks refused. Sends the error response and
   * returns null when it can't be used.
   */
  async function chosenVoiceFromBody(req: Request, res: express.Response, provider: TtsProvider): Promise<VoiceRef | null> {
    const { voiceId, voiceName, voice } = req.body ?? {};
    const given = [voiceId, voiceName, voice].filter((v) => typeof v === 'string' && v.trim().length > 0);
    if (given.length !== 1 && !(typeof voiceId === 'string' && voiceId && typeof voiceName === 'string')) {
      res.status(400).json({ ok: false, error: 'bad_request', message: 'Provide exactly one of voice, voiceId or voiceName' });
      return null;
    }
    try {
      if (typeof voiceId === 'string' && voiceId.length > 0) {
        // An explicit id. ElevenLabs ids are taken as given (as before);
        // Gemini ids are checked, since a typo would otherwise fail later.
        if (provider.id === 'elevenlabs' || !provider.getVoice) {
          return { provider: provider.id, id: voiceId, name: typeof voiceName === 'string' && voiceName ? voiceName : voiceId };
        }
        const info = await provider.getVoice(voiceId);
        if (!info) throw new VoiceLookupError('voice_not_found', `No ${provider.label} voice with id '${voiceId}'. Use \`sly-messaging voices\` to find one.`, []);
        return { provider: provider.id, id: info.voice_id, name: info.name, ...(info.expiresAt ? { expiresAt: info.expiresAt, kind: 'custom' as const } : {}) };
      }
      if (!provider.isConfigured()) {
        throw new TtsProviderError('tts_unconfigured', `TTS provider (${provider.label}) is not configured, so voice names can't be looked up.`);
      }
      return await provider.resolveVoiceValue(String(voice ?? voiceName));
    } catch (err) {
      if (err instanceof VoicesUnavailableError) {
        res.status(502).json({ ok: false, error: 'voices_unavailable', message: err.message });
      } else if (err instanceof VoiceLookupError) {
        res.status(err.status).json({
          ok: false, error: err.code, message: err.message,
          candidates: err.candidates.map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category, description: v.description, labels: v.labels })),
        });
      } else {
        const r = errorResponse(err);
        res.status(r.status).json(r.body);
      }
      return null;
    }
  }

  router.put('/projects/:id/voice', async (req, res) => {
    try {
      const projectId = resolveProjectParam(req);
      if (!projectId) {
        return res.status(404).json({ ok: false, error: 'unknown_project', message: `Unknown project: '${req.params.id}'.` });
      }
      const { revision } = req.body ?? {};
      let provider: TtsProvider;
      try {
        provider = providerFromRequest(req);
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      // Captured before any await and rechecked right before the write: a
      // provider switch during the lookup must not land this voice (feature 087).
      const seenRevision = tts.revision();
      const seenActive = tts.active().id;
      const stale = () => res.status(409).json({ ok: false, error: 'stale_provider', message: `That voice list is out of date (the provider is now ${TTS_LABELS[tts.active().id]}). Search again.`, revision: tts.revision() });
      // A pick from a list made before a provider switch is stale.
      if (typeof revision === 'number' && revision < seenRevision) return stale();
      const chosen = await chosenVoiceFromBody(req, res, provider);
      if (!chosen) return;

      if (tts.revision() !== seenRevision || tts.active().id !== seenActive) return stale();
      try {
        const { provider: _p, ...stored } = chosen;
        state.setProjectVoice(projectId, { ...stored, provider: provider.id });
      } catch (err) {
        return res.status(500).json({ ok: false, error: 'persist_failed', message: `Voice not saved: ${(err as Error).message}` });
      }
      res.json(projectVoicePayload(projectId, provider));
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // PUT /tts/default-voice {voiceId, voiceName?, provider, revision} — set the
  // install default (what every project without its own voice inherits) from
  // the web picker (#0376). Same stamped checks as a project set.
  router.put('/tts/default-voice', async (req, res) => {
    try {
      const { revision } = req.body ?? {};
      let provider: TtsProvider;
      try {
        provider = providerFromRequest(req);
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      const seenRevision = tts.revision();
      const seenActive = tts.active().id;
      const stale = () => res.status(409).json({ ok: false, error: 'stale_provider', message: `That voice list is out of date (the provider is now ${TTS_LABELS[tts.active().id]}). Search again.`, revision: tts.revision() });
      if (typeof revision === 'number' && revision < seenRevision) return stale();
      const chosen = await chosenVoiceFromBody(req, res, provider);
      if (!chosen) return;
      if (tts.revision() !== seenRevision || tts.active().id !== seenActive) return stale();
      try {
        const { provider: _p, ...stored } = chosen;
        state.setInstallDefaultVoice(provider.id, stored);
      } catch (err) {
        return res.status(500).json({ ok: false, error: 'persist_failed', message: `Voice not saved: ${(err as Error).message}` });
      }
      const voice = { id: chosen.id, name: chosen.name };
      res.json({ ok: true, provider: provider.id, revision: tts.revision(), effective: voice, source: 'inherited', installDefault: { voice, source: 'state' } });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  router.delete('/projects/:id/voice', (req, res) => {
    const projectId = resolveProjectParam(req);
    if (!projectId) {
      return res.status(404).json({ ok: false, error: 'unknown_project', message: `Unknown project: '${req.params.id}'.` });
    }
    let provider: TtsProvider;
    try {
      provider = providerFromRequest(req);
    } catch (err) {
      const r = errorResponse(err);
      return res.status(r.status).json(r.body);
    }
    // A reset pressed on a list from before a provider switch is stale too (phase 3).
    const rawRevision = req.body?.revision ?? (typeof req.query.revision === 'string' ? Number(req.query.revision) : undefined);
    if (typeof rawRevision === 'number' && Number.isFinite(rawRevision) && rawRevision < tts.revision()) {
      return res.status(409).json({ ok: false, error: 'stale_provider', message: `That voice list is out of date (the provider is now ${TTS_LABELS[tts.active().id]}). Search again.`, revision: tts.revision() });
    }
    try {
      state.clearProjectVoice(projectId, provider.id);
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'persist_failed', message: `Voice not cleared: ${(err as Error).message}` });
    }
    res.json(projectVoicePayload(projectId, provider));
  });

  // GET /voices/search — search the active (or ?provider=) TTS provider's voices
  // by name and return matches with their voice IDs. Never emits to any
  // channel; exists so other services can resolve voice IDs without their own
  // provider integration.
  router.get('/voices/search', async (req, res) => {
    try {
      const q = req.query.q;
      if (q !== undefined && typeof q !== 'string') {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'q must be a single string when provided' });
      }
      let provider: TtsProvider;
      try {
        provider = providerFromRequest(req);
        if (!provider.isConfigured()) {
          throw new TtsProviderError('tts_unconfigured', `TTS provider (${provider.label}) is not configured, so its voices can't be searched.`);
        }
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      // The stamp is captured BEFORE the await and returned as captured; an
      // unpinned search that straddles a provider switch is refused (409) so
      // the caller re-searches instead of picking from the old provider (#0369).
      const seenRevision = tts.revision();
      const pinned = typeof req.query.provider === 'string' && req.query.provider !== '';
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      const voices = await provider.searchVoices({
        text: q || undefined,
        gender: str(req.query.gender),
        accent: str(req.query.accent),
        language: str(req.query.language),
        custom: req.query.custom === '1' || req.query.custom === 'true',
      });
      if (!pinned && tts.revision() !== seenRevision) {
        return res.status(409).json({ ok: false, error: 'stale_provider', message: `The provider changed during the search (it is now ${TTS_LABELS[tts.active().id]}). Search again.`, revision: tts.revision() });
      }
      // --custom (phase 4): say which designed voices have a local recipe, and
      // list recipes whose voice is gone at Google (deleted or expired) so
      // they can still be recreated.
      if (req.query.custom === '1' || req.query.custom === 'true') {
        const live = new Set(voices.map((v) => v.voice_id));
        const recipes = state.listVoiceRecipes().filter((r) => r.recipe.provider === provider.id && !live.has(r.id));
        return res.json({
          ok: true, query: q || null, provider: provider.id, revision: seenRevision,
          voices: voices.map((v) => ({ ...v, recipe: !!state.getVoiceRecipe(v.voice_id) })),
          recipes: recipes.map(({ id, recipe }) => ({ voice_id: id, name: recipe.name, type: recipe.type ?? 'prompted', description: recipe.description, expiresAt: recipe.expiresAt ?? null, deleted: !!recipe.deleted, replacedBy: recipe.replacedBy ?? null })),
        });
      }
      res.json({ ok: true, query: q || null, provider: provider.id, revision: seenRevision, voices });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // --- Designed voices (feature 087 phase 4) ---------------------------------
  // Gemini only, whatever the active provider is (needs GEMINI_API_KEY).

  function designProvider(what = 'Voice design'): TtsProvider {
    const gemini = tts.registry.gemini;
    if (!gemini?.designVoice) throw new TtsProviderError('provider_unavailable', `${what} needs the Gemini provider, which is not available in this version of SlyCode.`);
    if (!gemini.isConfigured()) throw new TtsProviderError('tts_unconfigured', `${what} needs GEMINI_API_KEY in .env (it works whichever provider is active). Add it and restart the messaging service.`);
    return gemini;
  }

  /** Where a design sample goes: data/generated-audio/voice-design/<date>/<slug>.ogg, never overwriting. */
  async function saveDesignSample(sample: SourceAudio, name: string, id: string): Promise<string> {
    const audio = await (deps.encodeSample ?? encodeSource)(sample, 'ogg');
    const dir = path.resolve(deps.workspaceRoot(), process.env.TTS_GENERATE_DEFAULT_DIR || path.join('data', 'generated-audio'), 'voice-design', todayDateString());
    await fs.promises.mkdir(dir, { recursive: true });
    const base = sampleSlug(name);
    for (const file of [`${base}.ogg`, `${base}-${id.replace(/^voice_/, '').slice(0, 12)}.ogg`]) {
      const full = path.join(dir, file);
      try {
        await fs.promises.writeFile(full, audio, { flag: 'wx' });
        return full;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      }
    }
    throw new Error(`a sample named ${base} already exists in ${dir}`);
  }

  /**
   * After a paid create (design or clone): save the recipe STRICTLY (on
   * failure the new voice is deleted again), note the replacement on the
   * voice it replaces, save the sample, optionally set it on a project, and
   * build the answer every create route shares.
   */
  async function finishCreatedVoice(
    gemini: TtsProvider,
    created: DesignedVoice,
    recipe: VoiceRecipe,
    opts: { replaces: string | null; projectId: string | null; returnSample: boolean },
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; body: Record<string, unknown> }> {
    try {
      state.saveVoiceRecipe(created.id, recipe);
    } catch (err) {
      // Never leave a voice whose recipe was not saved: delete it again.
      const undone = await gemini.deleteVoice!(created.id).then(() => true, () => false);
      return {
        ok: false,
        body: {
          ok: false, error: 'persist_failed',
          message: `The voice's recipe could not be saved (${(err as Error).message}). ${undone ? 'The new voice was deleted again, so nothing was left half-made.' : `The new voice ${created.id} could not be deleted; remove it with \`sly-messaging voice delete ${created.id}\`.`}`,
        },
      };
    }
    const warnings: string[] = [];
    if (opts.replaces) {
      try { state.updateVoiceRecipe(opts.replaces, { replacedBy: created.id }); } catch (err) { warnings.push(`Could not note the replacement on the old recipe: ${(err as Error).message}`); }
    }
    let samplePath: string | null = null;
    if (created.sample) {
      try { samplePath = await saveDesignSample(created.sample, created.name, created.id); } catch (err) { warnings.push(`The sample could not be saved: ${(err as Error).message}`); }
    } else if (recipe.type !== 'replicated') {
      // A clone may come back without a sample (the docs don't promise one); the picker previews it instead.
      warnings.push('Google sent no usable sample clip for this voice.');
    }
    let set: ReturnType<typeof projectVoicePayload> | null = null;
    if (opts.projectId) {
      try {
        state.setProjectVoice(opts.projectId, { id: created.id, name: created.name, kind: 'custom', ...(created.expiresAt ? { expiresAt: created.expiresAt } : {}), provider: 'gemini' });
        set = projectVoicePayload(opts.projectId, gemini);
      } catch (err) {
        warnings.push(`The voice was made but not set on the project: ${(err as Error).message}`);
      }
    }
    // The web panel plays the sample straight away: MP3 plays in every browser.
    let sample: { contentType: string; data: string } | null = null;
    if (opts.returnSample && created.sample) {
      try {
        sample = { contentType: 'audio/mpeg', data: (await (deps.encodeSample ?? encodeSource)(created.sample, 'mp3')).toString('base64') };
      } catch (err) {
        warnings.push(`The sample could not be prepared for playback: ${(err as Error).message}`);
      }
    }
    return {
      ok: true,
      body: {
        ok: true,
        voice: { id: created.id, name: created.name, expiresAt: created.expiresAt ?? null, model: created.model },
        type: recipe.type ?? 'prompted',
        sample,
        recipeSaved: true,
        samplePath,
        set,
        activeProvider: tts.active().id,
        warnings,
      },
    };
  }

  // POST /voices/design {description, name, gender?, language?, recreate?, set?, projectId?, session?}
  // Creates a Gemini voice from a description; with `recreate: <voice_id>`
  // rebuilds one from its local recipe (else Google's, while the voice still
  // exists). The recipe is persisted STRICTLY before success is reported; if
  // that fails the new voice is deleted again. The client hanging up does not
  // abandon the request: the voice and its recipe are saved either way.
  router.post('/voices/design', async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      // The web panel sends the revision its voice list was made under: a
      // design started from a list older than the last provider switch is
      // refused before any paid call (and rechecked right before it).
      const seenRevision = tts.revision();
      const stamped = typeof body.revision === 'number';
      const stale = () => res.status(409).json({ ok: false, error: 'stale_provider', message: `The voice provider changed (it is now ${TTS_LABELS[tts.active().id]}). Search again.`, revision: tts.revision() });
      if (stamped && (body.revision as number) < seenRevision) return stale();
      let gemini: TtsProvider;
      try {
        gemini = designProvider();
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      const gender = str(body.gender)?.toLowerCase();
      if (gender && !['female', 'male', 'neutral'].includes(gender)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'gender must be female, male or neutral' });
      }
      const language = str(body.language);
      if (language && !/^[a-z]{2,3}(-[A-Za-z]{2})?$/.test(language)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'language must be a code like en or en-GB' });
      }
      // Resolve the project BEFORE the paid call, so a typo never costs a design.
      let projectId: string | null = null;
      if (body.set === true) {
        const raw = str(body.projectId);
        projectId = raw ? state.resolveProjectIdFrom({ projectId: raw }) : state.resolveProjectIdFrom({ session: str(body.session) });
        if (!projectId) {
          return res.status(404).json({ ok: false, error: 'unknown_project', message: raw ? `Unknown project: '${raw}'.` : 'No project to set the voice on: pass --project <id|name>, or run from a SlyCode terminal.' });
        }
      }

      const recreate = str(body.recreate);
      let description = str(body.description);
      let name = str(body.name);
      let recipeSource: 'local' | 'remote' | null = null;
      let fromRecipe: { gender?: string; language?: string } = {};
      if (recreate) {
        const local = state.getVoiceRecipe(recreate);
        let remote: Awaited<ReturnType<NonNullable<TtsProvider['remoteRecipe']>>> = null;
        if (!local) {
          try {
            remote = (await gemini.remoteRecipe?.(recreate)) ?? null;
          } catch (err) {
            if (err instanceof VoicesUnavailableError) return res.status(502).json({ ok: false, error: 'voices_unavailable', message: err.message });
            throw err;
          }
        }
        const recipe = local ?? remote;
        if (!recipe) return res.status(404).json({ ok: false, error: 'no_recipe', message: noRecipeMessage(recreate) });
        // A clone's recordings aren't kept (#0376): it can only be cloned again.
        if (local?.type === 'replicated') return res.status(409).json({ ok: false, error: 'cloned_voice', message: clonedRecreateMessage(recreate, local.name) });
        recipeSource = local ? 'local' : 'remote';
        description = recipe.description;
        name = name ?? recipe.name;
        fromRecipe = { gender: recipe.gender, language: recipe.language };
      }
      if (!description) return res.status(400).json({ ok: false, error: 'bad_request', message: 'Describe the voice, e.g. voice design "a calm Scottish narrator in her fifties" --name Isla' });
      if (description.length > 2000) return res.status(400).json({ ok: false, error: 'bad_request', message: 'The description is too long (2,000 characters at most).' });
      if (!name) return res.status(400).json({ ok: false, error: 'bad_request', message: 'Give the voice a name with --name.' });
      if (name.length > 100) return res.status(400).json({ ok: false, error: 'bad_request', message: 'The name is too long (100 characters at most).' });

      if (stamped && tts.revision() !== seenRevision) return stale();
      let designed;
      try {
        designed = await gemini.designVoice!({ description, name, gender: gender ?? fromRecipe.gender, language: language ?? fromRecipe.language });
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }

      const recipe: VoiceRecipe = {
        provider: 'gemini', type: 'prompted', name: designed.name, description,
        ...(gender ?? fromRecipe.gender ? { gender: gender ?? fromRecipe.gender } : {}),
        ...(language ?? fromRecipe.language ? { language: language ?? fromRecipe.language } : {}),
        model: designed.model, createdAt: new Date().toISOString(),
        ...(designed.expiresAt ? { expiresAt: designed.expiresAt } : {}),
        ...(recreate ? { recreatedFrom: recreate } : {}),
      };
      const done = await finishCreatedVoice(gemini, designed, recipe, {
        replaces: recreate && recipeSource === 'local' ? recreate : null, projectId, returnSample: body.returnSample === 'mp3',
      });
      if (!done.ok) return res.status(500).json(done.body);
      res.json({ ...done.body, recreatedFrom: recreate ?? null, recipeSource });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // POST /voices/clone {name, sample, consent, locale?, recreate?, set?, projectId?, session?, revision?, returnSample?}
  // Clones a voice (#0376) from two base64 16-bit mono WAVs of the same
  // speaker: a 10–30 s sample and the spoken consent statement. Every free
  // check runs before the paid call. The recordings are used for this call
  // only and never written anywhere (owner ruling); the recipe keeps the
  // name, consent locale and dates. `recreate: <old voice_id>` (with new
  // recordings) takes the old clone's name and locale and records the link.
  const cloneJson = express.json({ limit: CLONE_BODY_LIMIT });
  router.post(CLONE_PATH, (req, res, next) => cloneJson(req, res, (err?: unknown) => {
    if (!err) return next();
    const e = err as { status?: number; type?: string; message?: string };
    const tooLarge = e.type === 'entity.too.large' || e.status === 413;
    res.status(tooLarge ? 413 : 400).json({
      ok: false, error: tooLarge ? 'too_large' : 'bad_request',
      message: tooLarge ? 'The recordings are too large (6 MB at most together). Keep the sample to 30 s and the consent to 20 s, in 16-bit mono WAV.' : `The request could not be read: ${e.message ?? 'bad JSON'}`,
    });
  }), async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
      const bad = (message: string, error = 'bad_request') => res.status(400).json({ ok: false, error, message });
      const seenRevision = tts.revision();
      const stamped = typeof body.revision === 'number';
      const stale = () => res.status(409).json({ ok: false, error: 'stale_provider', message: `The voice provider changed (it is now ${TTS_LABELS[tts.active().id]}). Search again.`, revision: tts.revision() });
      if (stamped && (body.revision as number) < seenRevision) return stale();
      let gemini: TtsProvider;
      try {
        gemini = designProvider('Voice cloning');
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      if (!gemini.cloneVoice) return res.status(501).json({ ok: false, error: 'provider_unavailable', message: 'Voice cloning is not available in this version of SlyCode.' });

      let projectId: string | null = null;
      if (body.set === true) {
        const raw = str(body.projectId);
        projectId = raw ? state.resolveProjectIdFrom({ projectId: raw }) : state.resolveProjectIdFrom({ session: str(body.session) });
        if (!projectId) {
          return res.status(404).json({ ok: false, error: 'unknown_project', message: raw ? `Unknown project: '${raw}'.` : 'No project to set the voice on: pass --project <id|name>, or run from a SlyCode terminal.' });
        }
      }

      const recreate = str(body.recreate);
      const old = recreate ? state.getVoiceRecipe(recreate) : null;
      if (recreate && !old) return res.status(404).json({ ok: false, error: 'no_recipe', message: `No saved details for ${recreate}; clone without --recreate and give it a --name.` });
      if (old && old.type !== 'replicated') return res.status(409).json({ ok: false, error: 'designed_voice', message: `${old.name} (${recreate}) is a designed voice; rebuild it with voice design --recreate ${recreate}.` });

      const name = str(body.name) ?? old?.name;
      if (!name) return bad('Give the voice a name.');
      if (name.length > 100) return bad('The name is too long (100 characters at most).');
      const localeRaw = str(body.locale) ?? old?.locale ?? DEFAULT_CONSENT_LOCALE;
      const consentStatement = consentFor(localeRaw);
      if (!consentStatement) return bad(`'${localeRaw}' is not a consent language Google supports. See voice consent-text for the list.`);

      // Both recordings: base64 WAV, 16-bit mono, the right lengths.
      const takes: Record<'sample' | 'consent', Buffer> = { sample: Buffer.alloc(0), consent: Buffer.alloc(0) };
      for (const [key, label, range] of [
        ['sample', 'voice sample', CLONE_SAMPLE_SECONDS],
        ['consent', 'consent recording', CLONE_CONSENT_SECONDS],
      ] as const) {
        const b64 = str(body[key]);
        if (!b64) return bad(`The ${label} is missing.`, 'missing_recording');
        const buf = Buffer.from(b64, 'base64');
        let seconds: number;
        try {
          seconds = pcmSeconds(parseWav(buf));
        } catch (err) {
          return bad(`The ${label} isn't a usable WAV: ${(err as Error).message}. Send 16-bit mono WAV (24 kHz is best).`, 'bad_recording');
        }
        if (seconds < range.min - CLONE_SECONDS_TOLERANCE || seconds > range.max + CLONE_SECONDS_TOLERANCE) {
          return bad(`The ${label} is ${Math.round(seconds * 10) / 10} s; Google needs ${range.min}–${range.max} s.`, 'bad_recording');
        }
        takes[key] = buf;
      }

      if (stamped && tts.revision() !== seenRevision) return stale();
      let cloned: DesignedVoice;
      try {
        cloned = await gemini.cloneVoice({ name, sample: takes.sample, consent: takes.consent });
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      } finally {
        // Nothing of the recordings outlives the call.
        takes.sample.fill(0);
        takes.consent.fill(0);
        delete body.sample;
        delete body.consent;
      }

      const recipe: VoiceRecipe = {
        provider: 'gemini', type: 'replicated', name: cloned.name, description: '', locale: consentStatement.locale,
        model: cloned.model, createdAt: new Date().toISOString(),
        ...(cloned.expiresAt ? { expiresAt: cloned.expiresAt } : {}),
        ...(recreate ? { recreatedFrom: recreate } : {}),
      };
      const done = await finishCreatedVoice(gemini, cloned, recipe, { replaces: recreate ?? null, projectId, returnSample: body.returnSample === 'mp3' });
      if (!done.ok) return res.status(500).json(done.body);
      res.json({ ...done.body, recreatedFrom: recreate ?? null, recordingsKept: false });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // DELETE /voices/:id — remove a designed voice at Google (each Google
  // project holds at most 200). The local recipe is KEPT, marked deleted, so
  // the voice can be recreated. An explicit delete executes even when
  // projects use the voice; the answer names them with the fix.
  router.delete('/voices/:id', async (req, res) => {
    try {
      const id = String(req.params.id);
      if (!isCustomVoiceId(id)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: `Only designed voices (voice_…) can be deleted; '${id}' is a library voice.` });
      }
      let gemini: TtsProvider;
      try {
        gemini = designProvider();
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      let deletedNow: boolean;
      try {
        deletedNow = await gemini.deleteVoice!(id);
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      const warnings: string[] = [];
      const recipeBefore = state.getVoiceRecipe(id);
      const hadRecipe = !!recipeBefore;
      if (hadRecipe) {
        try { state.updateVoiceRecipe(id, { deleted: true, deletedAt: new Date().toISOString() }); } catch (err) { warnings.push(`The recipe could not be marked deleted: ${(err as Error).message}`); }
      }
      const usedBy = state.getProjects()
        .filter((p) => state.getProjectVoice(p.id, 'gemini').stored?.id === id)
        .map((p) => p.name || p.id);
      if (state.getDefaultVoice('gemini')?.id === id) usedBy.push('the install default');
      res.json({
        ok: true, id, deletedNow, alreadyGone: !deletedNow, recipeKept: hadRecipe, usedBy,
        type: recipeBefore?.type ?? (hadRecipe ? 'prompted' : null),
        fix: usedBy.length ? customVoiceFix(id, recipeKind(recipeBefore)) : null,
        warnings,
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // GET /tts/project-voices?provider= — every registered project's voice for
  // one provider (default: active), for the web voice picker (feature 087
  // phase 3). Stamped with the switch revision like /voices/search.
  router.get('/tts/project-voices', (req, res) => {
    try {
      let provider: TtsProvider;
      try {
        provider = providerFromRequest(req);
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      const projects = state.getProjects().map((p) => {
        const { ok: _ok, slots: _slots, ...voice } = projectVoicePayload(p.id, provider);
        return { ...voice, name: p.name || p.id };
      });
      // The voice a project without its own uses (feature 087 picker): the
      // stored install default, else the .env voice, else the built-in one.
      const stored = state.getDefaultVoice(provider.id);
      const env = provider.envDefaultVoice();
      const builtin = provider.builtinDefaultVoice();
      const installDefault = stored
        ? { voice: { id: stored.id, name: stored.name }, source: 'state' as const }
        : env ? { voice: { id: env.id, name: env.name }, source: 'env' as const }
        : builtin ? { voice: { id: builtin.id, name: builtin.name }, source: 'builtin' as const }
        : { voice: null, source: null };
      res.json({ ok: true, provider: provider.id, revision: tts.revision(), projects, installDefault });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // POST /voices/preview {voiceId, voiceName?, provider, revision?} — one
  // short fixed sentence in that voice, returned as audio/mpeg (feature 087
  // phase 3). The web picker plays it locally; it never reaches a channel or
  // the speaker stream. Same stale-pick rule as PUT /projects/:id/voice.
  // Repeats are served from the renderer's chunk cache, so re-pressing play
  // costs nothing.
  router.post('/voices/preview', async (req, res) => {
    try {
      const { voiceId, voiceName, revision } = req.body ?? {};
      if (typeof voiceId !== 'string' || !voiceId.trim()) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'voiceId is required' });
      }
      let provider: TtsProvider;
      try {
        provider = providerFromRequest(req);
        if (!provider.isConfigured()) {
          throw new TtsProviderError('tts_unconfigured', `TTS provider (${provider.label}) is not configured, so voices can't be previewed.`);
        }
      } catch (err) {
        const r = errorResponse(err);
        return res.status(r.status).json(r.body);
      }
      // Stamp and cancellation are in place BEFORE the first await: a switch
      // or a hang-up during the voice lookup must never start a paid render.
      const seenRevision = tts.revision();
      const stale = () => res.status(409).json({ ok: false, error: 'stale_provider', message: `That voice list is out of date (the provider is now ${TTS_LABELS[tts.active().id]}). Search again.`, revision: tts.revision() });
      if (typeof revision === 'number' && revision < seenRevision) return stale();
      const abort = new AbortController();
      res.on('close', () => { if (!res.writableFinished) abort.abort(); });
      const id = voiceId.trim();
      let voice: VoiceRef = { provider: provider.id, id, name: typeof voiceName === 'string' && voiceName ? voiceName : id };
      // Gemini ids are checked first (catalogue is cached) so a typo is a 404,
      // not a paid request; ElevenLabs ids are taken as given, as for set.
      if (provider.id !== 'elevenlabs' && provider.getVoice) {
        try {
          const info = await provider.getVoice(id);
          if (!info) return res.status(404).json({ ok: false, error: 'voice_not_found', message: `No ${provider.label} voice with id '${id}'.` });
          // Keep kind/expiry so an expired designed voice is refused at admission, unpaid.
          voice = {
            provider: provider.id, id: info.voice_id, name: info.name,
            ...(info.category === 'custom' ? { kind: 'custom' as const } : {}),
            ...(info.expiresAt ? { expiresAt: info.expiresAt } : {}),
          };
        } catch (err) {
          if (err instanceof VoicesUnavailableError) return res.status(502).json({ ok: false, error: 'voices_unavailable', message: err.message });
          throw err;
        }
      }
      if (abort.signal.aborted) return; // the caller left during the lookup
      if (tts.revision() !== seenRevision) return stale();
      try {
        const result = await tts.renderer.renderSpeech({
          provider, providerRevision: seenRevision, voice, text: VOICE_PREVIEW_TEXT, format: 'mp3',
          timeoutMs: TTS_PREVIEW_TIMEOUT_MS, signal: abort.signal, purpose: 'voice', speed: tts.config.ttsSpeed,
        });
        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'no-store');
        res.set('X-Voice-Provider', provider.id);
        res.send(result.buffer);
      } catch (err) {
        const r = errorResponse(err);
        if (!res.headersSent && !res.writableEnded) res.status(r.status).json(r.body);
      }
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  // GET /tts/provider — the install-wide TTS provider and its status (read-only
  // in this build; the switch lands with the Gemini provider). Never
  // references `channel`.
  // PUT /tts/provider {provider} — switch the install's TTS provider after
  // validation (design §2): 400 provider_unavailable|provider_unconfigured,
  // 409 unusable_voices with refusals (nothing changed), 200 with the new
  // health + `unverified` voices. Never references the channel.
  router.put('/tts/provider', async (req, res) => {
    try {
      const target = req.body?.provider;
      if (!isTtsProviderId(target)) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: "provider must be 'elevenlabs' or 'gemini'" });
      }
      if (tts.active().id === target && tts.active().source === 'state') {
        return res.json({ ok: true, ...tts.health(), unverified: [], unchanged: true });
      }
      let result;
      try {
        result = await tts.switchProvider(target);
      } catch (err) {
        return res.status(500).json({ ok: false, error: 'persist_failed', message: `Provider not switched: ${(err as Error).message}` });
      }
      if (!result.ok) {
        return res.status(result.status).json({ ok: false, error: result.error, message: result.message, refusals: result.refusals, unverified: result.unverified });
      }
      res.json({ ok: true, ...result.health, unverified: result.unverified });
    } catch (err) {
      res.status(500).json({ ok: false, error: 'internal_error', message: (err as Error).message });
    }
  });

  router.get('/tts/provider', (_req, res) => {
    res.json({ ok: true, ...tts.health() });
  });


  return router;
}
