/**
 * Portable speech markup (feature 087).
 *
 * Agents write ONE vocabulary of [square] tags. This module parses text into a
 * provider-neutral SpeechScript; each provider serialises it its own way.
 *
 *   - Pauses and sounds are point events: they happen once, where written.
 *   - Mood, pace and voice (whisper/shout) are style: they last until changed;
 *     a new mood also ends whisper/shout (a new passage).
 *   - Emphasis applies to the next word.
 *   - Unknown tags: sound effects are dropped; a short word-like tag is a mood;
 *     anything else is dropped (Gemini only — ElevenLabs gets the text as is).
 *
 * Phase 1: ElevenLabs receives the ORIGINAL text byte-for-byte
 * (toElevenLabsText). The Gemini serialiser and the shared chunker land in
 * phase 2 on top of this parse.
 */

export interface SpeechStyle {
  mood?: string;
  pace?: string;
  voice?: string;
}

export type SpeechToken =
  | { kind: 'text'; text: string }
  | { kind: 'event'; event: string }
  | { kind: 'pause'; length: 'short' | 'long' }
  | { kind: 'hesitate' }
  | { kind: 'emphasis' };

export interface SpeechPart {
  style: SpeechStyle;
  tokens: SpeechToken[];
}

export type TagClass = 'pause' | 'sound' | 'voice' | 'mood' | 'pace' | 'emphasis' | 'reset' | 'dropped';

export interface ParsedTag {
  raw: string;
  /** Tag text without brackets, lower-cased and whitespace-collapsed. */
  name: string;
  bracket: 'square' | 'angle';
  cls: TagClass;
  /** True when the tag was not in the vocabulary (classified by the unknown-tag rules). */
  unknown: boolean;
}

export interface SpeechScript {
  /** The exact input text. */
  source: string;
  parts: SpeechPart[];
  tags: ParsedTag[];
}

type Mapping =
  | { cls: 'pause'; length: 'short' | 'long' }
  | { cls: 'hesitate' }
  | { cls: 'sound'; event: string }
  | { cls: 'voice'; value: string }
  | { cls: 'mood'; value: string }
  | { cls: 'pace'; value: string }
  | { cls: 'emphasis' }
  | { cls: 'reset' };

