import type { VoiceConfig } from './types.js';

export async function textToSpeech(text: string, config: VoiceConfig, voiceIdOverride?: string): Promise<Buffer> {
  const voiceId = voiceIdOverride || config.elevenlabsVoiceId;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': config.elevenlabsApiKey,
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_v3',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        speed: config.elevenlabsSpeed,
      },
      output_format: 'mp3_44100_128',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
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
  opts: { format: 'ogg' | 'mp3'; voiceIdOverride?: string; sourceMp3?: Buffer },
): Promise<{ buffer: Buffer; format: 'ogg' | 'mp3'; sourceMp3: Buffer }> {
  const sourceMp3 = opts.sourceMp3 ?? await textToSpeech(text, config, opts.voiceIdOverride);
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
