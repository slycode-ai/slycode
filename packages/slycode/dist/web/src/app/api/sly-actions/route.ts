/**
 * Sly Actions API — /api/sly-actions
 *
 * GET: Return assembled actions config from store/actions/*.md files.
 * PUT: Write actions from config back to individual .md files.
 */

import { NextResponse } from 'next/server';
import {
  getActionsConfig,
  writeActionsFromConfig,
} from '@/lib/action-scanner';

export async function GET() {
  try {
    const config = getActionsConfig();
    return NextResponse.json(config);
  } catch (err) {
    console.error('Failed to read actions:', err);
    return NextResponse.json({
      version: '4.0',
      commands: {},
      classAssignments: {},
    });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();

    if (!body.commands || typeof body.commands !== 'object') {
      return NextResponse.json(
        { error: 'Invalid format: commands object required' },
        { status: 400 }
      );
    }

    // Intent fields ride alongside the snapshot; the snapshot alone (legacy
    // clients) diff-writes and never deletes.
    const { changedIds, deletedIds, changedClasses, ...config } = body;
    writeActionsFromConfig(config, { changedIds, deletedIds, changedClasses });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to save actions:', err);
    return NextResponse.json(
      { error: 'Failed to save configuration' },
      { status: 500 }
    );
  }
}
