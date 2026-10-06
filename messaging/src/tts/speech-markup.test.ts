import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpeech, toElevenLabsText, classifyUnknownTag, singleChunk } from './speech-markup.js';

const styleOf = (text: string) => parseSpeech(text).parts.map((p) => p.style);
const tagsOf = (text: string) => parseSpeech(text).tags.map((t) => [t.name, t.cls, t.unknown]);

test('ElevenLabs text is the original, byte for byte (phase 1)', () => {
  const samples = [
    "[excited] Good news, the build passed on the first try! [laughs] [pause] [whispers] Don't tell the tests I was surprised. [calm] Anyway.",
    '[serious tone] Right. [continues after a beat] [stress on next word] Three. [short pause] <laugh> [normal] Done.\nNew "line" — café 日本語.',
    'x < 5 and a <b> c, [applause 2x], [stage left!]',
    '',
  ];
  for (const s of samples) assert.equal(toElevenLabsText(parseSpeech(s)), s);
});

test('pauses and sounds are point events; aliases resolve to one event name', () => {
  const s = parseSpeech('Hi [pause] there [long pause] ok [laughs] [chuckles] [clears throat] [hesitates] fine');
  const kinds = s.parts[0].tokens.filter((t) => t.kind !== 'text');
  assert.deepEqual(kinds, [
    { kind: 'pause', length: 'short' },
    { kind: 'pause', length: 'long' },
    { kind: 'event', event: 'laugh' },
    { kind: 'event', event: 'chuckle' },
    { kind: 'event', event: 'throat-clearing' },
    { kind: 'hesitate' },
  ]);
  assert.equal(s.parts.length, 1, 'events never start a new part');
});

test('mood, pace and voice are style that lasts until changed; a new mood also ends whisper/shout', () => {
  assert.deepEqual(styleOf('[excited] A. B. [rushed] C. [whispers] D. [calm] E.'), [
    { mood: 'excited' },
    { mood: 'excited', pace: 'fast' },
    { mood: 'excited', pace: 'fast', voice: 'whispering' },
    { mood: 'calm', pace: 'fast' },
  ], 'a new mood ends whisper/shout; pace persists');
  assert.deepEqual(styleOf('[serious tone] x [dramatic tone] y [slows down] z'), [
    { mood: 'serious' }, { mood: 'dramatic' }, { mood: 'dramatic', pace: 'slow and deliberate' },
  ]);
  assert.deepEqual(styleOf('[whispers] secret [normal] ordinary'), [{ voice: 'whispering' }, {}], '[normal] still resets when written');
});

test('unknown tags: sound effects dropped, short word-like tags become moods, anything else dropped', () => {
  assert.equal(classifyUnknownTag('applause'), 'dropped');
  assert.equal(classifyUnknownTag('applause 2x'), 'dropped');
  assert.equal(classifyUnknownTag('door creaks'), 'dropped');
  assert.equal(classifyUnknownTag('mischievously'), 'mood');
  assert.equal(classifyUnknownTag('warm and reassuring'), 'mood');
  assert.equal(classifyUnknownTag('stage left!'), 'dropped');
  assert.equal(classifyUnknownTag('a very long direction with too many words'), 'dropped');
  assert.deepEqual(tagsOf('[applause] [mischievously] [warm and reassuring] [stage left!] [sarcastic tone]'), [
    ['applause', 'dropped', true],
    ['mischievously', 'mood', false],
    ['warm and reassuring', 'mood', true],
    ['stage left!', 'dropped', true],
    ['sarcastic tone', 'mood', true], // not in the vocabulary; the "X tone" rule makes it a mood
  ]);
});

test('tolerant input: known <angle> tags parse; unknown <...> and comparisons stay text', () => {
  const s = parseSpeech('ok <laugh> <Short Pause> then x < 5 and <b> bold');
  assert.deepEqual(s.tags.map((t) => [t.name, t.bracket, t.cls]), [['laugh', 'angle', 'sound'], ['short pause', 'angle', 'pause']]);
  const text = s.parts[0].tokens.filter((t) => t.kind === 'text').map((t) => (t as { text: string }).text).join('');
  assert.ok(text.includes('x < 5 and <b> bold'));
});

