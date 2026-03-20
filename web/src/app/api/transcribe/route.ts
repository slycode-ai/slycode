import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { getSlycodeRoot } from '@/lib/paths';
import {
  TranscribeStreamingClient,
  StartStreamTranscriptionCommand,
  type AudioStream,
  type LanguageCode,
  type MediaEncoding,
} from '@aws-sdk/client-transcribe-streaming';
import { remuxWebmToOgg } from '@/lib/webm-to-ogg-opus';

let openaiClient: OpenAI | null = null;
let transcribeClient: TranscribeStreamingClient | null = null;
let envLoaded = false;
let envCache: Record<string, string> = {};

async function loadEnv(): Promise<Record<string, string>> {
  if (envLoaded) return envCache;
  envLoaded = true;
  try {
    const envPath = path.join(getSlycodeRoot(), '.env');
    const content = await fs.readFile(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.+)$/);
      if (match) {
        envCache[match[1]] = match[2].trim();
        // Don't leak port-specific vars into process.env — other modules
        // (scheduler, bridge proxy) need their own port resolution logic.
        const skipKeys = new Set(['BRIDGE_URL', 'BRIDGE_PORT', 'WEB_PORT', 'MESSAGING_SERVICE_PORT']);
        if (!skipKeys.has(match[1]) && !process.env[match[1]]) {
          process.env[match[1]] = envCache[match[1]];
        }
      }
    }
  } catch { /* no .env file */ }
  return envCache;
}

