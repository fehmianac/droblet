import { router } from 'expo-router';

import { outfitPhotoParams } from './OutfitPhotoPicker';
import { usePhotoExplainerSeen } from './photoExplainer';
import { tryFirstStep } from './tryFirst';
import { usePhotoTryOn, type PhotoTryOn } from './usePhotoTryOn';

export type TryFirstPhoto = { localUri: string; width: number; height: number };

/**
 * "Önce üzerimde dene" on a photo that was just picked (12+ on Parça ekle, 16g for a shared image): the first time 16d
 * opens as the explainer (it replaces the current screen and asks for the credit from there); afterwards the
 * requirements and the credit confirmation open right here, over the photo (16d′). The result replaces the screen, and
 * its "Parçalara ayır" reuses the upload. Nothing is uploaded before the credit is confirmed.
 */
export function useTryFirstPhoto({
  feature,
  onCancel,
}: {
  feature: string;
  onCancel?: () => void;
}): PhotoTryOn & { tryOnPhoto: (photo: TryFirstPhoto) => void; ready: boolean } {
  const action = usePhotoTryOn({ feature, replace: true, onCancel });
  const seen = usePhotoExplainerSeen();
  return {
    ...action,
    ready: seen !== null,
    tryOnPhoto: (photo) => {
      if (tryFirstStep('tryOn', seen === true) === 'explainer') router.replace({ pathname: '/tryon/photo', params: outfitPhotoParams(photo) });
      else action.tryOn({ kind: 'local', uri: photo.localUri });
    },
  };
}
