/**
 * Reserved `global` quick-launch token landing page.
 *
 * Redirects to the dashboard with `?openGlobal=1`, which Dashboard reads to
 * auto-expand the global terminal panel. Keeps the user a single click away
 * from the global terminal whether they're typing the URL on a desktop or
 * tapping a phone shortcut that maps to https://t.me/<bot>?start=global.
 */

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function GlobalPage() {
  redirect('/?openGlobal=1');
}