/** Portable vocabulary (what the messaging skill teaches) plus aliases. Keys are normalised names. */
const VOCABULARY: Record<string, Mapping> = {
  // pauses
  'pause': { cls: 'pause', length: 'short' },
  'short pause': { cls: 'pause', length: 'short' },
  'long pause': { cls: 'pause', length: 'long' },
  'continues after a beat': { cls: 'pause', length: 'short' },
  'beat': { cls: 'pause', length: 'short' },
  'hesitates': { cls: 'hesitate' },
  // sounds (Gemini event names)
  'laughs': { cls: 'sound', event: 'laugh' },
  'laugh': { cls: 'sound', event: 'laugh' },
  'laughing': { cls: 'sound', event: 'laugh' },
  'laughter': { cls: 'sound', event: 'laugh' },
  'chuckles': { cls: 'sound', event: 'chuckle' },
  'chuckle': { cls: 'sound', event: 'chuckle' },
  'giggles': { cls: 'sound', event: 'giggle' },
  'giggle': { cls: 'sound', event: 'giggle' },
  'sighs': { cls: 'sound', event: 'sigh' },
  'sigh': { cls: 'sound', event: 'sigh' },
  'exhales': { cls: 'sound', event: 'exhales' },
  'breathes': { cls: 'sound', event: 'breath' },
  'breath': { cls: 'sound', event: 'breath' },
  'gasps': { cls: 'sound', event: 'gasp' },
  'gasp': { cls: 'sound', event: 'gasp' },
  'clears throat': { cls: 'sound', event: 'throat-clearing' },
  'throat-clearing': { cls: 'sound', event: 'throat-clearing' },
  'coughs': { cls: 'sound', event: 'cough' },
  'cough': { cls: 'sound', event: 'cough' },
  'snorts': { cls: 'sound', event: 'snort' },
  'snort': { cls: 'sound', event: 'snort' },
  'groans': { cls: 'sound', event: 'groan' },
  'groan': { cls: 'sound', event: 'groan' },
  'yawns': { cls: 'sound', event: 'yawn' },
  'yawn': { cls: 'sound', event: 'yawn' },
  'crying': { cls: 'sound', event: 'cry' },
  'cry': { cls: 'sound', event: 'cry' },
  'sobs': { cls: 'sound', event: 'sob' },
  'sob': { cls: 'sound', event: 'sob' },
  'phew': { cls: 'sound', event: 'phew' },
  // voice (span)
  'whispers': { cls: 'voice', value: 'whispering' },
  'whispering': { cls: 'voice', value: 'whispering' },
  'shouts': { cls: 'voice', value: 'shouting' },
  'shouting': { cls: 'voice', value: 'shouting' },
  'shout': { cls: 'voice', value: 'shouting' },
  // mood (span)
  'excited': { cls: 'mood', value: 'excited' },
  'sad': { cls: 'mood', value: 'sad' },
  'angry': { cls: 'mood', value: 'angry' },
  'sarcastic': { cls: 'mood', value: 'sarcastic' },
  'curious': { cls: 'mood', value: 'curious' },
  'happily': { cls: 'mood', value: 'happy' },
  'happy': { cls: 'mood', value: 'happy' },
  'serious tone': { cls: 'mood', value: 'serious' },
  'serious': { cls: 'mood', value: 'serious' },
  'lighthearted': { cls: 'mood', value: 'lighthearted' },
  'matter-of-fact': { cls: 'mood', value: 'matter-of-fact' },
  'wistful': { cls: 'mood', value: 'wistful' },
  'resigned': { cls: 'mood', value: 'resigned' },
  'dramatic tone': { cls: 'mood', value: 'dramatic' },
  'dramatic': { cls: 'mood', value: 'dramatic' },
  'mischievously': { cls: 'mood', value: 'mischievous' },
  'calm': { cls: 'mood', value: 'calm' },
  'timidly': { cls: 'mood', value: 'timid' },
  // pace (span)
  'rushed': { cls: 'pace', value: 'fast' },
  'rapid-fire': { cls: 'pace', value: 'fast' },
  'slows down': { cls: 'pace', value: 'slow and deliberate' },
  'deliberate': { cls: 'pace', value: 'slow and deliberate' },
  'drawn out': { cls: 'pace', value: 'drawn out' },
  // emphasis (next word)
  'stress on next word': { cls: 'emphasis' },
  'emphasized': { cls: 'emphasis' },
  // reset (not taught — phase 0 found no reliable ElevenLabs reset)
  'normal': { cls: 'reset' },
};

/** Gemini vocal tag names accepted in <angle> brackets as input (tolerant parsing). */
const ANGLE_NAMES: Record<string, Mapping> = {
  'short pause': { cls: 'pause', length: 'short' },
  'long pause': { cls: 'pause', length: 'long' },
  'whispers': { cls: 'voice', value: 'whispering' },
  'whispering': { cls: 'voice', value: 'whispering' },
  'shout': { cls: 'voice', value: 'shouting' },
  'heavy breath': { cls: 'sound', event: 'heavy breath' },
};
for (const ev of ['argh', 'breath', 'exhales', 'cackle', 'cheer', 'chuckle', 'chuckles', 'cough', 'cry', 'gasp', 'giggle', 'groan',
  'growl', 'grunt', 'grr', 'hiss', 'laugh', 'laughs', 'laughter', 'moan', 'pant', 'pff', 'phew', 'scream', 'shriek', 'sigh', 'sighs',
  'sneeze', 'snicker', 'snort', 'sob', 'throat-clearing', 'tsk', 'whimper', 'yawn']) {
  const canonical = ev === 'laughs' || ev === 'laughter' ? 'laugh' : ev === 'chuckles' ? 'chuckle' : ev === 'sighs' ? 'sigh' : ev;
  ANGLE_NAMES[ev] = { cls: 'sound', event: canonical };
}

