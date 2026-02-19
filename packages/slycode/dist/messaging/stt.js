import OpenAI from 'openai';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { TranscribeStreamingClient, StartStreamTranscriptionCommand, } from '@aws-sdk/client-transcribe-streaming';
let openaiClient = null;
let transcribeClient = null;
function getClient(apiKey) {
    if (!openaiClient) {
        openaiClient = new OpenAI({ apiKey });
    }
    return openaiClient;
}
function getTranscribeClient(region) {
    if (!transcribeClient) {
        transcribeClient = new TranscribeStreamingClient(region ? { region } : {});
    }
    return transcribeClient;
}
async function transcribeOpenAI(filePath, apiKey) {
    const client = getClient(apiKey);
    const transcription = await client.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: 'whisper-1',
    });
    return transcription.text;
}
function transcribeLocal(filePath, cliPath, modelPath) {
    // Convert .oga (Opus) to 16kHz mono WAV for whisper.cpp
    const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
    try {
        execFileSync('ffmpeg', ['-i', filePath, '-ar', '16000', '-ac', '1', '-y', wavPath], {
            stdio: 'pipe',
        });
    }
    catch (err) {
        throw new Error(`ffmpeg conversion failed. Is ffmpeg installed? ${err.message}`);
    }
    // Run whisper.cpp CLI
    try {
        const output = execFileSync(cliPath, ['-m', modelPath, '-f', wavPath, '--no-timestamps', '--output-txt'], {
            stdio: 'pipe',
            encoding: 'utf-8',
            timeout: 120_000, // 2 minute timeout for long clips
        });
        // whisper-cli prints transcription to stdout
        return output.trim();
    }
    catch (err) {
        throw new Error(`whisper-cli failed. Check WHISPER_CLI_PATH and WHISPER_MODEL_PATH. ${err.message}`);
    }
    finally {
        // Clean up intermediate WAV
        try {
            fs.unlinkSync(wavPath);
        }
        catch { /* ignore */ }
    }
}
async function transcribeAwsStreaming(filePath, region, language) {
    const client = getTranscribeClient(region || undefined);
    const audioData = fs.readFileSync(filePath);
    // Determine format from file extension
    const ext = filePath.split('.').pop()?.toLowerCase();
    const isOgg = ext === 'oga' || ext === 'ogg';
    const mediaEncoding = isOgg ? 'ogg-opus' : 'pcm';
    const sampleRate = isOgg ? 48000 : 16000;
    // For non-OGG formats, convert to PCM via ffmpeg
    let audioBuffer;
    let pcmPath = null;
    if (isOgg) {
        audioBuffer = audioData;
    }
    else {
        pcmPath = filePath.replace(/\.[^.]+$/, '.pcm');
        try {
            execFileSync('ffmpeg', [
                '-i', filePath, '-ar', '16000', '-ac', '1', '-f', 's16le', '-y', pcmPath,
            ], { stdio: 'pipe' });
            audioBuffer = fs.readFileSync(pcmPath);
        }
        catch (err) {
            throw new Error(`ffmpeg conversion to PCM failed. Is ffmpeg installed? ${err.message}`);
        }
    }
    // Stream audio in chunks
    const chunkSize = 4096;
    async function* audioStream() {
        for (let offset = 0; offset < audioBuffer.length; offset += chunkSize) {
            yield { AudioEvent: { AudioChunk: audioBuffer.subarray(offset, offset + chunkSize) } };
        }
    }
    try {
        const response = await client.send(new StartStreamTranscriptionCommand({
            LanguageCode: language,
            MediaEncoding: mediaEncoding,
            MediaSampleRateHertz: sampleRate,
            AudioStream: audioStream(),
        }));
        // Collect final transcript from the stream
        const parts = [];
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
    }
    finally {
        if (pcmPath) {
            try {
                fs.unlinkSync(pcmPath);
            }
            catch { /* ignore */ }
        }
    }
}
export function validateSttConfig(config) {
    if (config.backend === 'openai') {
        if (!config.openaiApiKey)
            return 'STT backend is "openai" but OPENAI_API_KEY is not set.';
    }
    else if (config.backend === 'local') {
        if (!config.whisperCliPath)
            return 'STT backend is "local" but WHISPER_CLI_PATH is not set.';
        if (!config.whisperModelPath)
            return 'STT backend is "local" but WHISPER_MODEL_PATH is not set.';
        if (!fs.existsSync(config.whisperCliPath))
            return `whisper-cli not found at: ${config.whisperCliPath}`;
        if (!fs.existsSync(config.whisperModelPath))
            return `Whisper model not found at: ${config.whisperModelPath}`;
    }
    // aws-transcribe: no local config to validate — IAM role checked at runtime
    return null;
}
export async function transcribeAudio(filePath, config) {
    try {
        if (config.backend === 'local') {
            return transcribeLocal(filePath, config.whisperCliPath, config.whisperModelPath);
        }
        else if (config.backend === 'aws-transcribe') {
            return await transcribeAwsStreaming(filePath, config.awsTranscribeRegion, config.awsTranscribeLanguage || 'en-AU');
        }
        else {
            return await transcribeOpenAI(filePath, config.openaiApiKey);
        }
    }
    finally {
        // Clean up original temp file
        try {
            fs.unlinkSync(filePath);
        }
        catch { /* ignore */ }
    }
}
//# sourceMappingURL=stt.js.map