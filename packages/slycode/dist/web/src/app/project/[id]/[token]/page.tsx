/**
 * Quick-launch token redirector — `/project/[id]/[token]`.
 *
 * Server component. Resolves the token against the project and redirects to the
 * canonical project URL with `?card`, `?prompt`, `?provider` query params, which
 * ProjectKanban then consumes to auto-open the card and inject the prompt.
 *
 * On miss: redirects to `/project/[id]?err=shortcut_not_found&token=<token>`.
 */

import { redirect } from 'next/navigation';
import { loadAllShortcuts, resolveToken } from '@/lib/shortcuts';

interface TokenPageProps {
  params: Promise<{ id: string; token: string }>;
}

export const dynamic = 'force-dynamic';

export default async function TokenRedirect({ params }: TokenPageProps) {
  const { id, token } = await params;

  const all = await loadAllShortcuts();
  const resolved = resolveToken(token, id, all);

  if (resolved.kind === 'global') {
    redirect('/global');
  }

  if (resolved.kind === 'project') {
    // Open the project page with the project terminal pre-expanded so
    // /project/<id>/<tag> gives a true one-tap path to the terminal.
    redirect(`/project/${encodeURIComponent(resolved.projectId)}?openTerminal=1`);
  }

  if (resolved.kind === 'card' || resolved.kind === 'shortcut') {
    const params = new URLSearchParams();
    params.set('card', resolved.cardId);
    if (resolved.kind === 'shortcut') {
      if (resolved.prompt) params.set('prompt', resolved.prompt);
      if (resolved.provider) params.set('provider', resolved.provider);
      if (resolved.preferExistingSession) params.set('preferExisting', '1');
    }
    redirect(`/project/${encodeURIComponent(id)}?${params.toString()}`);
  }

  // Miss
  const missParams = new URLSearchParams();
  missParams.set('err', 'shortcut_not_found');
  missParams.set('token', token);
  redirect(`/project/${encodeURIComponent(id)}?${missParams.toString()}`);
}