/** Words that mark an unknown tag as a sound effect (dropped; Google advises against them). */
const SOUND_EFFECT_WORDS = [
  'applause', 'clapping', 'cheering crowd', 'music', 'thud', 'bang', 'crash', 'explosion', 'door',
  'knock', 'footsteps', 'phone', 'ring', 'beep', 'wind', 'rain', 'thunder', 'silence',
];

const UNKNOWN_MOOD = /^[a-z][a-z \-]{0,38}$/;

function normaliseName(inner: string): string {
  return inner.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Unknown-tag rules (design §5): sound effect → dropped; short word-like → mood; else dropped. */
export function classifyUnknownTag(name: string): 'mood' | 'dropped' {
  const words = name.split(' ');
  if (SOUND_EFFECT_WORDS.some(w => (w.includes(' ') ? name.includes(w) : words.includes(w)))) return 'dropped';
  if (UNKNOWN_MOOD.test(name) && words.length <= 4) return 'mood';
  return 'dropped';
}

// [tag] of 1-40 chars without newline, or a <known angle tag>.
const ANGLE_ALTERNATION = Object.keys(ANGLE_NAMES).sort((a, b) => b.length - a.length).map(n => n.replace(/[-]/g, '\\-')).join('|');
const TAG_PATTERN = new RegExp(`\\[([^\\]\\n]{1,40})\\]|<(${ANGLE_ALTERNATION})>`, 'gi');

function mappingFor(name: string, bracket: 'square' | 'angle'): { mapping: Mapping | null; unknown: boolean } {
  const known = bracket === 'angle' ? ANGLE_NAMES[name] : VOCABULARY[name];
  if (known) return { mapping: known, unknown: false };
  if (bracket === 'angle') return { mapping: null, unknown: true };
  // "X tone" → mood X (e.g. "[sarcastic tone]")
  const toneMatch = name.match(/^([a-z][a-z \-]*?) tone$/);
  if (toneMatch && classifyUnknownTag(toneMatch[1]) === 'mood') return { mapping: { cls: 'mood', value: toneMatch[1] }, unknown: true };
  return classifyUnknownTag(name) === 'mood'
    ? { mapping: { cls: 'mood', value: name }, unknown: true }
    : { mapping: null, unknown: true };
}

/** Parse text into a provider-neutral script. Never throws. */
export function parseSpeech(text: string): SpeechScript {
  const source = typeof text === 'string' ? text : '';
  const parts: SpeechPart[] = [];
  const tags: ParsedTag[] = [];
  let style: SpeechStyle = {};
  let current: SpeechPart = { style: { ...style }, tokens: [] };

  const startPart = (next: SpeechStyle) => {
    style = next;
    if (current.tokens.length > 0) parts.push(current);
    current = { style: { ...style }, tokens: [] };
  };
  const pushText = (t: string) => {
    if (!t) return;
    const last = current.tokens[current.tokens.length - 1];
    if (last && last.kind === 'text') last.text += t;
    else current.tokens.push({ kind: 'text', text: t });
  };

  let cursor = 0;
  TAG_PATTERN.lastIndex = 0;
  for (let m = TAG_PATTERN.exec(source); m; m = TAG_PATTERN.exec(source)) {
    pushText(source.slice(cursor, m.index));
    cursor = m.index + m[0].length;
    const bracket: 'square' | 'angle' = m[1] !== undefined ? 'square' : 'angle';
    const name = normaliseName(m[1] ?? m[2]);
    const { mapping, unknown } = mappingFor(name, bracket);
    const cls: TagClass = mapping ? (mapping.cls === 'hesitate' ? 'pause' : mapping.cls) : 'dropped';
    tags.push({ raw: m[0], name, bracket, cls, unknown });
    if (!mapping) continue;
    switch (mapping.cls) {
      case 'pause': current.tokens.push({ kind: 'pause', length: mapping.length }); break;
      case 'hesitate': current.tokens.push({ kind: 'hesitate' }); break;
      case 'sound': current.tokens.push({ kind: 'event', event: mapping.event }); break;
      case 'emphasis': current.tokens.push({ kind: 'emphasis' }); break;
      // A new mood starts a new passage: it also ends whisper/shout (pace persists).
      case 'mood': { const { voice: _ended, ...rest } = style; startPart({ ...rest, mood: mapping.value }); break; }
      case 'pace': startPart({ ...style, pace: mapping.value }); break;
      case 'voice': startPart({ ...style, voice: mapping.value }); break;
      case 'reset': startPart({}); break;
    }
  }
  pushText(source.slice(cursor));
  if (current.tokens.length > 0 || parts.length === 0) parts.push(current);
  return { source, parts, tags };
}

/**
 * Text sent to ElevenLabs. Phase 1: the original text, byte-for-byte
 * (ElevenLabs v3 reads [square] tags natively and handles free-form ones).
 * Phase 2 adds the one deliberate change: known <angle> tags rewritten to
 * their square equivalents.
 */
export function toElevenLabsText(script: SpeechScript): string {
  return script.source;
}

/** The whole script as one chunk (ElevenLabs always; Gemini when short enough). */
export function singleChunk(script: SpeechScript): ScriptChunkLike {
  return { text: script.source, script, inheritedStyle: {}, gapAfterMs: 0 };
}

export interface ScriptChunkLike {
  text: string;
  script: SpeechScript;
  inheritedStyle: SpeechStyle;
  gapAfterMs: number;
}

// --- Gemini serialisation (feature 087, phase 2) ------------------------------

/** One Gemini request carries at most this many style parts; later changes merge into the last. */
export const MAX_STYLE_PARTS = 8;
/** Gemini chunk size (phase 0: latency ≈ 1.5 s + 20 ms/char, so 600 ≈ 13 s per request). */
export const DEFAULT_CHUNK_CHARS = 600;
/** Silence between joined chunks. */
export const GAP_PARAGRAPH_MS = 250;
export const GAP_SENTENCE_MS = 120;

export interface GeminiPart {
  text: string;
  /** Natural-language delivery, e.g. "excited, fast, whispering". */
  style?: string;
}

export function styleText(style: SpeechStyle): string {
  return [style.mood, style.pace, style.voice].filter(Boolean).join(', ');
}

const hasWords = (t: string) => /[\p{L}\p{N}]/u.test(t.replace(/<[^>]*>/g, ''));

/** Render tokens as Gemini text: events/pauses → <angle> tags, hesitation → "...", emphasis → CAPS. */
function tokensToGeminiText(tokens: SpeechToken[]): string {
  let out = '';
  let emphasize = false;
  for (const t of tokens) {
    switch (t.kind) {
      case 'text': {
        let text = t.text;
        if (emphasize && /\S/.test(text)) {
          text = text.replace(/^(\s*)(\S+)/, (_m, ws: string, w: string) => ws + w.toUpperCase());
          emphasize = false;
        }
        out += text;
        break;
      }
      case 'event': out += ` <${t.event}> `; break;
      case 'pause': out += ` <${t.length} pause> `; break;
      case 'hesitate': out = out.replace(/\s+$/, '') + '... '; break;
      case 'emphasis': emphasize = true; break;
    }
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?;:])/g, '$1').trim();
}

