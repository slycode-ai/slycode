#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { CONSENT_STATEMENTS, consentFor } from './tts/consent-statements.js';
import { recordingAsWav as readRecordingAsWav } from './tts/recording-wav.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const DEV_PORT = 3005;
const PROD_PORT = parseInt(process.env.MESSAGING_SERVICE_PORT || process.env.TELEGRAM_SERVICE_PORT || '7593', 10);
const CACHE_FILE = path.join(os.homedir(), '.slycode', 'messaging-port');

function readCachedPort(): number | null {
  try {
    const cached = fs.readFileSync(CACHE_FILE, 'utf-8').trim();
    const port = parseInt(cached, 10);
    return isNaN(port) ? null : port;
  } catch {
    return null;
  }
}

function writeCachedPort(port: number): void {
  try {
    fs.writeFileSync(CACHE_FILE, String(port));
  } catch {
    // ~/.slycode may not exist yet — non-critical
  }
}

async function isHealthy(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function detectPort(): Promise<number> {
  const cached = readCachedPort();

  // Try cached port first
  if (cached && await isHealthy(cached)) return cached;

  // Probe dev then prod
  const candidates = cached === PROD_PORT ? [DEV_PORT, PROD_PORT] : [DEV_PORT, PROD_PORT];
  for (const port of candidates) {
    if (port === cached) continue; // already tried
    if (await isHealthy(port)) {
      writeCachedPort(port);
      return port;
    }
  }

  // Nothing found — return dev default, let send() surface the error
  return DEV_PORT;
}

async function send(message: string, tts: boolean, port: number): Promise<void> {
  const endpoint = tts ? '/voice' : '/send';
  const url = `http://localhost:${port}${endpoint}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        ...(process.env.SLYCODE_SESSION && { session: process.env.SLYCODE_SESSION }),
      }),
    });

    const data = await res.json() as { success?: boolean; error?: string };

    if (!res.ok) {
      console.error(`Error: ${data.error || 'Unknown error'}`);
      process.exit(1);
    }

    writeCachedPort(port);
    console.log(tts ? 'Voice message sent.' : 'Message sent.');
  } catch (err) {
    if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
      console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh. If you don\'t need messaging, tell the user they can remove the messaging skill from this project.');
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

async function generate(
  text: string,
  opts: { voiceId?: string; outDir?: string; filename?: string; format?: 'ogg' | 'mp3' | 'wav'; projectId?: string },
  port: number,
): Promise<void> {
  const url = `http://localhost:${port}/tts/generate`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        ...(opts.voiceId !== undefined && { voiceId: opts.voiceId }),
        ...(opts.outDir !== undefined && { outDir: opts.outDir }),
        ...(opts.filename !== undefined && { filename: opts.filename }),
        ...(opts.format !== undefined && { format: opts.format }),
        ...(opts.projectId !== undefined && { projectId: opts.projectId }),
        // Forward the caller's session so the endpoint can pick the project's
        // default voice when no --voice-id is given (same as send/--tts).
        ...(process.env.SLYCODE_SESSION && { session: process.env.SLYCODE_SESSION }),
      }),
    });
    const data = await res.json() as { ok?: boolean; absolutePath?: string; path?: string; format?: string; bytes?: number; error?: string; message?: string };
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    writeCachedPort(port);
    console.log(data.absolutePath);
  } catch (err) {
    if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
      console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

async function sendFile(filePath: string, caption: string | undefined, asOverride: 'document' | undefined, port: number): Promise<void> {
  const url = `http://localhost:${port}/send/file`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: filePath,
        cwd: process.cwd(),
        ...(caption !== undefined && { caption }),
        ...(asOverride !== undefined && { as: asOverride }),
        // Forward the caller's session so the endpoint can emit a 'Switch to
        // Card' button when the file comes from a non-active session (same as
        // /send and /voice).
        ...(process.env.SLYCODE_SESSION && { session: process.env.SLYCODE_SESSION }),
      }),
    });
    const data = await res.json() as { ok?: boolean; channel?: string; kind?: string; messageId?: number; bytes?: number; error?: string; message?: string };
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    writeCachedPort(port);
    console.log(`Sent ${data.kind} (channel=${data.channel}, message_id=${data.messageId}, bytes=${data.bytes})`);
  } catch (err) {
    if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
      console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

interface VoiceResult {
  voice_id: string;
  name: string;
  category: string;
  description: string;
  labels?: Record<string, string>;
  expiresAt?: string;
}

/** One line per voice: id, name, category + accent/gender/language when known, description, expiry. */
function voiceLine(v: VoiceResult): string {
  // Custom voices say how they were made: "custom, cloned" / "custom, designed" (#0376).
  const extra = [v.category, v.labels?.origin, v.labels?.accent, v.labels?.gender, v.labels?.language].filter(Boolean).join(', ');
  const desc = v.description ? ` — ${v.description}` : '';
  const exp = v.expiresAt ? ` [expires ${v.expiresAt.slice(0, 10)}]` : '';
  return `${v.voice_id}  ${v.name} (${extra})${desc}${exp}`;
}

async function searchVoicesCmd(query: string | undefined, port: number, filters: Record<string, string> = {}): Promise<void> {
  const qs = new URLSearchParams({ ...(query ? { q: query } : {}), ...filters }).toString();
  const url = `http://localhost:${port}/voices/search${qs ? `?${qs}` : ''}`;
  try {
    const res = await fetch(url);
    const data = await res.json() as {
      ok?: boolean; provider?: string; voices?: Array<VoiceResult & { recipe?: boolean }>; error?: string; message?: string;
      recipes?: Array<{ voice_id: string; name: string; type?: 'prompted' | 'replicated'; description: string; expiresAt: string | null; deleted: boolean; replacedBy: string | null }>;
    };
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    writeCachedPort(port);
    const voices = data.voices || [];
    const recipes = data.recipes || [];
    if (voices.length === 0 && recipes.length === 0) {
      console.log(query ? `No voices found for "${query}".` : filters.custom ? 'No designed or cloned voices yet. Make one with voice design "<description>" --name <name>, or voice clone.' : 'No voices found.');
      return;
    }
    if (data.provider) console.log(`Provider: ${TTS_LABELS[data.provider] ?? data.provider}`);
    for (const v of voices) console.log(`${voiceLine(v)}${v.recipe && v.labels?.origin !== 'cloned' ? ' (recipe saved)' : ''}`);
    // Designed voices that are gone at Google but whose recipe is kept (phase 4).
    if (recipes.length) {
      console.log(`\nSaved details of voices no longer at ${TTS_LABELS[data.provider ?? ''] ?? 'the provider'} (designed: voice design --recreate <id>; cloned: record again with voice clone --recreate <id>):`);
      for (const r of recipes) {
        const state = r.replacedBy ? `replaced by ${r.replacedBy}` : r.deleted ? 'deleted' : r.expiresAt && Date.parse(r.expiresAt) <= Date.now() ? `expired ${r.expiresAt.slice(0, 10)}` : 'not found';
        const what = r.type === 'replicated' ? 'cloned; recordings not kept' : r.description.length > 80 ? `${r.description.slice(0, 77)}…` : r.description;
        console.log(`${r.voice_id}  ${r.name} (${state}) — ${what}`);
      }
    }
  } catch (err) {
    if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
      console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

// --- Project voice (feature 086) ------------------------------------------
// `voice set|show|clear` talk to /projects/:id/voice. Project resolution:
// --project <id|name|key>, else `_session` + the caller's SLYCODE_SESSION.


function projectRouteTarget(projectArg: string | undefined): { idSegment: string; query: string } {
  if (projectArg) return { idSegment: encodeURIComponent(projectArg), query: '' };
  const session = process.env.SLYCODE_SESSION;
  if (session) return { idSegment: '_session', query: `?session=${encodeURIComponent(session)}` };
  console.error('Error: no project given. Pass --project <id|name>, or run from a SlyCode terminal (SLYCODE_SESSION).');
  process.exit(1);
}

type SlotView = { stored: { id: string; name: string } | null; effective: { id: string; name: string } | null; source: string | null };

interface ProjectVoicePayload {
  ok?: boolean;
  projectId?: string;
  provider?: string;
  stored?: { id: string; name: string } | null;
  effective?: { id: string; name: string } | null;
  source?: 'project' | 'inherited' | 'env' | 'builtin' | null;
  slots?: Record<string, SlotView>;
  warnings?: string[];
  error?: string;
  message?: string;
  candidates?: Array<{ voice_id: string; name: string; category: string; description?: string; labels?: Record<string, string> }>;
}

const TTS_LABELS: Record<string, string> = { elevenlabs: 'ElevenLabs', gemini: 'Gemini' };

function printProjectVoice(data: ProjectVoicePayload): void {
  const fmt = (v: { id: string; name: string } | null | undefined) => (v ? `${v.name} (${v.id})` : 'none');
  console.log(`Project:   ${data.projectId}`);
  if (data.provider) console.log(`Provider:  ${TTS_LABELS[data.provider] ?? data.provider}`);
  console.log(`Stored:    ${fmt(data.stored)}`);
  console.log(`Effective: ${fmt(data.effective)}${data.source ? ` [${data.source}]` : ''}`);
  // Every provider keeps its own slot; a provider switch rewrites none of them.
  const others = Object.entries(data.slots ?? {}).filter(([p]) => p !== data.provider);
  for (const [p, slot] of others) {
    console.log(`${(TTS_LABELS[p] ?? p) + ':'} ${slot.stored ? `${fmt(slot.stored)} [project]` : slot.effective ? `${fmt(slot.effective)} [${slot.source}]` : 'none'} (used when the install switches to ${TTS_LABELS[p] ?? p})`);
  }
  for (const w of data.warnings ?? []) console.log(`Warning:   ${w}`);
}

// --- TTS provider (feature 087) ---------------------------------------------

interface SpeechHealthPayload {
  ok?: boolean;
  provider?: string;
  providerSource?: string;
  revision?: number;
  ready?: boolean;
  reason?: { code: string; message: string } | null;
  providers?: Record<string, { configured: boolean; available: boolean; defaultVoice: { id: string; name: string } | null; defaultVoiceSource: string | null }>;
  warnings?: string[];
  error?: string;
  message?: string;
}

interface SwitchProblemPayload { projectName: string; voice: { id: string; name: string } | null; reason: string; fix: string }

async function ttsSwitchCmd(target: 'elevenlabs' | 'gemini', port: number): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/tts/provider`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: target }) });
    const data = await res.json() as SpeechHealthPayload & { refusals?: SwitchProblemPayload[]; unverified?: SwitchProblemPayload[]; unchanged?: boolean };
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      for (const r of data.refusals ?? []) console.error(`  ${r.projectName}: ${r.reason}${r.fix ? ` — fix: ${r.fix}` : ''}`);
      process.exit(1);
    }
    writeCachedPort(port);
    console.log(data.unchanged ? `Already on ${TTS_LABELS[target]}.` : `Switched the install to ${TTS_LABELS[target]} (revision ${data.revision}). Takes effect on the next render.`);
    for (const u of data.unverified ?? []) console.log(`  Couldn't check ${u.projectName}'s voice ${u.voice ? `${u.voice.name} (${u.voice.id})` : ''}: ${u.reason}`);
    for (const w of data.warnings ?? []) console.log(`Warning:   ${w}`);
  } catch (err) {
    if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
      console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

async function ttsShowCmd(port: number): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/tts/provider`);
    const data = await res.json() as SpeechHealthPayload;
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    writeCachedPort(port);
    const sourceText: Record<string, string> = { state: 'switched explicitly', env: 'TTS_PROVIDER in .env', auto: 'automatic (from the keys in .env)' };
    console.log(`Provider:  ${TTS_LABELS[data.provider ?? ''] ?? data.provider} — ${sourceText[data.providerSource ?? ''] ?? data.providerSource} (revision ${data.revision ?? 0})`);
    console.log(`Ready:     ${data.ready ? 'yes' : `no — ${data.reason?.message ?? 'unknown reason'}`}`);
    for (const [p, st] of Object.entries(data.providers ?? {})) {
      const state = !st.available ? 'not available in this build' : st.configured ? 'key set' : 'no key';
      const voice = st.defaultVoice ? `${st.defaultVoice.name} (${st.defaultVoice.id}) [${st.defaultVoiceSource}]` : 'none';
      console.log(`  ${(TTS_LABELS[p] ?? p).padEnd(10)} ${state}; default voice: ${voice}`);
    }
    for (const w of data.warnings ?? []) console.log(`Warning:   ${w}`);
  } catch (err) {
    if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
      console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

async function projectVoiceCmd(
  action: 'set' | 'show' | 'clear',
  value: string | undefined,
  opts: { projectId?: string; forceId?: boolean; provider?: string },
  port: number,
): Promise<void> {
  const target = projectRouteTarget(opts.projectId);
  const providerQuery = opts.provider ? `${target.query ? '&' : '?'}provider=${encodeURIComponent(opts.provider)}` : '';
  const url = `http://localhost:${port}/projects/${target.idSegment}/voice${target.query}${providerQuery}`;
  const init: RequestInit = { headers: { 'Content-Type': 'application/json' } };
  if (action === 'show') {
    init.method = 'GET';
  } else if (action === 'clear') {
    init.method = 'DELETE';
  } else {
    if (!value) {
      console.error('Error: voice set requires a voice id or exact voice name');
      process.exit(1);
    }
    init.method = 'PUT';
    // The service decides whether the value is an id or an exact name, per provider (feature 087).
    init.body = JSON.stringify({ ...(opts.forceId ? { voiceId: value } : { voice: value }), ...(opts.provider ? { provider: opts.provider } : {}) });
  }
  try {
    const res = await fetch(url, init);
    const data = await res.json() as ProjectVoicePayload;
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      for (const c of data.candidates || []) console.error(`  ${voiceLine(c as VoiceResult)}`);
      process.exit(1);
    }
    writeCachedPort(port);
    if (action === 'clear') console.log('Project voice cleared (back to the inherited default).');
    printProjectVoice(data);
  } catch (err) {
    if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
      console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
    } else {
      console.error(`Error: ${(err as Error).message}`);
    }
    process.exit(1);
  }
}


