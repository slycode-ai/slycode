/**
 * CLI Assets Updates API — /api/cli-assets/updates
 *
 * GET: Scan updates/ vs store/ and return available skill + action updates.
 * POST: Accept an update (skills: copy directory; actions: merge with class preservation).
 * DELETE: Dismiss an update version (record in .ignored-updates.json).
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  scanUpdatesFolder,
  buildUpdatesMatrix,
  getIgnoredUpdates,
  saveIgnoredUpdates,
  acceptUpdate,
} from '@/lib/asset-scanner';
import { getStoreAssets } from '@/lib/store-scanner';
import {
  scanActionUpdates,
  acceptActionUpdate,
} from '@/lib/action-scanner';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const ignoredUpdates = getIgnoredUpdates();

    // Skill updates (existing)
    const updatesAssets = scanUpdatesFolder();
    const storeAssets = getStoreAssets();
    const skillEntries = buildUpdatesMatrix(updatesAssets, storeAssets, ignoredUpdates);

    // Action updates (new)
    const actionEntries = scanActionUpdates(ignoredUpdates);

    return NextResponse.json({
      entries: skillEntries,
      actionEntries,
      totalAvailable: skillEntries.length + actionEntries.length,
    });
  } catch (error) {
    console.error('Updates scan failed:', error);
    return NextResponse.json(
      { error: 'Failed to scan updates', details: String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetType, assetName } = body;

    if (!assetType || !assetName) {
      return NextResponse.json(
        { error: 'assetType and assetName are required' },
        { status: 400 },
      );
    }

    if (assetType === 'action') {
      const backupPath = acceptActionUpdate(assetName);
      return NextResponse.json({ success: true, backedUp: backupPath });
    }

    // Existing skill/agent accept flow
    const backupPath = acceptUpdate(assetType, assetName);
    return NextResponse.json({ success: true, backedUp: backupPath });
  } catch (error) {
    console.error('Update accept failed:', error);
    return NextResponse.json(
      { error: 'Failed to accept update', details: String(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { assetType, assetName, contentHash } = body;

    // Both actions and skills use contentHash for dismiss
    if (!assetType || !assetName || !contentHash) {
      return NextResponse.json(
        { error: 'assetType, assetName, and contentHash are required' },
        { status: 400 },
      );
    }

    const dismissValue = contentHash;

    // Build the ignore key based on type
    let ignoreKey: string;
    if (assetType === 'action') {
      ignoreKey = `actions/${assetName}`;
    } else {
      const typeDir = assetType === 'skill' ? 'skills' : 'agents';
      ignoreKey = `${typeDir}/${assetName}`;
    }

    const ignored = getIgnoredUpdates();
    ignored[ignoreKey] = dismissValue;
    saveIgnoredUpdates(ignored);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Update dismiss failed:', error);
    return NextResponse.json(
      { error: 'Failed to dismiss update', details: String(error) },
      { status: 500 },
    );
  }
}
