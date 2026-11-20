import { File, Paths } from 'expo-file-system';
import { CircleAlert, Check, ScanSearch, Share as ShareIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, Share, View } from 'react-native';

import type { JobError } from '@/api/contracts/jobs';
import { requestTryOnImage } from '@/api/wire/tryon';
import { ImageTag } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import type { ViewerImage } from '@/components/ui/viewer/ImageViewer';
import { Zoomable } from '@/components/ui/viewer';

type ReferenceIssue = NonNullable<JobError['reference']>;

/** The outfit photo of a photo try-on in the viewer: keyed by the image, refreshed through the image when it expired. */
export function referenceViewerImage(tryOnId: string | null, uri: string | null, label: string): ViewerImage | null {
  if (!uri) return null;
  return {
    uri,
    cacheKey: tryOnId ? `tryonref:${tryOnId}` : null,
    onExpired: tryOnId ? async () => (await requestTryOnImage(tryOnId)).referenceUrl ?? null : undefined,
    preview: null,
    label,
  };
}

/**
 * 16e "Kaynak fotoğraf": the outfit photo the image was made from, a 58 × 76 thumbnail with a cream border in the image's
 * corner; a tap enlarges it (13a viewer, page 2 of the result's viewer).
 */
export function SourcePhotoThumb({ images, index, uri }: { images: ViewerImage[]; index: number; uri: string }) {
  const { t } = useTranslation();
  return (
    <View className="absolute bottom-2.5 right-2.5 items-center gap-1" testID="tryon.sourcePhoto">
      <Zoomable images={images} index={index} accessibilityLabel={t('tryOnPhoto.sourceThumbA11y')} testID="tryon.sourcePhoto.zoom">
        <View className="h-[76px] w-[58px] overflow-hidden rounded-[10px] border-2 border-paper bg-sand">
          <ImageSlot uri={uri} className="h-full w-full" placeholder={{ kind: 'look', pieces: [], seed: uri, figureHeight: 60 }} />
        </View>
      </Zoomable>
      <View className="h-5 justify-center rounded-pill bg-ink px-[7px]" pointerEvents="none">
        <Text variant="badge" tone="cream" className="text-[10.5px]">
          {t('tryOnPhoto.sourceThumb')}
        </Text>
      </View>
    </View>
  );
}

/** Downloads the private image to the cache and opens the share sheet (iOS shares the file; Android the text). */
export async function shareTryOnImage(url: string, tryOnId: string, message: string): Promise<void> {
  let fileUri = url;
  if (/^https?:/i.test(url)) {
    const target = new File(Paths.cache, `droblet-tryon-${tryOnId}.webp`);
    if (target.exists) target.delete();
    fileUri = (await File.downloadFileAsync(url, target)).uri;
  }
  await Share.share(Platform.OS === 'ios' ? { url: fileUri, message } : { message });
}

/**
 * 16e actions: "Parçalara ayır ve gardıroba ekle" (the same photo on "Parçaları seç"; hidden when there is no way to
 * get the photo back), share, "Tamam".
 */
export function PhotoResultActions({
  onSplit,
  splitting = false,
  onShare,
  sharing = false,
  onDone,
}: {
  onSplit: (() => void) | null;
  splitting?: boolean;
  onShare: (() => void) | null;
  sharing?: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <BottomActionBar actionFill>
      <View className="gap-2">
        {onSplit ? (
          <Button variant="secondary" icon={ScanSearch} label={t('tryOnPhoto.split')} onPress={onSplit} loading={splitting} testID="tryon.split" />
        ) : null}
        <View className="flex-row items-center gap-2">
          {onShare ? (
            <IconButton icon={ShareIcon} onPress={onShare} disabled={sharing} accessibilityLabel={t('tryOnPhoto.share')} testID="tryon.share" />
          ) : null}
          <View className="flex-1">
            <Button label={t('tryOn.done')} onPress={onDone} testID="tryon.done" />
          </View>
        </View>
      </View>
    </BottomActionBar>
  );
}

/**
 * 16f "Kaynak fotoğraf uygun değil": the outfit photo was refused before anything was generated (nobody, several people,
 * no clothing visible — or someone who appears to be under 18). The credit was refunded; "Başka fotoğraf seç" picks again.
 */
export function ReferenceRejected({
  issue,
  photoUri,
  onOtherPhoto,
  onClose,
}: {
  issue: ReferenceIssue;
  photoUri: string | null;
  onOtherPhoto: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const minor = issue === 'minor';
  return (
    <View className="flex-1" testID="tryon.referenceRejected">
      <ScrollView contentContainerClassName="gap-[18px] px-gutter pb-6 pt-3">
        <View className="h-[200px] w-[150px] self-center overflow-hidden rounded-[18px] bg-sand">
          {/* A refused minor's photo is not shown again. */}
          <ImageSlot uri={minor ? null : photoUri} className="h-full w-full" placeholder={{ kind: 'look', pieces: [], seed: 'rejected', figureHeight: 150 }} />
          <View className="absolute bottom-2 left-2 flex-row items-center gap-1" pointerEvents="none">
            <ImageTag label={t('tryOnPhoto.rejectedTag')} />
          </View>
        </View>
        <View className="gap-2" accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text variant="h2" accessibilityRole="header">
            {t(minor ? 'tryOnPhoto.rejectedMinorTitle' : 'tryOnPhoto.rejectedTitle')}
          </Text>
          <Text variant="body" tone="muted">
            {t(minor ? 'tryOnPhoto.rejectedMinorBody' : 'tryOnPhoto.rejectedBody')}
          </Text>
        </View>
        {minor ? null : (
          <View className="gap-2 rounded-card border border-line bg-paper px-4 py-3.5">
            {(['tipFullBody', 'tipOnePerson', 'tipClothes'] as const).map((tip) => (
              <View key={tip} className="min-h-7 flex-row items-center gap-2.5">
                <Icon icon={Check} size={16} tone="accent" />
                <Text variant="body" className="flex-1 text-[14px]">
                  {t(`tryOnPhoto.${tip}`)}
                </Text>
              </View>
            ))}
          </View>
        )}
        <View className="flex-row items-start gap-1.5">
          <Icon icon={CircleAlert} size={14} tone="muted" />
          <Text variant="caption" tone="muted" className="flex-1">
            {t('tryOnPhoto.minorNote')}
          </Text>
        </View>
      </ScrollView>
      <BottomActionBar actionFill>
        <View className="gap-1">
          <Button label={t('tryOnPhoto.otherPhoto')} onPress={onOtherPhoto} testID="tryon.referenceRejected.other" />
          <Button variant="text" label={t('common.close')} onPress={onClose} testID="tryon.referenceRejected.close" />
        </View>
      </BottomActionBar>
    </View>
  );
}