/**
 * Gemini request parts for a script: one part per style run. A run with no
 * words (only a laugh or a pause) is merged into its neighbour; identical
 * consecutive styles are merged; after MAX_STYLE_PARTS, further style changes
 * merge into the last part. Square tags never reach Gemini (they can be read
 * aloud — phase 0 saw it happen).
 */
export function toGeminiParts(script: SpeechScript): GeminiPart[] {
  const raw = script.parts
    .map((p) => ({ text: tokensToGeminiText(p.tokens), style: styleText(p.style) }))
    .filter((p) => p.text.length > 0);
  const merged: Array<{ text: string; style: string }> = [];
  let pending = '';
  for (const p of raw) {
    if (!hasWords(p.text)) {
      pending = pending ? `${pending} ${p.text}` : p.text;
      continue;
    }
    const text = pending ? `${pending} ${p.text}` : p.text;
    pending = '';
    const last = merged[merged.length - 1];
    if (last && (last.style === p.style || merged.length >= MAX_STYLE_PARTS)) last.text = `${last.text} ${text}`;
    else merged.push({ text, style: p.style });
  }
  if (pending) {
    if (merged.length) merged[merged.length - 1].text += ` ${pending}`;
    else merged.push({ text: pending, style: '' });
  }
  return merged.map((p) => (p.style ? { text: p.text, style: p.style } : { text: p.text }));
}

