export async function textToSpeech(text, config, voiceIdOverride) {
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
export async function convertToOgg(mp3Buffer) {
    // Use ffmpeg to convert MP3 to OGG/Opus (Telegram's preferred format)
    const { spawn } = await import('child_process');
    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', 'pipe:0', // Read from stdin
            '-c:a', 'libopus', // Opus codec
            '-b:a', '64k', // Bitrate
            '-f', 'ogg', // OGG container
            'pipe:1', // Write to stdout
        ], { stdio: ['pipe', 'pipe', 'pipe'] });
        const chunks = [];
        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
        ffmpeg.stderr.on('data', () => { }); // Suppress ffmpeg stderr
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve(Buffer.concat(chunks));
            }
            else {
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
//# sourceMappingURL=tts.js.map