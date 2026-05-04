import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ARCHIVE_EXTENSIONS = new Set(['.ogg', '.mp3']);
const DEFAULT_MAX_FILES = 10;
const DEFAULT_DIR_RELATIVE = path.join('data', 'tts-archive');

function getWorkspaceRoot(): string {
  if (process.env.SLYCODE_HOME) return process.env.SLYCODE_HOME;
  return path.resolve(__dirname, '..', '..');
}

function resolveDir(): string {
  const override = process.env.TTS_ARCHIVE_DIR;
  if (override) {
    return path.isAbsolute(override) ? override : path.resolve(getWorkspaceRoot(), override);
  }
  return path.join(getWorkspaceRoot(), DEFAULT_DIR_RELATIVE);
}

function resolveMax(): number {
  const raw = process.env.TTS_ARCHIVE_MAX;
  if (!raw) return DEFAULT_MAX_FILES;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_FILES;
}

export function slugify(text: string, maxLen = 40): string {
  // Strip ElevenLabs audio tags ([excited], [pause], etc.) before slugifying
  const stripped = text.replace(/\[[^\]]*\]/g, ' ');
  const slug = stripped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) return 'untitled';
  return slug.length > maxLen ? slug.slice(0, maxLen).replace(/-+$/, '') : slug;
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}` +
    `-${pad(d.getMilliseconds(), 3)}`
  );
}

export function save(buffer: Buffer, ext: '.ogg' | '.mp3', contextSlug: string): void {
  try {
    const dir = resolveDir();
    fs.mkdirSync(dir, { recursive: true });
    const safeContext = slugify(contextSlug);
    const filename = `${timestamp()}_${safeContext}${ext}`;
    fs.writeFileSync(path.join(dir, filename), buffer);
    prune(resolveMax());
  } catch (err) {
    console.warn(`[audio-archive] save failed: ${(err as Error).message}`);
  }
}

export function prune(maxFiles: number): void {
  try {
    const dir = resolveDir();
    if (!fs.existsSync(dir)) return;
    const files = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .filter((name) => ARCHIVE_EXTENSIONS.has(path.extname(name).toLowerCase()));
    if (files.length <= maxFiles) return;
    const stats = files.map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    });
    stats.sort((a, b) => a.mtime - b.mtime);
    const toRemove = stats.slice(0, stats.length - maxFiles);
    for (const f of toRemove) {
      try {
        fs.unlinkSync(f.full);
      } catch (err) {
        console.warn(`[audio-archive] prune unlink failed: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.warn(`[audio-archive] prune failed: ${(err as Error).message}`);
  }
}