test('emphasis marks the next word; tags-only text yields no speakable text', () => {
  assert.deepEqual(parseSpeech('[stress on next word] Three').parts[0].tokens[0], { kind: 'emphasis' });
  const only = parseSpeech('[pause] [laughs]');
  assert.ok(only.parts.every((p) => p.tokens.every((t) => t.kind !== 'text' || t.text.trim() === '')));
});

test('singleChunk carries the whole script with no inherited style', () => {
  const script = parseSpeech('[excited] hi');
  assert.deepEqual(singleChunk(script), { text: '[excited] hi', script, inheritedStyle: {}, gapAfterMs: 0 });
});

// --- Gemini serialisation and the shared chunker (phase 2) ---------------------

import { toGeminiParts, chunkScript, MAX_STYLE_PARTS, GAP_PARAGRAPH_MS, GAP_SENTENCE_MS, geminiCanonicalText } from './speech-markup.js';

test('Gemini parts: events → <angle>, moods → style parts, whisper ends at the next mood', () => {
  const parts = toGeminiParts(parseSpeech("[excited] Good news, the build passed! [laughs] [pause] [whispers] Don't tell the tests. [calm] Anyway, one thing left."));
  assert.deepEqual(parts, [
    { text: 'Good news, the build passed! <laugh> <short pause>', style: 'excited' },
    { text: "Don't tell the tests.", style: 'excited, whispering' },
    { text: 'Anyway, one thing left.', style: 'calm' },
  ]);
});

test('Gemini text never carries square brackets; hesitation, emphasis and long pauses render', () => {
  const [p] = toGeminiParts(parseSpeech('So [hesitates] I think [stress on next word] three tests [long pause] broke. [applause] [stage left!]'));
  assert.equal(p.text, 'So... I think THREE tests <long pause> broke.');
  assert.equal(p.style, undefined);
  for (const s of ['[serious tone] Right. [continues after a beat] The migration failed. [mischievously] But I have a plan.', '[clears throat] [sighs] ok']) {
    for (const part of toGeminiParts(parseSpeech(s))) assert.ok(!/[\[\]]/.test(part.text), part.text);
  }
});

test('word-less runs merge into a neighbour; identical styles merge; the part cap holds', () => {
  assert.deepEqual(toGeminiParts(parseSpeech('[excited] [laughs] [calm] Fine.')), [{ text: '<laugh> Fine.', style: 'calm' }]);
  assert.deepEqual(toGeminiParts(parseSpeech('[calm] One. [calm] Two.')), [{ text: 'One. Two.', style: 'calm' }]);
  const moods = ['excited', 'sad', 'angry', 'curious', 'calm', 'sarcastic', 'wistful', 'resigned', 'lighthearted', 'happily', 'timidly', 'excited'];
  const parts = toGeminiParts(parseSpeech(moods.map((m, i) => `[${m}] Sentence ${i}.`).join(' ')));
  assert.equal(parts.length, MAX_STYLE_PARTS);
  assert.match(parts[MAX_STYLE_PARTS - 1].text, /Sentence 7\. Sentence 8\. .*Sentence 11\./, 'later changes merge into the last part');
});

const para = (n: number, words = 18) => Array.from({ length: n }, (_, i) => `Sentence ${i} has a few ordinary words in it to make some length here.`.split(' ').slice(0, words).join(' ') + '.').join(' ');

test('chunker: text that fits is one chunk; long text splits at paragraph, then sentence boundaries', () => {
  assert.equal(chunkScript(parseSpeech('Short and sweet.'), 600).length, 1);
  const text = `${para(5)}\n\n${para(5)}\n\n${para(5)}`;
  const chunks = chunkScript(parseSpeech(text), 400);
  assert.ok(chunks.length >= 3);
  for (const c of chunks) {
    const len = toGeminiParts(c.script).map((p) => p.text).join(' ').length;
    assert.ok(len <= 400, `chunk of ${len} chars`);
    assert.match(c.text, /\.\s*$|\.(?=\u241d|$)/, 'chunks end at a sentence boundary');
  }
  assert.equal(chunks.at(-1)!.gapAfterMs, 0);
  assert.ok(chunks.slice(0, -1).every((c) => c.gapAfterMs === GAP_PARAGRAPH_MS || c.gapAfterMs === GAP_SENTENCE_MS));
  const words = (s: string) => s.replace(/\u241e|\u241d/g, ' ').split(/\s+/).filter(Boolean).length;
  assert.equal(chunks.reduce((n, c) => n + words(toGeminiParts(c.script).map((p) => p.text).join(' ')), 0), words(text), 'no words lost or duplicated');
});

