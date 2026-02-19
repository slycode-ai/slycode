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

function printUsage(): void {
  console.log(`Usage: messaging-cli send <message> [--tts]

Commands:
  send <message>         Send a text message to the active channel
  send <message> --tts   Send a voice message (text-to-speech)

Examples:
  messaging-cli send "The build is complete"
  messaging-cli send "Here's a summary of the changes" --tts`);
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
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}
