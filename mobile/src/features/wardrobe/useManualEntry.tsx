import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';

import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';

import { RecognitionLimitError, useStartItemDrafts } from './mutations';

type Options = {
  /** `bulk` → the form returns to the bulk review list. */
  from?: 'bulk';
  /** The photo could not be read or sent. */
  onError: () => void;
};

/**
 * "Elle gir" (12, 13) — a piece saved without AI. On the API a piece is always created from a photo
 * (or the library), so manual entry is a photo sent as a manual draft (`manual: true`: no AI, no
 * recognition allowance) and then form 12c with empty fields:
 * - after a refused recognition the photo is already a manual draft (`adopt(error)`) → straight to the form;
 * - a photo the screen already holds (`enter(photoUri)`: the shot in the 12 frame, an unrecognised bulk
 *   photo) travels into the form and is saved with the piece (uploaded as a manual draft on save);
 * - otherwise the user picks the photo first (API) or the form opens without one (fixtures).
 */
export function useManualEntry({ from, onError }: Options): {
  enter: (photoUri?: string | null) => void;
  /** Manual drafts left behind by a refused recognition are waiting for the form. */
  hasPending: boolean;
  /** Remembers the manual drafts a refused recognition left behind. Returns true for such an error. */
  adopt: (error: unknown) => boolean;
  busy: boolean;
  /** Permission sheets of the manual photo picker — render once in the screen. */
  sheet: ReactNode;
} {
  const startDrafts = useStartItemDrafts();
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const openForm = (draftId?: string) =>
    router.push({ pathname: '/item/form', params: { ...(draftId ? { draftId } : {}), ...(from ? { from } : {}) } });

  const onPicked = (photos: PreparedPhoto[]) => {
    const photo = photos[0];
    if (!photo) return;
    setBusy(true);
    startDrafts
      .startManual([photo.localUri])
      .then((res) => {
        const draftId = res.draftIds[0];
        if (draftId) openForm(draftId);
        else onError();
      })
      .catch(onError)
      .finally(() => setBusy(false));
  };
  const picker = usePhotoPicker({ onPicked, onError });

  return {
    enter: (photoUri) => {
      const [next, ...rest] = pending;
      if (next) {
        setPending(rest);
        openForm(next);
      } else if (photoUri) {
        router.push({ pathname: '/item/form', params: { photoUri, ...(from ? { from } : {}) } });
      } else if (startDrafts.manualNeedsPhoto) {
        picker.chooseFromLibrary(1);
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
    busy,
    sheet: picker.sheet,
  };
}
