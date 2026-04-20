import { NextResponse } from 'next/server';
import OpenAI, { toFile } from 'openai';
import { promises as fs } from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { getSlycodeRoot } from '@/lib/paths';
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  type LanguageCode,
} from '@aws-sdk/client-transcribe';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';


let openaiClient: OpenAI | null = null;
let transcribeClient: TranscribeClient | null = null;
let s3Client: S3Client | null = null;
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

function getTranscribeClient(region?: string): TranscribeClient {
  if (!transcribeClient) {
    transcribeClient = new TranscribeClient(region ? { region } : {});
  }
  return transcribeClient;
}

function getS3Client(region?: string): S3Client {
  if (!s3Client) {
    s3Client = new S3Client(region ? { region } : {});
  }
  return s3Client;
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function transcribeAwsBatch(
  audioBuffer: Buffer,
  ext: string,
  region: string,
  language: string,
  s3Bucket: string,
): Promise<string> {
  const transcribe = getTranscribeClient(region || undefined);
  const s3 = getS3Client(region || undefined);

  // Batch API accepts webm, ogg, mp4 directly — no conversion needed
  const mediaFormat = ext === 'webm' ? 'webm' : (ext === 'oga' || ext === 'ogg') ? 'ogg' : ext === 'mp4' ? 'mp4' : 'wav';
  const jobName = `stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s3Key = `stt-temp/${jobName}.${ext}`;

  // Upload audio to S3
  await s3.send(new PutObjectCommand({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: audioBuffer,
  }));

  try {
    // Start transcription job
    await transcribe.send(new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: language as LanguageCode,
      MediaFormat: mediaFormat,
      Media: { MediaFileUri: `s3://${s3Bucket}/${s3Key}` },
    }));

    // Poll for completion
    let status = 'IN_PROGRESS';
    let resultUri = '';
    while (status === 'IN_PROGRESS' || status === 'QUEUED') {
      await sleep(1500);
      const result = await transcribe.send(new GetTranscriptionJobCommand({
        TranscriptionJobName: jobName,
      }));
      status = result.TranscriptionJob?.TranscriptionJobStatus || 'FAILED';
      if (status === 'COMPLETED') {
        resultUri = result.TranscriptionJob?.Transcript?.TranscriptFileUri || '';
      }
      if (status === 'FAILED') {
        const reason = result.TranscriptionJob?.FailureReason || 'Unknown error';
        throw new Error(`AWS Transcribe job failed: ${reason}`);
      }
    }

    if (!resultUri) {
      throw new Error('AWS Transcribe completed but no transcript URI returned');
    }

    // Fetch transcript JSON from the presigned URI
    const response = await fetch(resultUri);
    if (!response.ok) {
      throw new Error(`Failed to fetch transcript: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as {
      results?: { transcripts?: Array<{ transcript?: string }> };
    };
    return (data.results?.transcripts?.[0]?.transcript || '').trim();
  } finally {
    // Clean up S3 object
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: s3Key }));
    } catch { /* ignore cleanup errors */ }
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
      const s3Bucket = process.env.AWS_TRANSCRIBE_S3_BUCKET || env.AWS_TRANSCRIBE_S3_BUCKET || '';

      if (!s3Bucket) {
        return NextResponse.json({ error: 'AWS Transcribe not configured: set AWS_TRANSCRIBE_S3_BUCKET' }, { status: 401 });
      }

      const text = await transcribeAwsBatch(buffer, ext, region, language, s3Bucket);
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
