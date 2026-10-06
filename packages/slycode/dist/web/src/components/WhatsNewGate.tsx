'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { splashAllowedOnPath, type WhatsNewEntry } from '@/lib/whats-new';
import { fetchWhatsNew, markWhatsNewSeen, WHATS_NEW_OPEN_EVENT } from '@/lib/whats-new-client';
import { WhatsNewModal } from './WhatsNewModal';
import { ChangelogModal } from './ChangelogModal';

interface OpenState {
  entry: WhatsNewEntry;
  /** ?whatsnew=<version> preview: never writes seen state. */
  preview: boolean;
}

/**
 * What's new splash owner (feature #0379), mounted once in app/layout.tsx.
 *
 * - On load: shows the current release's notes if this install hasn't seen them.
 * - ?whatsnew=<version> on any page previews that entry (for authoring).
 * - WHATS_NEW_OPEN_EVENT (dashboard footer) reopens the latest notes.
 * Any dismissal of unseen notes marks them seen for the whole install.
 */
export default function WhatsNewGate() {
  const pathname = usePathname();
  const [open, setOpen] = useState<OpenState | null>(null);
  const [unseen, setUnseen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const preview = new URLSearchParams(window.location.search).get('whatsnew');
    fetchWhatsNew(preview).then(status => {
      if (cancelled || !status) return;
      setUnseen(status.unseen);
      if (preview && status.preview) setOpen({ entry: status.preview, preview: true });
      else if (status.unseen && status.latest && splashAllowedOnPath(window.location.pathname)) {
        setOpen({ entry: status.latest, preview: false });
      }
    });
    return () => { cancelled = true; };
    // Once per page load; pathname is read directly so client navigations don't re-trigger it.
  }, []);

  useEffect(() => {
    function onOpen() {
      fetchWhatsNew().then(status => {
        if (status?.latest) setOpen({ entry: status.latest, preview: false });
      });
    }
    window.addEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
  }, []);

  const markSeen = useCallback(() => {
    if (!open || open.preview || !unseen) return;
    setUnseen(false);
    markWhatsNewSeen();
  }, [open, unseen]);

  const close = useCallback(() => {
    markSeen();
    setOpen(null);
  }, [markSeen]);

  // Hide the splash on the single-document windows even if a client navigation lands there.
  const visible = open && (open.preview || splashAllowedOnPath(pathname));

  return (
    <>
      {visible && (
        <WhatsNewModal
          entry={open.entry}
          onClose={close}
          onCtaClick={markSeen}
          onOpenChangelog={() => { close(); setShowChangelog(true); }}
        />
      )}
      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </>
  );
}
