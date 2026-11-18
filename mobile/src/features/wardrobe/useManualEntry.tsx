import { router } from 'expo-router';
import { useState } from 'react';

import { RecognitionLimitError } from './mutations';

type Options = {
  /** `bulk` → the form returns to the bulk review list. */
  from?: 'bulk';
};

/**
 * "Elle gir" (12, 13) — a piece saved without AI, always available (owner decision 11):
 * - after a refused recognition (402 / 403) the uploaded photo is already a manual draft
 *   (`adopt(error)`) → the form opens on that draft, photo included;
 * - a photo the screen already holds (`enter(photoUri)`: the shot in the 12 frame, an unrecognised bulk
 *   photo) travels into the form and is saved with the piece (uploaded as a manual draft on save);
 * - otherwise form 12c opens empty and the piece is created without a photo (`POST v1/tenant/item`;
 *   category + colour + at least one season), shown with its category glyph.
 */
export function useManualEntry({ from }: Options = {}): {
  enter: (photoUri?: string | null) => void;
  /** Manual drafts left behind by a refused recognition are waiting for the form. */
  hasPending: boolean;
  /** Remembers the manual drafts a refused recognition left behind. Returns true for such an error. */
  adopt: (error: unknown) => boolean;
} {
  const [pending, setPending] = useState<string[]>([]);

  const openForm = (draftId?: string) =>
    router.push({ pathname: '/item/form', params: { ...(draftId ? { draftId } : {}), ...(from ? { from } : {}) } });

  return {
    enter: (photoUri) => {
      const [next, ...rest] = pending;
      if (next) {
        setPending(rest);
        openForm(next);
      } else if (photoUri) {
        router.push({ pathname: '/item/form', params: { photoUri, ...(from ? { from } : {}) } });
      } else {
        openForm();
      }
    },
    adopt: (error: unknown) => {
      if (!(error instanceof RecognitionLimitError)) return false;
      setPending(error.manualDraftIds);
      return true;
    },
    hasPending: pending.length > 0,
  };
}