async function getClient(): Promise<OpenAI> {
  if (!openaiClient) {
    const env = await loadEnv();
    const apiKey = process.env.OPENAI_API_KEY || env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function getTranscribeClient(region?: string): TranscribeStreamingClient {
  if (!transcribeClient) {
    transcribeClient = new TranscribeStreamingClient(region ? { region } : {});
  }
  return transcribeClient;
}

function execAsync(cmd: string, args: string[], options: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { ...options, windowsHide: true }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`));
      else resolve(typeof stdout === 'string' ? stdout : String(stdout));
    });
  });
}

async function transcribeLocal(audioBuffer: Buffer, ext: string, cliPath: string, modelPath: string): Promise<string> {
  const tmpDir = process.env.TMPDIR || '/tmp';
  const tmpFile = path.join(tmpDir, `whisper_${Date.now()}.${ext}`);
  const wavFile = tmpFile.replace(/\.[^.]+$/, '.wav');

  try {
    await fs.writeFile(tmpFile, audioBuffer);

    // Convert to 16kHz mono WAV for whisper.cpp
    await execAsync('ffmpeg', ['-i', tmpFile, '-ar', '16000', '-ac', '1', '-y', wavFile], {
      timeout: 30_000,
    });

    // Run whisper-cli (async — won't block the event loop)
    const output = await execAsync(cliPath, ['-m', modelPath, '-f', wavFile, '--no-timestamps', '--output-txt'], {
      timeout: 120_000,
      encoding: 'utf-8',
    });

    return output.trim();
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
    await fs.unlink(wavFile).catch(() => {});
  }
}

async function transcribeAwsStreaming(audioBuffer: Buffer, ext: string, region: string, language: string): Promise<string> {
  const client = getTranscribeClient(region || undefined);

  const isOgg = ext === 'ogg' || ext === 'oga';

  let streamBuffer: Buffer;
  let mediaEncoding: MediaEncoding;
  let sampleRate: number;
  let pcmPath: string | null = null;

  if (isOgg) {
    // OGG/Opus can be sent directly
    streamBuffer = audioBuffer;
    mediaEncoding = 'ogg-opus';
    sampleRate = 48000;
  } else if (ext === 'webm') {
    // Remux WebM/Opus → OGG/Opus (pure JS, no ffmpeg)
    streamBuffer = remuxWebmToOgg(audioBuffer);
    mediaEncoding = 'ogg-opus';
    sampleRate = 48000;
  } else {
    // MP4/other: convert to PCM via ffmpeg (Safari fallback)
    const tmpDir = process.env.TMPDIR || '/tmp';
    const tmpFile = path.join(tmpDir, `transcribe_${Date.now()}.${ext}`);
    pcmPath = tmpFile.replace(/\.[^.]+$/, '.pcm');

    try {
      await fs.writeFile(tmpFile, audioBuffer);
      await execAsync('ffmpeg', [
        '-i', tmpFile, '-ar', '16000', '-ac', '1', '-f', 's16le', '-y', pcmPath,
      ], { timeout: 30_000 });
      streamBuffer = await fs.readFile(pcmPath);
      await fs.unlink(tmpFile).catch(() => {});
    } catch (err) {
      await fs.unlink(tmpFile).catch(() => {});
      throw new Error(`ffmpeg conversion to PCM failed: ${(err as Error).message}`);
    }
    mediaEncoding = 'pcm';
    sampleRate = 16000;
  }

  const chunkSize = 4096;
  async function* audioStream(): AsyncGenerator<AudioStream> {
    for (let offset = 0; offset < streamBuffer.length; offset += chunkSize) {
      yield { AudioEvent: { AudioChunk: streamBuffer.subarray(offset, offset + chunkSize) } };
    }
  }

  try {
    const response = await client.send(new StartStreamTranscriptionCommand({
      LanguageCode: language as LanguageCode,
      MediaEncoding: mediaEncoding,
      MediaSampleRateHertz: sampleRate,
      AudioStream: audioStream(),
    }));

    const parts: string[] = [];
    if (response.TranscriptResultStream) {
      for await (const event of response.TranscriptResultStream) {
        if (event.TranscriptEvent?.Transcript?.Results) {
          for (const result of event.TranscriptEvent.Transcript.Results) {
            if (!result.IsPartial && result.Alternatives?.[0]?.Transcript) {
              parts.push(result.Alternatives[0].Transcript);
            }
          }
        }
      }
    }

    return parts.join(' ').trim();
  } finally {
    if (pcmPath) {
      await fs.unlink(pcmPath).catch(() => {});
    }
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get('audio');

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: 'Missing "audio" file in form data' }, { status: 400 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());
    const ext = audioFile.type.includes('mp4') ? 'mp4' : audioFile.type.includes('ogg') ? 'ogg' : 'webm';
    const env = await loadEnv();
    const backend = process.env.STT_BACKEND || env.STT_BACKEND || 'openai';

    if (backend === 'local') {
      const cliPath = process.env.WHISPER_CLI_PATH || env.WHISPER_CLI_PATH;
      const modelPath = process.env.WHISPER_MODEL_PATH || env.WHISPER_MODEL_PATH;

      if (!cliPath || !modelPath) {
        return NextResponse.json({ error: 'Local STT not configured: set WHISPER_CLI_PATH and WHISPER_MODEL_PATH' }, { status: 401 });
      }

      const text = await transcribeLocal(buffer, ext, cliPath, modelPath);
      return NextResponse.json({ text });
    }

    if (backend === 'aws-transcribe') {
      const region = process.env.AWS_TRANSCRIBE_REGION || env.AWS_TRANSCRIBE_REGION || '';
      const language = process.env.AWS_TRANSCRIBE_LANGUAGE || env.AWS_TRANSCRIBE_LANGUAGE || 'en-AU';

      const text = await transcribeAwsStreaming(buffer, ext, region, language);
      return NextResponse.json({ text });
    }

    // OpenAI API path (default)
    let client: OpenAI;
    try {
      client = await getClient();
    } catch {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 401 });
    }

    const file = await toFile(buffer, `recording.${ext}`, { type: audioFile.type });
    const transcription = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
    });

    return NextResponse.json({ text: transcription.text });
  } catch (err) {
    const message = (err as Error).message || 'Transcription failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