// --- Designed voices (feature 087 phase 4) -----------------------------------

function serviceDown(err: unknown): never {
  if ((err as Error).message.includes('ECONNREFUSED') || (err as Error).message === 'fetch failed') {
    console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
  } else {
    console.error(`Error: ${(err as Error).message}`);
  }
  process.exit(1);
}

interface DesignOptions { name?: string; gender?: string; language?: string; set: boolean; projectId?: string; recreate?: string }

async function voiceDesignCmd(description: string | undefined, opts: DesignOptions, port: number): Promise<void> {
  const body: Record<string, unknown> = {
    ...(description ? { description } : {}),
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.gender ? { gender: opts.gender } : {}),
    ...(opts.language ? { language: opts.language } : {}),
    ...(opts.recreate ? { recreate: opts.recreate } : {}),
  };
  if (opts.set) {
    body.set = true;
    if (opts.projectId) body.projectId = opts.projectId;
    else if (process.env.SLYCODE_SESSION) body.session = process.env.SLYCODE_SESSION;
  }
  console.log(opts.recreate ? `Recreating ${opts.recreate} from its recipe (takes about 30 seconds)…` : 'Designing the voice (takes about 30 seconds)…');
  try {
    const res = await fetch(`http://localhost:${port}/voices/design`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json() as {
      ok?: boolean; error?: string; message?: string;
      voice?: { id: string; name: string; expiresAt: string | null };
      recipeSource?: 'local' | 'remote' | null; recreatedFrom?: string | null;
      samplePath?: string | null; set?: ProjectVoicePayload | null; activeProvider?: string; warnings?: string[];
    };
    if (!res.ok || !data.ok || !data.voice) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    writeCachedPort(port);
    const v = data.voice;
    console.log(`Voice:     ${v.name} (${v.id})`);
    console.log(`Expires:   ${v.expiresAt ? v.expiresAt.slice(0, 10) : 'unknown'} (Google keeps designed voices for a year; the recipe is saved so it can be recreated)`);
    if (data.recreatedFrom) {
      console.log(`Recreated: from ${data.recreatedFrom}'s ${data.recipeSource === 'remote' ? "recipe at Google (now also saved locally)" : 'saved recipe'}. It sounds similar, not identical.`);
      if (!data.set) console.log(`           Projects still point at ${data.recreatedFrom}; switch one with voice set ${v.id} --provider gemini --project <p>.`);
    }
    if (data.samplePath) console.log(`Sample:    ${data.samplePath}`);
    if (data.set) {
      console.log(`Set for:   ${data.set.projectId} (Gemini voice)`);
      if (data.activeProvider && data.activeProvider !== 'gemini') console.log(`           The install speaks with ${TTS_LABELS[data.activeProvider] ?? data.activeProvider} right now; this voice is used once it switches to Gemini.`);
    }
    for (const w of data.warnings ?? []) console.log(`Warning:   ${w}`);
  } catch (err) {
    serviceDown(err);
  }
}

