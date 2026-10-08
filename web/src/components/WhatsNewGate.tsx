'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { splashAllowedOnPath, type WhatsNewEntry } from '@/lib/whats-new';
import { fetchWhatsNew, markWhatsNewSeen, previewFromSearch, WHATS_NEW_OPEN_EVENT } from '@/lib/whats-new-client';
import { WhatsNewModal } from './WhatsNewModal';
import { ChangelogModal } from './ChangelogModal';

interface OpenState {
  /** Newest first; page 0 opens. */
  pages: WhatsNewEntry[];
  /** Unseen releases on load: any dismissal marks the installed version seen. */
  marksSeen: boolean;
}

/**
 * What's new splash owner (feature #0379), mounted once in app/layout.tsx.
 *
 * - On load: pages through every release with content this install hasn't
 *   seen, newest first ("1 of 3"). One dismissal marks the installed version seen.
 * - ?whatsnew=<v> previews one release; ?whatsnew-from=<v> previews the
 *   multi-page jump from v (add &whatsnew=<b> to stop at b). Previews never write state.
 * - WHATS_NEW_OPEN_EVENT (dashboard footer) reopens on the current release,
 *   with every earlier one a page away.
 */
export default function WhatsNewGate() {
  const pathname = usePathname();
  const [open, setOpen] = useState<OpenState | null>(null);
  const [unseen, setUnseen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const preview = previewFromSearch(window.location.search);
    fetchWhatsNew(preview).then(status => {
      if (cancelled || !status) return;
      setUnseen(status.unseen);
      if (preview) {
        if (status.preview?.length) setOpen({ pages: status.preview, marksSeen: false });
      } else if (status.pages.length && splashAllowedOnPath(window.location.pathname)) {
        setOpen({ pages: status.pages, marksSeen: true });
      }
    });
    return () => { cancelled = true; };
    // Once per page load; pathname is read directly so client navigations don't re-trigger it.
  }, []);

  useEffect(() => {
    function onOpen() {
      fetchWhatsNew().then(status => {
        if (!status?.history.length) return;
        // Reopening while releases are still unseen counts as seeing them.
        setOpen({ pages: status.history, marksSeen: status.unseen });
      });
    }
    window.addEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(WHATS_NEW_OPEN_EVENT, onOpen);
  }, []);

  const markSeen = useCallback(() => {
    if (!open?.marksSeen || !unseen) return;
    setUnseen(false);
    markWhatsNewSeen();
  }, [open, unseen]);

  const close = useCallback(() => {
    markSeen();
    setOpen(null);
  }, [markSeen]);

  // Hide the splash on the single-document windows even if a client navigation lands there.
  const visible = open && (!open.marksSeen || splashAllowedOnPath(pathname));

  return (
    <>
      {visible && (
        <WhatsNewModal
          pages={open.pages}
          onClose={close}
          onCtaClick={markSeen}
          onOpenChangelog={() => { close(); setShowChangelog(true); }}
        />
      )}
      {showChangelog && <ChangelogModal onClose={() => setShowChangelog(false)} />}
    </>
  );
}