test('chunker: speak at the limit (1,600 chars) is 3 chunks of ≤600; 5,000 chars is about 9', () => {
  const speak = para(30).slice(0, 1600);
  assert.equal(chunkScript(parseSpeech(speak), 600).length, 3);
  const long = para(100).slice(0, 5000);
  const n = chunkScript(parseSpeech(long), 600).length;
  assert.ok(n >= 9 && n <= 10, `${n} chunks`);
});

test('chunker: inherited style survives a boundary; same words under different moods are different chunks', () => {
  const s = parseSpeech(`[excited] ${para(4)} [whispers] ${para(4)}`);
  const chunks = chunkScript(s, 300);
  assert.ok(chunks.length >= 2);
  assert.deepEqual(chunks[0].inheritedStyle, { mood: 'excited' });
  const whisperChunk = chunks.find((c) => c.inheritedStyle.voice === 'whispering');
  assert.ok(whisperChunk, 'a later chunk starts inside the whisper');
  assert.equal(toGeminiParts(whisperChunk!.script)[0].style, 'excited, whispering', 'the chunk re-states its inherited style');
  const a = chunkScript(parseSpeech('[calm] Same words here.'), 600)[0];
  const b = chunkScript(parseSpeech('[excited] Same words here.'), 600)[0];
  assert.notEqual(a.text, b.text);
  assert.notEqual(geminiCanonicalText(a.script), geminiCanonicalText(b.script));
});

test('chunker: one huge sentence is split at words, never mid-word', () => {
  const words = Array.from({ length: 300 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkScript(parseSpeech(words), 500);
  assert.ok(chunks.length >= 4);
  const rejoined = chunks.map((c) => toGeminiParts(c.script).map((p) => p.text).join(' ')).join(' ');
  assert.equal(rejoined, words);
});

// --- Fix loop: tags stay atomic when a long sentence is split ----------------------

test('splitting a long sentence never cuts inside a tag, never mid-word, keeps emphasis with its word', () => {
  // One long sentence (no sentence/paragraph boundary) packed with tags, so the word splitter must run.
  const words = Array.from({ length: 140 }, (_, i) => `word${i}`);
  const withTags = words.map((w, i) => (i % 9 === 4 ? `${w} [short pause]` : i % 13 === 7 ? `${w} [laughs]` : i % 17 === 3 ? `[stress on next word] ${w}` : w)).join(' ');
  for (const max of [60, 97, 150, 233]) {
    const chunks = chunkScript(parseSpeech(`[excited] ${withTags}`), max);
    assert.ok(chunks.length > 1, `max ${max}`);
    const texts = chunks.map((c) => toGeminiParts(c.script).map((p) => p.text).join(' '));
    for (const t of texts) {
      const leftover = t.replace(/<(short pause|long pause|laugh)>/g, '');
      assert.ok(!/[<>]/.test(leftover), `broken tag in: ${t}`);
      assert.ok(!/[\[\]]/.test(t), 'no square brackets');
    }
    const all = texts.join(' ');
    assert.equal((all.match(/<short pause>/g) ?? []).length, (withTags.match(/\[short pause\]/g) ?? []).length, 'every pause survives once');
    assert.equal((all.match(/<laugh>/g) ?? []).length, (withTags.match(/\[laughs\]/g) ?? []).length, 'every laugh survives once');
    const spoken = all.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean);
    assert.deepEqual(spoken.map((w) => w.toLowerCase()), words, 'ordinary words intact, in order, none split');
    for (const w of spoken) if (/^WORD\d+$/.test(w)) assert.ok(words.indexOf(w.toLowerCase()) % 17 === 3, `${w} emphasised as written`);
  }
});

test('a single word longer than the limit is the only thing split mid-word', () => {
  const long = 'x'.repeat(130);
  const chunks = chunkScript(parseSpeech(`short ${long} tail`), 50);
  const rejoined = chunks.map((c) => toGeminiParts(c.script).map((p) => p.text).join(' ')).join('');
  assert.ok(rejoined.replace(/\s+/g, '').includes(long));
});
