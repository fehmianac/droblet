import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { ImageTag } from '@/components/ui/Bits';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { sharedPhotoStore, useSharedPhoto, type SharedPhoto } from '@/features/share/sharedPhoto';
import type { TryFirstChoice } from '@/features/tryon/tryFirst';
import { TryFirstOptions } from '@/features/tryon/TryFirstSheet';
import { useTryFirstPhoto } from '@/features/tryon/useTryFirstPhoto';

/** The 240-wide photo of 16g; taller photos are capped at 3:4 portrait, wider ones keep their aspect. */
const FRAME_WIDTH = 240;

function frameHeight(w: number, h: number): number {
  if (!(w > 0) || !(h > 0)) return 320;
  return Math.round(Math.min(FRAME_WIDTH * (h / w), 320));
}

/**
 * 16g "Paylaşılan fotoğraf" — Share › Droblet from another app lands here with the image (prepared in the cache by
 * `ShareIntentHost`): "Bu fotoğrafla ne yapalım?" with "Önce üzerimde dene" (highlighted) and "Parçalarına ayır".
 * - Önce üzerimde dene: 16d the first time, else the requirements + credit confirmation over this photo (16d′).
 * - Parçalarına ayır: 12 Parça ekle opens with the photo and starts recognition there.
 * Nothing is uploaded until a choice; ✕ drops the share.
 */
export default function ShareScreen() {
  const { t } = useTranslation();
  const shared = useSharedPhoto();
  // The photo stays on screen once chosen (the store is cleared so the share is not offered again).
  const [kept, setKept] = useState<SharedPhoto | null>(null);
  const photo = kept ?? shared;
  const tryFirst = useTryFirstPhoto({ feature: 'tryon_photo_share' });

  const close = () => {
    void sharedPhotoStore.clear();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const choose = (choice: TryFirstChoice) => {
    if (!photo) return;
    setKept(photo);
    void sharedPhotoStore.clear();
    if (choice === 'tryOn') {
      tryFirst.tryOnPhoto({ localUri: photo.uri, width: photo.width, height: photo.height });
      return;
    }
    router.replace({ pathname: '/item/add', params: { photo: photo.uri, w: String(photo.width), h: String(photo.height), then: 'split' } });
  };

  return (
    <Screen bottom={false}>
      <ScreenHeader title={t('shareIn.title')} leading="close" onLeadingPress={close} />
      {photo ? (
        <ScrollView contentContainerClassName="gap-4 px-gutter pb-8 pt-1" testID="share.landing">
          <View className="self-center overflow-hidden rounded-card bg-sand" style={{ width: FRAME_WIDTH, height: frameHeight(photo.width, photo.height) }}>
            <ImageSlot
              uri={photo.uri}
              className="h-full w-full"
              accessibilityLabel={t('shareIn.photoA11y')}
              placeholder={{ kind: 'look', pieces: [], seed: photo.uri, figureHeight: 180 }}
            />
            <View className="absolute bottom-3 left-3" pointerEvents="none">
              <ImageTag label={t('shareIn.tag')} />
            </View>
          </View>
          <View className="gap-1">
            <Text variant="h2" accessibilityRole="header">
              {t('shareIn.heading')}
            </Text>
            <Text variant="caption" tone="muted" className="leading-[18px]">
              {t('shareIn.privacy')}
            </Text>
          </View>
          <TryFirstOptions entry="share" onChoose={choose} disabled={!tryFirst.ready || tryFirst.busy} />
          {tryFirst.note ? (
            <Text variant="caption" tone="muted" className="text-center" accessibilityLiveRegion="polite">
              {tryFirst.note}
            </Text>
          ) : null}
        </ScrollView>
      ) : (
        <View className="gap-4 px-gutter pt-1" accessibilityLiveRegion="polite" testID="share.preparing">
          <Skeleton className="h-[320px] w-[240px] self-center rounded-card" />
          <Text variant="caption" tone="muted" className="text-center">
            {t('shareIn.preparing')}
          </Text>
        </View>
      )}
      {tryFirst.sheet}
    </Screen>
  );
}