async function voiceDeleteCmd(id: string, port: number): Promise<void> {
  try {
    const res = await fetch(`http://localhost:${port}/voices/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json() as { ok?: boolean; error?: string; message?: string; alreadyGone?: boolean; recipeKept?: boolean; type?: 'prompted' | 'replicated' | null; usedBy?: string[]; fix?: string | null; warnings?: string[] };
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    writeCachedPort(port);
    console.log(data.alreadyGone ? `${id} was already gone at Google.` : `Deleted ${id} at Google.`);
    console.log(data.type === 'replicated'
      ? `It was a cloned voice; its recordings were never kept. To have it again, record new ones: voice clone --sample <file.wav> --consent <file.wav> --recreate ${id}.`
      : data.recipeKept ? `Its recipe is kept: voice design --recreate ${id} makes a similar voice.` : 'There was no local recipe for it.');
    if (data.usedBy?.length) console.log(`Warning:   still set for ${data.usedBy.join(', ')}; those can't speak until you ${data.fix}.`);
    for (const w of data.warnings ?? []) console.log(`Warning:   ${w}`);
  } catch (err) {
    serviceDown(err);
  }
}

interface CloneOptions { sample?: string; consent?: string; name?: string; locale?: string; set: boolean; projectId?: string; recreate?: string }

/** A recording as 16-bit mono WAV (tts/recording-wav.ts), or exit with its plain error. */
function recordingAsWav(file: string, label: string): Buffer {
  try {
    return readRecordingAsWav(file, label);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

async function voiceCloneCmd(opts: CloneOptions, sample: Buffer, consent: Buffer, port: number): Promise<void> {
  const body: Record<string, unknown> = {
    sample: sample.toString('base64'),
    consent: consent.toString('base64'),
    ...(opts.name ? { name: opts.name } : {}),
    ...(opts.locale ? { locale: opts.locale } : {}),
    ...(opts.recreate ? { recreate: opts.recreate } : {}),
  };
  if (opts.set) {
    body.set = true;
    if (opts.projectId) body.projectId = opts.projectId;
    else if (process.env.SLYCODE_SESSION) body.session = process.env.SLYCODE_SESSION;
  }
  console.log('Cloning the voice (Google checks the consent recording; takes about 30 seconds)…');
  try {
    const res = await fetch(`http://localhost:${port}/voices/clone`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json() as {
      ok?: boolean; error?: string; message?: string;
      voice?: { id: string; name: string; expiresAt: string | null };
      recreatedFrom?: string | null; samplePath?: string | null; set?: ProjectVoicePayload | null; activeProvider?: string; warnings?: string[];
    };
    if (!res.ok || !data.ok || !data.voice) {
      console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    writeCachedPort(port);
    const v = data.voice;
    console.log(`Voice:     ${v.name} (${v.id}), cloned`);
    console.log(`Expires:   ${v.expiresAt ? v.expiresAt.slice(0, 10) : 'unknown'} (Google keeps cloned voices for a year; the recordings aren't kept, so record again to renew it)`);
    if (data.recreatedFrom && !data.set) console.log(`Replaces:  ${data.recreatedFrom}; projects still point at it until you voice set ${v.id} --provider gemini --project <p>.`);
    if (data.samplePath) console.log(`Sample:    ${data.samplePath}`);
    if (data.set) {
      console.log(`Set for:   ${data.set.projectId} (Gemini voice)`);
      if (data.activeProvider && data.activeProvider !== 'gemini') console.log(`           The install speaks with ${TTS_LABELS[data.activeProvider] ?? data.activeProvider} right now; this voice is used once it switches to Gemini.`);
    } else {
      console.log(`Try it:    voice set ${v.id} --provider gemini, or preview it from Voice Settings.`);
    }
    for (const w of data.warnings ?? []) console.log(`Warning:   ${w}`);
  } catch (err) {
    serviceDown(err);
  }
}

// ---------------------------------------------------------------------------
// speak — spoken reply in the web terminal (feature 086, spec Task 8)
// ---------------------------------------------------------------------------
// Talks ONLY to the bridge that spawned this terminal (SLYCODE_BRIDGE_URL),
// never to the messaging service and never to a probed/cached port: the
// bridge is the single admission authority (speaker flag, listeners, length,
// budget) and it orchestrates the paid render itself. A refusal is the
// user's setting or state, not an error — print it verbatim and exit 1.
async function speak(text: string): Promise<void> {
  const session = process.env.SLYCODE_SESSION;
  const bridgeUrl = process.env.SLYCODE_BRIDGE_URL;
  if (!session) {
    console.error('Error: no_session: no registered session (SLYCODE_SESSION missing or unknown); speak only works from a SlyCode terminal');
    process.exit(1);
  }
  if (!bridgeUrl) {
    console.error('Error: no_bridge: bridge URL not provided (SLYCODE_BRIDGE_URL missing); speak only works from a SlyCode terminal');
    process.exit(1);
  }
  // One idempotency id per invocation, reused across transport retries so a
  // lost HTTP response can never turn into a second paid render.
  const requestId = (await import('crypto')).randomUUID();
  const url = `${bridgeUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(session)}/speak`;
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, requestId }),
        signal: AbortSignal.timeout(40_000),
      });
    } catch (err) {
      const msg = (err as Error).message || '';
      const transient = msg.includes('ECONNREFUSED') || msg === 'fetch failed' || msg.includes('ECONNRESET') || (err as Error).name === 'TimeoutError';
      if (transient && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
      console.error(transient
        ? 'Error: bridge_unreachable: the terminal bridge did not answer; speak only works from a running SlyCode terminal'
        : `Error: ${msg}`);
      process.exit(1);
    }
    let data: { ok?: boolean; code?: string; message?: string; delivered?: number; replayed?: boolean } = {};
    try { data = await res.json() as typeof data; } catch { /* non-JSON body */ }
    if (!res.ok || !data.ok) {
      console.error(`Error: ${data.code || `http_${res.status}`}: ${data.message || 'no message'}`);
      process.exit(1);
    }
    const n = typeof data.delivered === 'number' ? data.delivered : 0;
    console.log(`Spoken (delivered to ${n} browser${n === 1 ? '' : 's'}): "${text}"`);
    return;
  }
}