/** Canonical text of a script as Gemini will receive it (cache identity of a chunk). */
export function geminiCanonicalText(script: SpeechScript): string {
  return toGeminiParts(script).map((p) => `${p.style ?? ''}\u241e${p.text}`).join('\u241d');
}

// --- Shared chunker ---------------------------------------------------------------

interface Unit {
  style: SpeechStyle;
  part: number;
  tokens: SpeechToken[];
  /** 3 = style-part end, 2 = paragraph, 1 = sentence, 0 = mid-sentence. */
  breakAfter: number;
}

const unitLength = (u: Unit) => tokensToGeminiText(u.tokens).length + 1;

/** Serialized length of one token as Gemini text (tags included). */
function tokenLength(t: SpeechToken): number {
  switch (t.kind) {
    case 'text': return t.text.length;
    case 'event': return t.event.length + 3;
    case 'pause': return t.length.length + 9; // " <short pause> "
    case 'hesitate': return 4;
    case 'emphasis': return 0;
  }
}

/**
 * Long single sentence: split on TOKENS, never inside one (P2, #0369). Text is
 * cut only between words; events and pauses stay atomic (a cut can never turn
 * "<short pause>" into spoken "<short" / "pause>"); an emphasis marker stays
 * with the word it emphasises. A single word longer than `max` (no spaces —
 * e.g. CJK or a URL) is the only thing split mid-word.
 */
function splitLongUnit(u: Unit, max: number): Unit[] {
  if (tokensToGeminiText(u.tokens).length + 1 <= max) return [u];
  const atoms: SpeechToken[] = [];
  for (const t of u.tokens) {
    if (t.kind !== 'text') { atoms.push(t); continue; }
    for (const word of t.text.match(/\s*\S+\s*|\s+/g) ?? []) {
      if (word.length <= max) { atoms.push({ kind: 'text', text: word }); continue; }
      for (let i = 0; i < word.length; i += max) atoms.push({ kind: 'text', text: word.slice(i, i + max) });
    }
  }
  const pieces: SpeechToken[][] = [];
  let piece: SpeechToken[] = [];
  let size = 0;
  for (const a of atoms) {
    const len = tokenLength(a);
    const lastIsEmphasis = piece.length > 0 && piece[piece.length - 1].kind === 'emphasis';
    if (piece.length && size + len > max && !lastIsEmphasis) {
      pieces.push(piece);
      piece = [];
      size = 0;
    }
    piece.push(a);
    size += len;
  }
  if (piece.length) pieces.push(piece);
  return pieces.map((tokens, i) => ({
    style: u.style, part: u.part,
    // merge adjacent text atoms back into one token
    tokens: tokens.reduce<SpeechToken[]>((acc, t) => {
      const last = acc[acc.length - 1];
      if (t.kind === 'text' && last?.kind === 'text') last.text += t.text;
      else acc.push(t.kind === 'text' ? { kind: 'text', text: t.text } : t);
      return acc;
    }, []),
    breakAfter: i === pieces.length - 1 ? u.breakAfter : 0,
  }));
}

