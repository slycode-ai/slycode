import { NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';

function getSettingsPath(): string {
  return path.join(getSlycodeRoot(), 'data', 'settings.json');
}

const DEFAULT_SETTINGS = {
  voice: {
    autoSubmitTerminal: true,
    maxRecordingSeconds: 300,
    shortcuts: {
      startRecording: 'Ctrl+.',
      pauseResume: 'Space',
      submit: 'Enter',
      submitPasteOnly: 'Shift+Enter',
      clear: 'Escape',
    },
  },
};

export async function GET() {
  try {
    const data = await fs.readFile(getSettingsPath(), 'utf-8');
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json(DEFAULT_SETTINGS);
  }
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key] as Record<string, unknown>, source[key] as Record<string, unknown>);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

function validateVoiceSettings(voice: unknown): string | null {
  if (typeof voice !== 'object' || voice === null) return '"voice" must be an object';
  const v = voice as Record<string, unknown>;

  if (v.autoSubmitTerminal !== undefined && typeof v.autoSubmitTerminal !== 'boolean') {
    return '"voice.autoSubmitTerminal" must be a boolean';
  }
  if (v.maxRecordingSeconds !== undefined) {
    if (typeof v.maxRecordingSeconds !== 'number' || v.maxRecordingSeconds <= 0) {
      return '"voice.maxRecordingSeconds" must be a positive number';
    }
  }
  if (v.shortcuts !== undefined) {
    if (typeof v.shortcuts !== 'object' || v.shortcuts === null) {
      return '"voice.shortcuts" must be an object';
    }
    const s = v.shortcuts as Record<string, unknown>;
    for (const [key, val] of Object.entries(s)) {
      if (typeof val !== 'string') {
        return `"voice.shortcuts.${key}" must be a string`;
      }
    }
  }
  return null;
}

export async function PUT(request: Request) {
  try {
    const updates = await request.json();

    if (typeof updates !== 'object' || updates === null) {
      return NextResponse.json({ error: 'Payload must be an object' }, { status: 400 });
    }

    if (updates.voice !== undefined) {
      const err = validateVoiceSettings(updates.voice);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
    }

    const settingsPath = getSettingsPath();
    let existing: Record<string, unknown>;
    try {
      existing = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));
    } catch {
      existing = { ...DEFAULT_SETTINGS };
    }

    const merged = deepMerge(existing, updates as Record<string, unknown>);
    await fs.writeFile(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    return NextResponse.json(merged);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