function printUsage(): void {
  console.log(`Usage: messaging-cli <command> [args]

Commands:
  send <message>                       Send a text message to the active channel
  send <message> --tts                 Send a voice message (text-to-speech).
                                       Telegram voice replies: up to 5,000
                                       characters, a fixed limit.
  send-file <path> [--caption "..."]   Send an existing audio/video file
                  [--as document]      Force document delivery (escape hatch
                                       for unsupported MIME types)
  generate <text> [--voice-id <id>]    Render TTS audio to disk without sending.
                  [--out-dir <path>]   Default: data/generated-audio/<date>/.
                  [--filename <name>]  Default format: ogg. Prints absolute
                  [--format ogg|mp3|wav] path on success.
                  [--project <id|name>] Project whose voice to use when no
                                       --voice-id is given (optional). Accepts
                                       the project id, display name (case-
                                       insensitive), or session key. Falls
                                       back to the caller's session, then the
                                       global default voice. Unknown projects
                                       are rejected with an error.
  speak <text>                         Short spoken summary played in the web
                                       UI (every connected browser). ONLY when
                                       the user explicitly asked this session
                                       for spoken summaries; the speaker toggle
                                       is permission, not an instruction.
                                       Length: the browser reply word limit
                                       in Voice Settings (default 60 words);
                                       it does not apply to Telegram.
                                       Refusals (sound off, nobody listening,
                                       too long, budget) are final — never
                                       work around them with generate/--tts.
  voices [query]                       Search the active TTS provider's voices
                  [--provider <p>]     (or --provider's). Prints voice IDs.
                  [--gender <g>]       Gemini filters: --gender female|male,
                  [--accent <a>]       --accent (substring, e.g. "Sydney"),
                  [--language <xx>]    --language en or en-GB, --custom (your
                  [--custom]           designed voices only).
  voice set <id|name> [--project <p>]  Set a project's TTS voice (used by
                  [--voice-id]         Telegram AND terminal spoken replies).
                  [--provider <p>]     The value may be a voice id or an exact
                                       voice name (the service decides, per
                                       provider). --project defaults to the
                                       caller's session project. Each TTS
                                       provider keeps its own voice per
                                       project; --provider picks which
                                       (default: the active provider).
  voice show [--project <p>]           Print the stored and effective voice
                  [--provider <p>]     for the active provider, plus the
                                       voice kept for the other provider.
  voice clear [--project <p>]          Remove the project's override (falls
                  [--provider <p>]     back to the inherited default).
  voice design "<description>"         Design a Gemini voice from a description
                  --name <name>        (only when the user asks for a new
                  [--gender <g>]       voice). Saves the recipe locally, then
                  [--language <xx-YY>] prints the id, expiry (1 year) and a
                  [--set] [--project]  sample path. --set makes it the
                                       project's Gemini voice.
  voice design --recreate <voice_id>   Rebuild an expired or deleted designed
                  [--name] [--set]     voice from its recipe (similar, not
                                       identical). Never re-points projects
                                       unless --set is given.
  voice clone --sample <file>          Clone a Gemini voice from two recordings
                  --consent <file>     of the same person (only when the user
                  --name <name>        asks): a 10–30 s sample of natural
                  [--locale <xx-YY>]   speech, and the consent statement read
                  [--set] [--project]  aloud (see consent-text). WAV, or any
                                       format ffmpeg reads. The recordings are
                                       sent to Google once and never kept.
  voice clone --recreate <voice_id>    Clone again from NEW recordings, taking
                  --sample --consent   the old clone's name and language.
  voice consent-text [--locale <l>]    Print the consent statement to read
                                       (all 30 languages without --locale).
  voice delete <voice_id>              Delete a designed or cloned voice at
                                       Google (a designed voice's recipe is
                                       kept for --recreate).
  tts show                             Print the install's TTS provider, how
                                       it was chosen, readiness and each
                                       provider's default voice.
  tts provider <elevenlabs|gemini>     Switch the install's TTS provider. Only
                                       when the user asks. Refused, with the
                                       projects named, if it would leave a
                                       project without a usable voice.

Examples:
  messaging-cli send "The build is complete"
  messaging-cli send "Here's a summary of the changes" --tts
  messaging-cli send-file ./tmp/preview.mp4 --caption "Confirm before posting?"
  messaging-cli send-file ./logs/run.txt --as document
  messaging-cli generate "intro for the new feature"
  messaging-cli generate "[whispers] secret stuff" --format mp3 --out-dir /tmp
  messaging-cli generate "ship note" --project SlyCode
  messaging-cli voices "Rachel"
  messaging-cli voice set "Rachel" --project SlyCode
  messaging-cli voice show
  messaging-cli tts show
  messaging-cli speak "tests pass, one thing left to check on the modal"`);
}

