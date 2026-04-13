import OpenAI from 'openai';
import fs from 'fs';
import { execFileSync } from 'child_process';
import type { LanguageCode } from '@aws-sdk/client-transcribe';

let openaiClient: OpenAI | null = null;

// AWS SDK clients — lazy-initialized on first use via dynamic import
let transcribeClient: any = null;
let s3Client: any = null;
let awsSdkLoaded = false;
let TranscribeClientClass: any = null;
let StartTranscriptionJobCommandClass: any = null;
let GetTranscriptionJobCommandClass: any = null;
let S3ClientClass: any = null;
let PutObjectCommandClass: any = null;
let DeleteObjectCommandClass: any = null;

function getClient(apiKey: string): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

async function loadAwsSdk(): Promise<void> {
  if (awsSdkLoaded) return;
  try {
    const transcribeMod = await import('@aws-sdk/client-transcribe');
    const s3Mod = await import('@aws-sdk/client-s3');
    TranscribeClientClass = transcribeMod.TranscribeClient;
    StartTranscriptionJobCommandClass = transcribeMod.StartTranscriptionJobCommand;
    GetTranscriptionJobCommandClass = transcribeMod.GetTranscriptionJobCommand;
    S3ClientClass = s3Mod.S3Client;
    PutObjectCommandClass = s3Mod.PutObjectCommand;
    DeleteObjectCommandClass = s3Mod.DeleteObjectCommand;
    awsSdkLoaded = true;
  } catch {
    throw new Error(
      'AWS Transcribe requires additional packages. Install them with:\n' +
      '  npm install @aws-sdk/client-transcribe @aws-sdk/client-s3'
    );
  }
}

function getTranscribeClient(region?: string) {
  if (!transcribeClient) {
    transcribeClient = new TranscribeClientClass(region ? { region } : {});
  }
  return transcribeClient;
}

function getS3Client(region?: string) {
  if (!s3Client) {
    s3Client = new S3ClientClass(region ? { region } : {});
  }
  return s3Client;
}

async function transcribeOpenAI(filePath: string, apiKey: string): Promise<string> {
  const client = getClient(apiKey);

  const transcription = await client.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
  });

  return transcription.text;
}

function transcribeLocal(filePath: string, cliPath: string, modelPath: string): string {
  // Convert .oga (Opus) to 16kHz mono WAV for whisper.cpp
  const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
  try {
    execFileSync('ffmpeg', ['-i', filePath, '-ar', '16000', '-ac', '1', '-y', wavPath], {
      stdio: 'pipe',
      windowsHide: true,
    });
  } catch (err) {
    throw new Error(`ffmpeg conversion failed. Is ffmpeg installed? ${(err as Error).message}`);
  }

  // Run whisper.cpp CLI
  try {
    const output = execFileSync(cliPath, ['-m', modelPath, '-f', wavPath, '--no-timestamps', '--output-txt'], {
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 120_000, // 2 minute timeout for long clips
      windowsHide: true,
    });

    // whisper-cli prints transcription to stdout
    return output.trim();
  } catch (err) {
    throw new Error(`whisper-cli failed. Check WHISPER_CLI_PATH and WHISPER_MODEL_PATH. ${(err as Error).message}`);
  } finally {
    // Clean up intermediate WAV
    try { fs.unlinkSync(wavPath); } catch { /* ignore */ }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function transcribeAwsBatch(
  filePath: string,
  region: string,
  language: string,
  s3Bucket: string,
): Promise<string> {
  await loadAwsSdk();

  const transcribe = getTranscribeClient(region || undefined);
  const s3 = getS3Client(region || undefined);

  const ext = filePath.split('.').pop()?.toLowerCase() || 'ogg';
  const mediaFormat = (ext === 'oga' || ext === 'ogg') ? 'ogg' : ext === 'mp4' ? 'mp4' : 'webm';
  const jobName = `stt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const s3Key = `stt-temp/${jobName}.${ext}`;

  // Upload audio to S3
  const audioData = fs.readFileSync(filePath);
  await s3.send(new PutObjectCommandClass({
    Bucket: s3Bucket,
    Key: s3Key,
    Body: audioData,
  }));

  try {
    // Start transcription job
    await transcribe.send(new StartTranscriptionJobCommandClass({
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
      const result = await transcribe.send(new GetTranscriptionJobCommandClass({
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
    const transcript = data.results?.transcripts?.[0]?.transcript || '';
    return transcript.trim();
  } finally {
    // Clean up S3 object
    try {
      await s3.send(new DeleteObjectCommandClass({ Bucket: s3Bucket, Key: s3Key }));
    } catch { /* ignore cleanup errors */ }
  }
}

export interface SttConfig {
  backend: 'openai' | 'local' | 'aws-transcribe';
  openaiApiKey: string;
  whisperCliPath: string;
  whisperModelPath: string;
  awsTranscribeRegion: string;
  awsTranscribeLanguage: string;
  awsTranscribeS3Bucket: string;
}

export async function validateSttConfig(config: SttConfig): Promise<string | null> {
  if (config.backend === 'openai') {
    if (!config.openaiApiKey) return 'STT backend is "openai" but OPENAI_API_KEY is not set.';
  } else if (config.backend === 'local') {
    if (!config.whisperCliPath) return 'STT backend is "local" but WHISPER_CLI_PATH is not set.';
    if (!config.whisperModelPath) return 'STT backend is "local" but WHISPER_MODEL_PATH is not set.';
    if (!fs.existsSync(config.whisperCliPath)) return `whisper-cli not found at: ${config.whisperCliPath}`;
    if (!fs.existsSync(config.whisperModelPath)) return `Whisper model not found at: ${config.whisperModelPath}`;
  } else if (config.backend === 'aws-transcribe') {
    if (!config.awsTranscribeS3Bucket) return 'STT backend is "aws-transcribe" but AWS_TRANSCRIBE_S3_BUCKET is not set.';
    try {
      await import('@aws-sdk/client-transcribe');
    } catch {
      return 'STT backend is "aws-transcribe" but AWS SDK is not installed. Run: npm install @aws-sdk/client-transcribe @aws-sdk/client-s3';
    }
  }
  return null;
}

export async function transcribeAudio(filePath: string, config: SttConfig): Promise<string> {
  try {
    if (config.backend === 'local') {
      return transcribeLocal(filePath, config.whisperCliPath, config.whisperModelPath);
    } else if (config.backend === 'aws-transcribe') {
      return await transcribeAwsBatch(
        filePath,
        config.awsTranscribeRegion,
        config.awsTranscribeLanguage || 'en-AU',
        config.awsTranscribeS3Bucket,
      );
    } else {
      return await transcribeOpenAI(filePath, config.openaiApiKey);
    }
  } finally {
    // Clean up original temp file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
}
