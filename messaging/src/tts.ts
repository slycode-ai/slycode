import type { VoiceConfig } from './types.js';

export const TTS_MODEL_ID = 'eleven_v3';

/** Per-request ElevenLabs timeout (feature 086). */
export const TTS_RENDER_TIMEOUT_MS = parseInt(process.env.TTS_RENDER_TIMEOUT_MS || '20000', 10);
/** Max concurrent ElevenLabs requests; extra callers queue (never rejected). */
export const TTS_RENDER_CONCURRENCY = 2;

/** Thrown when a render (queue wait + ElevenLabs call) exceeds its deadline. */
export class RenderTimeoutError extends Error {
  constructor(ms: number) {
    super(`ElevenLabs render timed out after ${ms}ms`);
    this.name = 'RenderTimeoutError';
  }
}

/** Thrown when the caller abandoned the request (client disconnected) before or during the render. */
export class RenderCancelledError extends Error {
  constructor() {
    super('render cancelled by caller');
    this.name = 'RenderCancelledError';
  }
}

// Tiny FIFO semaphore so a burst of speak/generate calls cannot fan out an
// unbounded number of paid requests at once. Queue residence is BOUNDED by the
// caller's deadline and cancellable by its AbortSignal: work whose deadline or
// request has expired is removed from the queue and never dispatched (review
// finding 8 — the per-request timeout used to start only after an unbounded
// wait).
interface TtsWaiter { grant: () => void; cancel: (err: Error) => void }
let ttsActive = 0;
const ttsWaiters: TtsWaiter[] = [];

function releaseTtsSlot(): void {
  ttsActive--;
  const next = ttsWaiters.shift();
  if (next) next.grant();
}

async function acquireTtsSlot(opts: { deadline: number; signal?: AbortSignal; timeoutMs: number }): Promise<() => void> {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    releaseTtsSlot();
  };
  if (opts.signal?.aborted) throw new RenderCancelledError();
  if (ttsActive < TTS_RENDER_CONCURRENCY) {
    ttsActive++;
    return release;
  }
  await new Promise<void>((resolve, reject) => {
    const waiter: TtsWaiter = {
      grant: () => { cleanup(); ttsActive++; resolve(); },
      cancel: (err) => { cleanup(); reject(err); },
    };
    const remaining = Math.max(0, opts.deadline - Date.now());
    const timer = setTimeout(() => dropWaiter(new RenderTimeoutError(opts.timeoutMs)), remaining);
    const onAbort = () => dropWaiter(new RenderCancelledError());
    function cleanup() {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
    function dropWaiter(err: Error) {
      const i = ttsWaiters.indexOf(waiter);
      if (i >= 0) ttsWaiters.splice(i, 1);
      waiter.cancel(err);
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    ttsWaiters.push(waiter);
  });
  return release;
}

/** Test-only visibility into the semaphore. */
export function ttsSemaphoreState(): { active: number; waiting: number } {
  return { active: ttsActive, waiting: ttsWaiters.length };
}

export async function textToSpeech(
  text: string,
  config: VoiceConfig,
  voiceIdOverride?: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<Buffer> {
  const voiceId = voiceIdOverride || config.elevenlabsVoiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const timeoutMs = opts.timeoutMs ?? TTS_RENDER_TIMEOUT_MS;
  const doFetch = opts.fetchImpl ?? fetch;

  // One deadline covers queue residence AND the ElevenLabs call.
  const deadline = Date.now() + timeoutMs;
  const release = await acquireTtsSlot({ deadline, signal: opts.signal, timeoutMs });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  const abortError = () => (opts.signal?.aborted ? new RenderCancelledError() : new RenderTimeoutError(timeoutMs));
  try {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': config.elevenlabsApiKey,
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: TTS_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            speed: config.elevenlabsSpeed,
          },
          output_format: 'mp3_44100_128',
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw abortError();
      throw err;
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
    }

    let arrayBuffer: ArrayBuffer;
    try {
      arrayBuffer = await response.arrayBuffer();
    } catch (err) {
      if (controller.signal.aborted) throw abortError();
      throw err;
    }
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
    release();
  }
}

/**
 * Render TTS audio in the requested format.
 *
 * Always calls ElevenLabs once (returns MP3) unless `sourceMp3` is supplied,
 * in which case it reuses that buffer (used by /voice's OGG-fail fallback to
 * avoid re-hitting the API).
 *
 * - format='mp3': zero transcode, returns the ElevenLabs buffer directly.
 * - format='ogg': runs convertToOgg(); throws on failure (caller decides
 *   fallback policy — /voice falls back to MP3, /tts/generate returns 502).
 *
 * Returns the source MP3 alongside the final buffer so callers can implement
 * format fallbacks without a second API call.
 */
export async function renderTtsAudio(
  text: string,
  config: VoiceConfig,
  opts: { format: 'ogg' | 'mp3'; voiceIdOverride?: string; sourceMp3?: Buffer; signal?: AbortSignal },
): Promise<{ buffer: Buffer; format: 'ogg' | 'mp3'; sourceMp3: Buffer }> {
  const sourceMp3 = opts.sourceMp3 ?? await textToSpeech(text, config, opts.voiceIdOverride, { signal: opts.signal });
  if (opts.format === 'mp3') {
    return { buffer: sourceMp3, format: 'mp3', sourceMp3 };
  }
  const ogg = await convertToOgg(sourceMp3);
  return { buffer: ogg, format: 'ogg', sourceMp3 };
}

export async function convertToOgg(mp3Buffer: Buffer): Promise<Buffer> {
  // Use ffmpeg to convert MP3 to OGG/Opus (Telegram's preferred format)
  const { spawn } = await import('child_process');

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',       // Read from stdin
      '-c:a', 'libopus',    // Opus codec
      '-b:a', '64k',        // Bitrate
      '-f', 'ogg',          // OGG container
      'pipe:1',             // Write to stdout
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', () => {}); // Suppress ffmpeg stderr

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`ffmpeg not found. Install ffmpeg for voice support: ${err.message}`));
    });

    ffmpeg.stdin.write(mp3Buffer);
    ffmpeg.stdin.end();
  });
}
