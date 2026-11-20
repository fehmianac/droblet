import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { showToast } from '@/components/ui/toast/store';
import { PhotoSourceSheet } from '@/features/photos/PhotoSourceSheet';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';

/** The bottom sheet's dismiss animation (the picker opens after it). */
export const SHEET_DISMISS_MS = 450;

/** Route params of 16d for a picked photo: the local file and its size (the frame keeps the photo's aspect). */
export function outfitPhotoParams(photo: Pick<PreparedPhoto, 'localUri' | 'width' | 'height'>) {
  return { uri: photo.localUri, w: String(photo.width), h: String(photo.height) };
}

/**
 * The outfit photo of "Bir kombin fotoğrafını üzerimde dene": 29h "Fotoğraf ekle" with camera and library (no consent
 * here — the photo stays on the device until the user confirms the credit; the try-on consent is asked then). The
 * picked photo is prepared like every upload (long edge 2048, JPEG re-encoded, no EXIF / location) and handed over.
 * Default: opens 16d with it (`replace` swaps the current 16d for the new photo).
 */
export function useOutfitPhotoPicker(options: { onPicked?: (photo: PreparedPhoto) => void; replace?: boolean } = {}): { open: () => void; sheet: ReactNode } {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const picked = (photo: PreparedPhoto) => {
    if (options.onPicked) options.onPicked(photo);
    else if (options.replace) router.replace({ pathname: '/tryon/photo', params: outfitPhotoParams(photo) });
    else router.push({ pathname: '/tryon/photo', params: outfitPhotoParams(photo) });
  };
  const picker = usePhotoPicker({
    onPicked: (photos) => {
      const photo = photos[0];
      if (photo) picked(photo);
    },
    onError: () => showToast({ message: t('tryOnPhoto.pickFailed'), tone: 'error' }),
  });
  const close = () => setVisible(false);
  // iOS cannot present the system picker while the sheet's modal is still dismissing: open it once the sheet is gone.
  const afterClose = (open: () => void) => {
    close();
    setTimeout(open, SHEET_DISMISS_MS);
  };
  return {
    open: () => setVisible(true),
    sheet: (
      <>
        <PhotoSourceSheet
          visible={visible}
          onClose={close}
          eyebrow={t('tryOnPhoto.sourceEyebrow')}
          title={t('tryOnPhoto.sourceTitle')}
          groups={[
            {
              id: 'outfit',
              caption: t('tryOnPhoto.sourceCaption'),
              cameraLabel: t('tryOnPhoto.sourceCamera'),
              primary: true,
              onCamera: () => afterClose(picker.takePhoto),
              onLibrary: () => afterClose(() => picker.chooseFromLibrary(1)),
            },
          ]}
        />
        {picker.sheet}
      </>
    ),
  };
}
