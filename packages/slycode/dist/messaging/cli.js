#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
const DEV_PORT = 3005;
const PROD_PORT = parseInt(process.env.MESSAGING_SERVICE_PORT || process.env.TELEGRAM_SERVICE_PORT || '7593', 10);
const CACHE_FILE = path.join(os.homedir(), '.slycode', 'messaging-port');
function readCachedPort() {
    try {
        const cached = fs.readFileSync(CACHE_FILE, 'utf-8').trim();
        const port = parseInt(cached, 10);
        return isNaN(port) ? null : port;
    }
    catch {
        return null;
    }
}
function writeCachedPort(port) {
    try {
        fs.writeFileSync(CACHE_FILE, String(port));
    }
    catch {
        // ~/.slycode may not exist yet — non-critical
    }
}
async function isHealthy(port) {
    try {
        const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
        return res.ok;
    }
    catch {
        return false;
    }
}
async function detectPort() {
    const cached = readCachedPort();
    // Try cached port first
    if (cached && await isHealthy(cached))
        return cached;
    // Probe dev then prod
    const candidates = cached === PROD_PORT ? [DEV_PORT, PROD_PORT] : [DEV_PORT, PROD_PORT];
    for (const port of candidates) {
        if (port === cached)
            continue; // already tried
        if (await isHealthy(port)) {
            writeCachedPort(port);
            return port;
        }
    }
    // Nothing found — return dev default, let send() surface the error
    return DEV_PORT;
}
async function send(message, tts, port) {
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
        const data = await res.json();
        if (!res.ok) {
            console.error(`Error: ${data.error || 'Unknown error'}`);
            process.exit(1);
        }
        writeCachedPort(port);
        console.log(tts ? 'Voice message sent.' : 'Message sent.');
    }
    catch (err) {
        if (err.message.includes('ECONNREFUSED') || err.message === 'fetch failed') {
            console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh. If you don\'t need messaging, tell the user they can remove the messaging skill from this project.');
        }
        else {
            console.error(`Error: ${err.message}`);
        }
        process.exit(1);
    }
}
async function generate(text, opts, port) {
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
            }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
            process.exit(1);
        }
        writeCachedPort(port);
        console.log(data.absolutePath);
    }
    catch (err) {
        if (err.message.includes('ECONNREFUSED') || err.message === 'fetch failed') {
            console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
        }
        else {
            console.error(`Error: ${err.message}`);
        }
        process.exit(1);
    }
}
async function sendFile(filePath, caption, asOverride, port) {
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
            }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
            console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
            process.exit(1);
        }
        writeCachedPort(port);
        console.log(`Sent ${data.kind} (channel=${data.channel}, message_id=${data.messageId}, bytes=${data.bytes})`);
    }
    catch (err) {
        if (err.message.includes('ECONNREFUSED') || err.message === 'fetch failed') {
            console.error('Error: Messaging service is not running. Start it with sly-start.sh or sly-dev.sh.');
        }
        else {
            console.error(`Error: ${err.message}`);
        }
        process.exit(1);
    }
}
function printUsage() {
    console.log(`Usage: messaging-cli <command> [args]

Commands:
  send <message>                       Send a text message to the active channel
  send <message> --tts                 Send a voice message (text-to-speech)
  send-file <path> [--caption "..."]   Send an existing audio/video file
                  [--as document]      Force document delivery (escape hatch
                                       for unsupported MIME types)
  generate <text> [--voice-id <id>]    Render TTS audio to disk without sending.
                  [--out-dir <path>]   Default: data/generated-audio/<date>/.
                  [--filename <name>]  Default format: ogg. Prints absolute
                  [--format ogg|mp3]   path on success.

Examples:
  messaging-cli send "The build is complete"
  messaging-cli send "Here's a summary of the changes" --tts
  messaging-cli send-file ./tmp/preview.mp4 --caption "Confirm before posting?"
  messaging-cli send-file ./logs/run.txt --as document
  messaging-cli generate "intro for the new feature"
  messaging-cli generate "[whispers] secret stuff" --format mp3 --out-dir /tmp`);
}
// Parse arguments
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
}
const command = args[0];
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
}
else if (command === 'send-file') {
    // Parse: send-file <path> [--caption "..."] [--as document] [-- <path-with-leading-dash>]
    const rest = args.slice(1);
    let filePath;
    let caption;
    let asOverride;
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
}
else if (command === 'generate') {
    // Parse: generate <text> [--voice-id <id>] [--out-dir <path>] [--filename <name>] [--format ogg|mp3]
    const rest = args.slice(1);
    let text;
    let voiceId;
    let outDir;
    let filename;
    let format;
    let i = 0;
    while (i < rest.length) {
        const arg = rest[i];
        if (arg === '--voice-id') {
            voiceId = rest[i + 1];
            if (voiceId === undefined) {
                console.error('Error: --voice-id requires a value');
                process.exit(1);
            }
            i += 2;
            continue;
        }
        if (arg === '--out-dir') {
            outDir = rest[i + 1];
            if (outDir === undefined) {
                console.error('Error: --out-dir requires a value');
                process.exit(1);
            }
            i += 2;
            continue;
        }
        if (arg === '--filename') {
            filename = rest[i + 1];
            if (filename === undefined) {
                console.error('Error: --filename requires a value');
                process.exit(1);
            }
            i += 2;
            continue;
        }
        if (arg === '--format') {
            const v = rest[i + 1];
            if (v !== 'ogg' && v !== 'mp3') {
                console.error("Error: --format must be 'ogg' or 'mp3'");
                process.exit(1);
            }
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
    await generate(text, { voiceId, outDir, filename, format }, port);
}
else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
//# sourceMappingURL=cli.js.map