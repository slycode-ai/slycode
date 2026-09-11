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
                ...(opts.projectId !== undefined && { projectId: opts.projectId }),
                // Forward the caller's session so the endpoint can pick the project's
                // default voice when no --voice-id is given (same as send/--tts).
                ...(process.env.SLYCODE_SESSION && { session: process.env.SLYCODE_SESSION }),
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
                // Forward the caller's session so the endpoint can emit a 'Switch to
                // Card' button when the file comes from a non-active session (same as
                // /send and /voice).
                ...(process.env.SLYCODE_SESSION && { session: process.env.SLYCODE_SESSION }),
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
async function searchVoicesCmd(query, port) {
    const params = query ? `?q=${encodeURIComponent(query)}` : '';
    const url = `http://localhost:${port}/voices/search${params}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
            process.exit(1);
        }
        writeCachedPort(port);
        const voices = data.voices || [];
        if (voices.length === 0) {
            console.log(query ? `No voices found for "${query}".` : 'No voices found.');
            return;
        }
        for (const v of voices) {
            const desc = v.description ? ` — ${v.description}` : '';
            console.log(`${v.voice_id}  ${v.name} (${v.category})${desc}`);
        }
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
// --- Project voice (feature 086) ------------------------------------------
// `voice set|show|clear` talk to /projects/:id/voice. Project resolution:
// --project <id|name|key>, else `_session` + the caller's SLYCODE_SESSION.
const ELEVENLABS_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
function projectRouteTarget(projectArg) {
    if (projectArg)
        return { idSegment: encodeURIComponent(projectArg), query: '' };
    const session = process.env.SLYCODE_SESSION;
    if (session)
        return { idSegment: '_session', query: `?session=${encodeURIComponent(session)}` };
    console.error('Error: no project given. Pass --project <id|name>, or run from a SlyCode terminal (SLYCODE_SESSION).');
    process.exit(1);
}
function printProjectVoice(data) {
    const fmt = (v) => (v ? `${v.name} (${v.id})` : 'none');
    console.log(`Project:   ${data.projectId}`);
    console.log(`Stored:    ${fmt(data.stored)}`);
    console.log(`Effective: ${fmt(data.effective)}${data.source ? ` [${data.source}]` : ''}`);
}
async function projectVoiceCmd(action, value, opts, port) {
    const target = projectRouteTarget(opts.projectId);
    const url = `http://localhost:${port}/projects/${target.idSegment}/voice${target.query}`;
    const init = { headers: { 'Content-Type': 'application/json' } };
    if (action === 'show') {
        init.method = 'GET';
    }
    else if (action === 'clear') {
        init.method = 'DELETE';
    }
    else {
        if (!value) {
            console.error('Error: voice set requires a voice id or exact voice name');
            process.exit(1);
        }
        init.method = 'PUT';
        const asId = opts.forceId || ELEVENLABS_ID_PATTERN.test(value);
        init.body = JSON.stringify(asId ? { voiceId: value } : { voiceName: value });
    }
    try {
        const res = await fetch(url, init);
        const data = await res.json();
        if (!res.ok || !data.ok) {
            console.error(`Error: ${data.error || 'unknown'}: ${data.message || 'no message'}`);
            for (const c of data.candidates || [])
                console.error(`  ${c.voice_id}  ${c.name} (${c.category})`);
            process.exit(1);
        }
        writeCachedPort(port);
        if (action === 'clear')
            console.log('Project voice cleared (back to the inherited default).');
        printProjectVoice(data);
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
// ---------------------------------------------------------------------------
// speak — spoken reply in the web terminal (feature 086, spec Task 8)
// ---------------------------------------------------------------------------
// Talks ONLY to the bridge that spawned this terminal (SLYCODE_BRIDGE_URL),
// never to the messaging service and never to a probed/cached port: the
// bridge is the single admission authority (speaker flag, listeners, length,
// budget) and it orchestrates the paid render itself. A refusal is the
// user's setting or state, not an error — print it verbatim and exit 1.
async function speak(text) {
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
        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, requestId }),
                signal: AbortSignal.timeout(40_000),
            });
        }
        catch (err) {
            const msg = err.message || '';
            const transient = msg.includes('ECONNREFUSED') || msg === 'fetch failed' || msg.includes('ECONNRESET') || err.name === 'TimeoutError';
            if (transient && attempt < maxAttempts) {
                await new Promise(r => setTimeout(r, 500 * attempt));
                continue;
            }
            console.error(transient
                ? 'Error: bridge_unreachable: the terminal bridge did not answer; speak only works from a running SlyCode terminal'
                : `Error: ${msg}`);
            process.exit(1);
        }
        let data = {};
        try {
            data = await res.json();
        }
        catch { /* non-JSON body */ }
        if (!res.ok || !data.ok) {
            console.error(`Error: ${data.code || `http_${res.status}`}: ${data.message || 'no message'}`);
            process.exit(1);
        }
        const n = typeof data.delivered === 'number' ? data.delivered : 0;
        console.log(`Spoken (delivered to ${n} browser${n === 1 ? '' : 's'}): "${text}"`);
        return;
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
                                       Refusals (sound off, nobody listening,
                                       too long, budget) are final — never
                                       work around them with generate/--tts.
  voices [query]                       Search TTS voices by name (personal +
                                       shared library). Prints voice IDs.
  voice set <id|name> [--project <p>]  Set a project's TTS voice (used by
                  [--voice-id]         Telegram AND terminal spoken replies).
                                       A 20-char id is treated as an id; any
                                       other value must match exactly one
                                       voice name. --project defaults to the
                                       caller's session project.
  voice show [--project <p>]           Print the stored and effective voice.
  voice clear [--project <p>]          Remove the project's override (falls
                                       back to the inherited default).

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
  messaging-cli speak "tests pass, one thing left to check on the modal"`);
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
    // Parse: generate <text> [--voice-id <id>] [--out-dir <path>] [--filename <name>] [--format ogg|mp3] [--project <id>]
    const rest = args.slice(1);
    let text;
    let voiceId;
    let outDir;
    let filename;
    let format;
    let projectId;
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
        if (arg === '--project') {
            projectId = rest[i + 1];
            if (projectId === undefined) {
                console.error('Error: --project requires a value');
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
    await generate(text, { voiceId, outDir, filename, format, projectId }, port);
}
else if (command === 'voices') {
    const query = args.slice(1).join(' ') || undefined;
    const port = await detectPort();
    await searchVoicesCmd(query, port);
}
else if (command === 'voice') {
    const action = args[1];
    if (action !== 'set' && action !== 'show' && action !== 'clear') {
        console.error("Error: voice requires an action: set <id|name> | show | clear");
        printUsage();
        process.exit(1);
    }
    const rest = args.slice(2);
    let projectId;
    let forceId = false;
    let value;
    let i = 0;
    while (i < rest.length) {
        const arg = rest[i];
        if (arg === '--project') {
            projectId = rest[i + 1];
            if (projectId === undefined) {
                console.error('Error: --project requires a value');
                process.exit(1);
            }
            i += 2;
            continue;
        }
        if (arg === '--voice-id') {
            forceId = true;
            i++;
            continue;
        }
        if (arg.startsWith('--')) {
            console.error(`Error: unknown flag: ${arg}`);
            process.exit(1);
        }
        if (value === undefined && action === 'set') {
            value = arg;
            i++;
            continue;
        }
        console.error(`Error: unexpected argument: ${arg}`);
        process.exit(1);
    }
    const port = await detectPort();
    await projectVoiceCmd(action, value, { projectId, forceId }, port);
}
else if (command === 'speak') {
    const text = args.slice(1).join(' ').trim();
    if (!text) {
        console.error('Error: speak requires text, e.g. speak "tests pass, one thing left"');
        process.exit(1);
    }
    await speak(text);
}
else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
//# sourceMappingURL=cli.js.map