function toUnits(script: SpeechScript, max: number): Unit[] {
  const units: Unit[] = [];
  script.parts.forEach((part, pi) => {
    let cur: Unit = { style: part.style, part: pi, tokens: [], breakAfter: 0 };
    const flush = (breakAfter: number) => {
      if (cur.tokens.length) { cur.breakAfter = breakAfter; units.push(cur); }
      cur = { style: part.style, part: pi, tokens: [], breakAfter: 0 };
    };
    for (const t of part.tokens) {
      if (t.kind !== 'text') { cur.tokens.push(t); continue; }
      // paragraph (2) and sentence (1) boundaries inside the text
      const re = /(\n\s*\n)|([.!?\u2026]+["')\]]*\s+)/g;
      let last = 0;
      for (let m = re.exec(t.text); m; m = re.exec(t.text)) {
        const end = m.index + m[0].length;
        cur.tokens.push({ kind: 'text', text: t.text.slice(last, end) });
        flush(m[1] ? 2 : 1);
        last = end;
      }
      if (last < t.text.length) cur.tokens.push({ kind: 'text', text: t.text.slice(last) });
    }
    flush(3);
  });
  return units.flatMap((u) => splitLongUnit(u, max));
}

function chunkFromUnits(units: Unit[], isLast: boolean): ScriptChunkLike {
  const parts: SpeechPart[] = [];
  for (const u of units) {
    const prev = parts[parts.length - 1];
    if (prev && (prev as SpeechPart & { _i?: number })._i === u.part) prev.tokens.push(...u.tokens);
    else parts.push(Object.assign({ style: { ...u.style }, tokens: [...u.tokens] }, { _i: u.part }));
  }
  for (const p of parts) delete (p as SpeechPart & { _i?: number })._i;
  const script: SpeechScript = { source: '', parts, tags: [] };
  script.source = geminiCanonicalText(script);
  const lastBreak = units[units.length - 1]?.breakAfter ?? 0;
  return {
    text: script.source,
    script,
    inheritedStyle: { ...(units[0]?.style ?? {}) },
    gapAfterMs: isLast ? 0 : lastBreak >= 2 ? GAP_PARAGRAPH_MS : GAP_SENTENCE_MS,
  };
}

/**
 * Split a parsed script into provider requests of at most `maxChars` (as
 * Gemini text), cutting at the strongest boundary available — style-part end,
 * then paragraph, then sentence, then words. Each chunk keeps the style it
 * inherits, so chunks render independently (in parallel) and join cleanly.
 * One chunk when it already fits.
 */
export function chunkScript(script: SpeechScript, maxChars: number = DEFAULT_CHUNK_CHARS): ScriptChunkLike[] {
  const units = toUnits(script, maxChars);
  if (units.length === 0) return [singleChunk(script)];
  const groups: Unit[][] = [];
  let current: Unit[] = [];
  let size = 0;
  for (const u of units) {
    const len = unitLength(u);
    if (current.length && size + len > maxChars) {
      // close at the strongest (latest) boundary in the current chunk
      let cut = current.length - 1;
      for (let i = current.length - 1; i >= 0; i--) if (current[i].breakAfter > current[cut].breakAfter) cut = i;
      groups.push(current.slice(0, cut + 1));
      current = current.slice(cut + 1);
      size = current.reduce((n, x) => n + unitLength(x), 0);
      if (current.length && size + len > maxChars) {
        groups.push(current);
        current = [];
        size = 0;
      }
    }
    current.push(u);
    size += len;
  }
  if (current.length) groups.push(current);
  return groups.map((g, i) => chunkFromUnits(g, i === groups.length - 1));
}