// Parse arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  printUsage();
  process.exit(0);
}

const command = args[0];

/**
 * The value after a valued flag. A missing value, or one that is itself a
 * flag (`--name --set`), fails here, before any network call (#0369 fix loop).
 */
function flagValue(rest: string[], i: number, flag: string, hint = ''): string {
  const v = rest[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`Error: ${flag} requires a value${hint}${v !== undefined ? ` (got the flag ${v})` : ''}`);
    process.exit(1);
  }
  return v;
}

if (command === 'send') {
  const tts = args.includes('--tts');
  const messageArgs = args.slice(1).filter(a => a !== '--tts');
  const message = messageArgs.join(' ');

  if (!message) {
    console.error('Error: Message is required.');
    printUsage();
    process.exit(1);
  }

  // Interpret escape sequences (\n, \t) and undo shell escaping (\!)
  const parsed = message.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\!/g, '!');

  const port = await detectPort();
  send(parsed, tts, port);
} else if (command === 'send-file') {
  // Parse: send-file <path> [--caption "..."] [--as document] [-- <path-with-leading-dash>]
  const rest = args.slice(1);
  let filePath: string | undefined;
  let caption: string | undefined;
  let asOverride: 'document' | undefined;
  let i = 0;
  let pastSeparator = false;
  while (i < rest.length) {
    const arg = rest[i];
    if (!pastSeparator && arg === '--') {
      pastSeparator = true;
      i++;
      continue;
    }
    if (!pastSeparator && arg === '--caption') {
      caption = rest[i + 1];
      if (caption === undefined) {
        console.error('Error: --caption requires a value');
        process.exit(1);
      }
      i += 2;
      continue;
    }
    if (!pastSeparator && arg === '--as') {
      const value = rest[i + 1];
      if (value !== 'document') {
        console.error("Error: --as only accepts 'document' in v1");
        process.exit(1);
      }
      asOverride = 'document';
      i += 2;
      continue;
    }
    if (!pastSeparator && arg.startsWith('--')) {
      console.error(`Error: unknown flag: ${arg}`);
      process.exit(1);
    }
    if (filePath === undefined) {
      filePath = arg;
      i++;
      continue;
    }
    console.error(`Error: unexpected argument: ${arg}`);
    process.exit(1);
  }

  if (!filePath) {
    console.error('Error: send-file requires a path argument');
    printUsage();
    process.exit(1);
  }

  const port = await detectPort();
  sendFile(filePath, caption, asOverride, port);
} else if (command === 'generate') {
  // Parse: generate <text> [--voice-id <id>] [--out-dir <path>] [--filename <name>] [--format ogg|mp3|wav] [--project <id>]
  const rest = args.slice(1);
  let text: string | undefined;
  let voiceId: string | undefined;
  let outDir: string | undefined;
  let filename: string | undefined;
  let format: 'ogg' | 'mp3' | 'wav' | undefined;
  let projectId: string | undefined;
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg === '--voice-id') {
      voiceId = flagValue(rest, i, '--voice-id');
      i += 2;
      continue;
    }
    if (arg === '--project') {
      projectId = flagValue(rest, i, '--project');
      i += 2;
      continue;
    }
    if (arg === '--out-dir') {
      outDir = flagValue(rest, i, '--out-dir');
      i += 2;
      continue;
    }
    if (arg === '--filename') {
      filename = flagValue(rest, i, '--filename');
      i += 2;
      continue;
    }
    if (arg === '--format') {
      const v = rest[i + 1];
      if (v !== 'ogg' && v !== 'mp3' && v !== 'wav') { console.error("Error: --format must be 'ogg', 'mp3' or 'wav'"); process.exit(1); }
      format = v;
      i += 2;
      continue;
    }
    if (arg.startsWith('--')) {
      console.error(`Error: unknown flag: ${arg}`);
      process.exit(1);
    }
    if (text === undefined) {
      text = arg;
      i++;
      continue;
    }
    console.error(`Error: unexpected argument: ${arg}`);
    process.exit(1);
  }

  if (!text) {
    console.error('Error: generate requires a text argument');
    printUsage();
    process.exit(1);
  }

  const port = await detectPort();
  await generate(text, { voiceId, outDir, filename, format, projectId }, port);
} else if (command === 'voices') {
  const rest = args.slice(1);
  const words: string[] = [];
  const filters: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const flag = ({ '--provider': 'provider', '--gender': 'gender', '--accent': 'accent', '--language': 'language' } as Record<string, string>)[arg];
    if (flag) {
      filters[flag] = flagValue(rest, i, arg);
      i++;
    } else if (arg === '--custom') {
      filters.custom = '1';
    } else if (arg.startsWith('--')) {
      console.error(`Error: unknown flag: ${arg}`);
      process.exit(1);
    } else {
      words.push(arg);
    }
  }
  const port = await detectPort();
  await searchVoicesCmd(words.join(' ') || undefined, port, filters);
} else if (command === 'voice' && args[1] === 'design') {
  const rest = args.slice(2);
  const opts: DesignOptions = { set: false };
  const words: string[] = [];
  const valued: Record<string, keyof DesignOptions> = { '--name': 'name', '--gender': 'gender', '--language': 'language', '--project': 'projectId', '--recreate': 'recreate' };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const key = valued[arg];
    if (key) {
      (opts as unknown as Record<string, string>)[key] = flagValue(rest, i, arg);
      i++;
    } else if (arg === '--set') {
      opts.set = true;
    } else if (arg.startsWith('--')) {
      console.error(`Error: unknown flag: ${arg}`);
      process.exit(1);
    } else {
      words.push(arg);
    }
  }
  const description = words.join(' ').trim() || undefined;
  if (!opts.recreate && (!description || !opts.name)) {
    console.error('Error: voice design needs a description and a name, e.g. voice design "a calm Scottish narrator in her fifties" --name Isla');
    process.exit(1);
  }
  if (opts.recreate && description) {
    console.error('Error: --recreate uses the saved recipe; leave out the description (use --name to rename it).');
    process.exit(1);
  }
  if (opts.projectId && !opts.set) {
    console.error('Error: --project only applies with --set.');
    process.exit(1);
  }
  const port = await detectPort();
  await voiceDesignCmd(description, opts, port);
} else if (command === 'voice' && args[1] === 'clone') {
  const rest = args.slice(2);
  const opts: CloneOptions = { set: false };
  const valued: Record<string, keyof CloneOptions> = { '--sample': 'sample', '--consent': 'consent', '--name': 'name', '--locale': 'locale', '--project': 'projectId', '--recreate': 'recreate' };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const key = valued[arg];
    if (key) {
      (opts as unknown as Record<string, string>)[key] = flagValue(rest, i, arg);
      i++;
    } else if (arg === '--set') {
      opts.set = true;
    } else {
      console.error(`Error: unknown ${arg.startsWith('--') ? 'flag' : 'argument'}: ${arg}`);
      process.exit(1);
    }
  }
  if (!opts.sample || !opts.consent) {
    console.error('Error: voice clone needs two recordings of the same person: --sample <10–30 s of natural speech> and --consent <the statement from voice consent-text>.');
    process.exit(1);
  }
  if (!opts.name && !opts.recreate) {
    console.error('Error: give the voice a name with --name.');
    process.exit(1);
  }
  if (opts.projectId && !opts.set) {
    console.error('Error: --project only applies with --set.');
    process.exit(1);
  }
  // Read (and convert) the recordings before touching the service: a bad path never costs a probe.
  const sample = recordingAsWav(opts.sample, 'voice sample');
  const consent = recordingAsWav(opts.consent, 'consent recording');
  const port = await detectPort();
  await voiceCloneCmd(opts, sample, consent, port);
} else if (command === 'voice' && args[1] === 'consent-text') {
  const rest = args.slice(2);
  const i = rest.indexOf('--locale');
  if (rest.length && (i !== 0 || rest.length !== 2)) {
    console.error('Error: voice consent-text takes only --locale <code>, e.g. voice consent-text --locale en-AU');
    process.exit(1);
  }
  if (i === 0) {
    const c = consentFor(flagValue(rest, 0, '--locale'));
    if (!c) {
      console.error(`Error: '${rest[1]}' isn't a consent language Google supports. Run voice consent-text to list them.`);
      process.exit(1);
    }
    console.log(`Read this aloud, exactly as written (${c.language}, ${c.locale}):\n\n  ${c.statement}\n`);
  } else {
    console.log('Consent statements Google accepts (pass the locale to voice clone with --locale):\n');
    for (const c of CONSENT_STATEMENTS) console.log(`${c.locale.padEnd(6)} ${c.language}: ${c.statement}`);
  }
} else if (command === 'voice' && args[1] === 'delete') {
  const id = args[2];
  if (!id || args.length > 3) {
    console.error('Error: voice delete takes one designed voice id, e.g. voice delete voice_ab12');
    process.exit(1);
  }
  const port = await detectPort();
  await voiceDeleteCmd(id, port);
} else if (command === 'voice') {
  const action = args[1];
  if (action !== 'set' && action !== 'show' && action !== 'clear') {
    console.error("Error: voice requires an action: set <id|name> | show | clear | design | clone | consent-text | delete");
    printUsage();
    process.exit(1);
  }
  const rest = args.slice(2);
  let projectId: string | undefined;
  let provider: string | undefined;
  let forceId = false;
  let value: string | undefined;
  let i = 0;
  while (i < rest.length) {
    const arg = rest[i];
    if (arg === '--project') {
      projectId = flagValue(rest, i, '--project');
      i += 2;
      continue;
    }
    if (arg === '--provider') {
      provider = flagValue(rest, i, '--provider', ' (elevenlabs or gemini)');
      i += 2;
      continue;
    }
    if (arg === '--voice-id') { forceId = true; i++; continue; }
    if (arg.startsWith('--')) { console.error(`Error: unknown flag: ${arg}`); process.exit(1); }
    if (value === undefined && action === 'set') { value = arg; i++; continue; }
    console.error(`Error: unexpected argument: ${arg}`);
    process.exit(1);
  }
  const port = await detectPort();
  await projectVoiceCmd(action, value, { projectId, forceId, provider }, port);
} else if (command === 'tts') {
  const action = args[1];
  if (action === 'show') {
    const port = await detectPort();
    await ttsShowCmd(port);
  } else if (action === 'provider') {
    const target = args[2];
    if (target !== 'elevenlabs' && target !== 'gemini') {
      console.error('Error: tts provider requires elevenlabs or gemini');
      process.exit(1);
    }
    const port = await detectPort();
    await ttsSwitchCmd(target, port);
  } else {
    console.error("Error: tts requires an action: show | provider <elevenlabs|gemini>");
    printUsage();
    process.exit(1);
  }
} else if (command === 'speak') {
  const text = args.slice(1).join(' ').trim();
  if (!text) {
    console.error('Error: speak requires text, e.g. speak "tests pass, one thing left"');
    process.exit(1);
  }
  await speak(text);
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
