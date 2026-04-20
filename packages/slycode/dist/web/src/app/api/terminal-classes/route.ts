import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { getSlycodeRoot, getPackageDir } from '@/lib/paths';

function getClassesFile(): string {
  return path.join(getSlycodeRoot(), 'documentation', 'terminal-classes.json');
}

/**
 * Find the terminal-classes.json template from the package.
 * In prod: node_modules/@slycode/slycode/templates/terminal-classes.json
 * In dev: falls back to documentation/terminal-classes.json at repo root
 *
 * Note: getPackageDir() returns .../dist, but templates/ is at the package root.
 */
function getPackageTemplate(): string | null {
  const pkgDir = getPackageDir();
  // Prod: templates/ is at package root (one level up from dist/)
  const pkgRoot = path.dirname(pkgDir);
  const templatePath = path.join(pkgRoot, 'templates', 'terminal-classes.json');
  if (fsSync.existsSync(templatePath)) return templatePath;
  // Dev fallback: the source file at repo root
  const devPath = path.join(getSlycodeRoot(), 'documentation', 'terminal-classes.json');
  if (fsSync.existsSync(devPath)) return devPath;
  return null;
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
  const classesFile = getClassesFile();

  // Check if the file exists before attempting to read
  if (fsSync.existsSync(classesFile)) {
    try {
      const content = await fs.readFile(classesFile, 'utf-8');
      const config: TerminalClassesConfig = JSON.parse(content);
      return NextResponse.json(config);
    } catch (err) {
      // File exists but is corrupted/malformed — don't overwrite, return empty
      console.error('Failed to parse terminal-classes.json:', err);
      return NextResponse.json({ version: '1.0', classes: [] });
    }
  }

  // File missing — try to seed from package template
  {
    const templatePath = getPackageTemplate();
    if (templatePath) {
      try {
        const templateContent = await fs.readFile(templatePath, 'utf-8');
        const config: TerminalClassesConfig = JSON.parse(templateContent);

        // Auto-seed to workspace so future reads don't need the fallback
        try {
          await fs.mkdir(path.dirname(classesFile), { recursive: true });
          await fs.writeFile(classesFile, templateContent);
        } catch {
          // Seed failed (read-only fs, etc.) — still serve the template
        }

        return NextResponse.json(config);
      } catch {
        // Template unreadable — fall through to empty
      }
    }

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

    const classesFile = getClassesFile();
    await fs.mkdir(path.dirname(classesFile), { recursive: true });
    await fs.writeFile(classesFile, JSON.stringify(config, null, 2));

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to write terminal-classes.json:', err);
    return NextResponse.json(
      { error: 'Failed to save configuration' },
      { status: 500 }
    );
  }
}
