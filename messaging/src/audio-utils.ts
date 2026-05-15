import { createHash } from 'crypto';

const WINDOWS_RESERVED_BASENAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

export function stripAudioTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, ' ');
}

export function slugifyForFilename(text: string, maxLen = 40): string {
  const stripped = stripAudioTags(text);
  // NFKD then strip combining marks (covers diacritics: café → cafe)
  const normalized = stripped.normalize('NFKD').replace(/\p{M}/gu, '');
  let slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'tts';
  if (slug.length > maxLen) slug = slug.slice(0, maxLen).replace(/-+$/, '');
  if (WINDOWS_RESERVED_BASENAMES.has(slug.toUpperCase())) slug = `tts-${slug}`;
  return slug;
}

export function pickFirstNWords(text: string, n: number): string {
  const stripped = stripAudioTags(text).trim();
  if (!stripped) return '';
  return stripped.split(/\s+/).slice(0, n).join(' ');
}

export function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  );
}

export function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildGeneratedFilename(opts: {
  text: string;
  voiceId: string | null;
  format: 'ogg' | 'mp3';
}): string {
  const slug = slugifyForFilename(pickFirstNWords(opts.text, 5));
  const hash8 = createHash('sha256')
    .update(`${opts.text}|${opts.voiceId ?? ''}|${opts.format}`)
    .digest('hex')
    .slice(0, 8);
  return `${timestamp()}_${slug}_${hash8}.${opts.format}`;
}
