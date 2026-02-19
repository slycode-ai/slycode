import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getSlycodeRoot } from '@/lib/paths';

function getClassesFile(): string {
  return path.join(getSlycodeRoot(), 'documentation', 'terminal-classes.json');
}

export interface TerminalClass {
  id: string;
  name: string;
  description: string;
  members: string[];
}

export interface TerminalClassesConfig {
  version: string;
  classes: TerminalClass[];
}

export async function GET() {
  try {
    const content = await fs.readFile(getClassesFile(), 'utf-8');
    const config: TerminalClassesConfig = JSON.parse(content);
    return NextResponse.json(config);
  } catch (_err) {
    // Return empty config if file doesn't exist
    return NextResponse.json({
      version: '1.0',
      classes: [],
    });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    // Validate the structure
    if (!body.classes || !Array.isArray(body.classes)) {
      return NextResponse.json(
        { error: 'Invalid format: classes array required' },
        { status: 400 }
      );
    }

    const config: TerminalClassesConfig = {
      $schema: './terminal-classes.schema.json',
      version: body.version || '1.0',
      classes: body.classes,
    } as TerminalClassesConfig & { $schema: string };

    await fs.writeFile(getClassesFile(), JSON.stringify(config, null, 2));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to write terminal-classes.json:', err);
    return NextResponse.json(
      { error: 'Failed to save configuration' },
      { status: 500 }
    );
  }
}
