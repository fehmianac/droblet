import { AI_NEUTRAL_TONES, AiProgressLines, AiSwatchReveal, toneColor } from '@/components/ui/ai';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Camera, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { Palette, PaletteTone } from '@/api/contracts/account';
import { useEnqueuePhotoUpload } from '@/api/photos';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAnalyzePalette } from '@/features/account/mutations';
import { isLightTone, paletteCatalogColors, toneName } from '@/features/account/logic';
import { accountKeys, useMyPhotos, usePalette, usePaletteMismatch } from '@/features/account/queries';
import { CanvasGlyph } from '@/features/account/rows';
import { useAiGate } from '@/features/credits/useAiGate';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { currentLanguage } from '@/i18n';
import { formatPercent } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { mutationKeys } from '@/sync/queryKeys';

type ReadyPalette = Extract<Palette, { status: 'ready' }>;

function PaletteSkeleton() {
  return (
    <View className="gap-4 px-gutter pt-1">
      <View className="flex-row items-center gap-3.5">
        <Skeleton className="h-[110px] w-[88px] rounded-image-lg" />
        <Skeleton className="h-16 flex-1 rounded-field" />
      </View>
      <View className="flex-row flex-wrap gap-2.5">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-[22%] rounded-field" />
        ))}
      </View>
      <Skeleton className="h-16 w-full rounded-card" />
    </View>
  );
}

/**
 * One tone. The colour is analysis data from the server, not a design token; tones close to the paper
 * surface get the hairline the canvas draws around "Krem".
 */
function ToneBlock({ tone, className }: { tone: PaletteTone; className: string }) {
  return <View className={`${className} ${isLightTone(tone.hex) ? 'border border-line' : ''}`} style={{ backgroundColor: tone.hex }} />;
}

function ReadyView({ palette, faceUrl }: { palette: ReadyPalette; faceUrl: string | null }) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const [mismatchOpen, setMismatchOpen] = useState(false);
  const mismatch = usePaletteMismatch(mismatchOpen);
  const colors = paletteCatalogColors(palette.tones);
  const match =
    palette.wardrobeMatchPercent !== null
      ? t('palette.match', {
          percent: suffixed(palette.wardrobeMatchPercent, 'possessive', language, formatPercent(palette.wardrobeMatchPercent)),
        })
      : null;

  return (
    <>
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-10 pt-1">
        <View className="flex-row items-center gap-3.5">
          <ImageSlot uri={faceUrl} className="h-[110px] w-[88px] rounded-image-lg" placeholder={{ kind: 'figure', tone: 'stage', figureHeight: 68 }} />
          <View className="flex-1 gap-1">
            <Text variant="eyebrow">{t('palette.seasonEyebrow')}</Text>
            <Text variant="display" accessibilityRole="header">
              {t(`palette.season.${palette.seasonType}`)}
            </Text>
            <Text variant="caption" tone="muted">
              {t('palette.aiNote')}
            </Text>
          </View>
        </View>

        <Text variant="eyebrow">{t('palette.tonesEyebrow')}</Text>
        <View className="flex-row flex-wrap justify-between gap-y-2.5" testID="palette-tones">
          {palette.tones.map((tone) => {
            const name = toneName(tone, language);
            return (
              <View key={tone.hex} className="w-[23%] gap-1.5" accessible accessibilityRole="image" accessibilityLabel={name}>
                <ToneBlock tone={tone} className="h-16 rounded-field" />
                <Text variant="caption" numberOfLines={1} className="text-[11.5px]">
                  {name}
                </Text>
              </View>
            );
          })}
        </View>

        <Text variant="eyebrow">{t('palette.avoidEyebrow')}</Text>
        <View className="flex-row gap-2.5" testID="palette-avoid">
          {palette.avoid.map((tone) => (
            <View key={tone.hex} className="flex-1" accessible accessibilityRole="image" accessibilityLabel={toneName(tone, language)}>
              <ToneBlock tone={tone} className="h-10 rounded-thumb" />
            </View>
          ))}
        </View>

        {match ? (
          <Pressable
            onPress={() => setMismatchOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={match}
            accessibilityHint={t('palette.mismatchLink')}
            className="flex-row items-center gap-3 rounded-card border border-line bg-paper p-3.5 active:opacity-80"
          >
            <CanvasGlyph name="hanger" size={22} />
            <View className="flex-1">
              <Text variant="bodyMedium">{match}</Text>
              <Text variant="caption" tone="muted">
                {t('palette.mismatchLink')}
              </Text>
            </View>
            <Icon icon={ChevronRight} size={16} />
          </Pressable>
        ) : null}

        <Button
          label={t('palette.products')}
          onPress={() => router.push({ pathname: '/shop', params: { colors: colors.join(',') } })}
        />
      </ScrollView>

      <BottomSheet visible={mismatchOpen} onClose={() => setMismatchOpen(false)} title={t('palette.mismatchTitle')}>
        <SectionState
          query={mismatch}
          inset={false}
          errorText={t('palette.mismatchError')}
          skeleton={<Skeleton className="h-28 w-full rounded-image" />}
          isEmpty={(data) => data.items.length === 0}
          emptyText={t('palette.mismatchEmpty')}
        >
          {(data) => (
            <View className="flex-row flex-wrap gap-3">
              {data.items.map((item) => (
                <View key={item.id} className="w-24 gap-1.5">
                  <ImageSlot
                    uri={item.imageUrl}
                    className="aspect-[4/5] w-full rounded-image"
                    placeholder={{ kind: 'garment', category: item.category, color: item.color, glyphSize: 34 }}
                  />
                  <Text variant="caption" numberOfLines={2}>
                    {item.name}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </SectionState>
      </BottomSheet>
    </>
  );
}

type PromptProps = { title: string; body: string; action: string; onAction: () => void; note?: string; error?: string | null };

/**
 * The centred prompt of `PaletBos` (30 · yüz fotoğrafı yok): a dashed face oval with the camera, the
 * serif title, one paragraph, the full-width action and the privacy note. Also used for the
 * "ready to analyse" step and the failed state.
 */
function Prompt({ title, body, action, onAction, note, error }: PromptProps) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-9 pb-24">
      <View className="h-[136px] w-[110px] items-center justify-center rounded-pill border-[1.5px] border-dashed border-muted" accessible={false}>
        <Icon icon={Camera} size={34} />
      </View>
      <Text variant="h2" className="text-center" accessibilityRole="header">
        {title}
      </Text>
      <Text variant="body" tone="muted" className="text-center">
        {body}
      </Text>
      <Button label={action} onPress={onAction} className="self-stretch" />
      {error ? (
        <Text variant="caption" tone="danger" className="text-center" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : note ? (
        <Text variant="caption" tone="muted" className="text-center">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * 30 Renk paletim — the face photo, the season type, the 8 tones that suit the user (4-column blocks),
 * the tones to avoid, how much of the wardrobe matches (+ the pieces that do not) and "Paletime uygun
 * ürünler" → the store filtered by the palette's colours. Without a face photo: `PaletBos`, whose
 * action uploads the face photo right here. The analysis is a member AI feature. No bottom menu.
 */
export default function PaletteScreen() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const palette = usePalette();
  const photos = useMyPhotos();
  const analyze = useAnalyzePalette();
  const gate = useAiGate();
  const enqueueUpload = useEnqueuePhotoUpload();
  const uploading = useIsMutating({ mutationKey: mutationKeys.uploadPhoto });
  const [sourceOpen, setSourceOpen] = useState(false);
  const [queuedFace, setQueuedFace] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  // When the upload queue drains, the server's photo list is the truth again (render-time adjustment).
  const [wasUploading, setWasUploading] = useState(0);
  if (uploading !== wasUploading) {
    setWasUploading(uploading);
    if (uploading === 0 && queuedFace) void client.invalidateQueries({ queryKey: accountKeys.photos });
  }

  const picker = usePhotoPicker({
    onPicked: (list: PreparedPhoto[]) => {
      const photo = list[0];
      if (!photo) return;
      setPhotoFailed(false);
      enqueueUpload({ uploadId: photo.uploadId, kind: 'face', localUri: photo.localUri });
      setQueuedFace(true);
    },
    onError: () => setPhotoFailed(true),
  });

  const startAnalysis = () => gate('palette', analyze, { costsCredit: false });

  return (
    <Screen bottom>
      <ScreenHeader title={t('screens.palette')} leading="back" />
      <ScreenState query={palette}>
        {(data) => {
          if (data?.status === 'ready') return <ReadyView palette={data} faceUrl={photos.data?.face?.url ?? null} />;
          if (data?.status === 'pending') {
            // The shared AI wait (canvas `AiYukleniyor`): tones appearing one by one + calm progress sentences.
            return (
              <View className="gap-6 px-gutter pt-6" testID="palette-ai-wait">
                <AiSwatchReveal colors={[...AI_NEUTRAL_TONES, ...AI_NEUTRAL_TONES.slice(0, 3)].map(toneColor)} />
                <AiProgressLines lines={[t('palette.analyzing'), t('ai.paletteLines.tones'), t('ai.paletteLines.wardrobe')]} align="center" />
                <Text variant="caption" tone="muted" className="text-center">
                  {t('ai.leaveHint')}
                </Text>
              </View>
            );
          }
          if (data?.status === 'failed') {
            return <Prompt title={t('palette.analyzeTitle')} body={t('palette.failed')} action={t('common.retry')} onAction={startAnalysis} />;
          }
          // No palette yet. Without a face photo (or while that is unknown) the first step is the photo.
          if (photos.data?.face || queuedFace) {
            return (
              <Prompt
                title={t('palette.analyzeTitle')}
                body={t('palette.analyzeBody')}
                action={t('palette.analyzeAction')}
                onAction={startAnalysis}
              />
            );
          }
          if (photos.isPending) return <PaletteSkeleton />;
          return (
            <Prompt
              title={t('palette.emptyTitle')}
              body={t('palette.emptyBody')}
              action={t('palette.emptyAction')}
              onAction={() => setSourceOpen(true)}
              note={t('palette.emptyNote')}
              error={photoFailed ? t('settings.photoFailed') : null}
            />
          );
        }}
      </ScreenState>

      <BottomSheet visible={sourceOpen} onClose={() => setSourceOpen(false)} title={t('palette.photoSheetTitle')}>
        <View className="gap-2">
          <Button
            label={t('palette.takePhoto')}
            onPress={() => {
              setSourceOpen(false);
              picker.takePhoto();
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            label={t('palette.choosePhoto')}
            onPress={() => {
              setSourceOpen(false);
              picker.chooseFromLibrary(1);
            }}
          />
        </View>
      </BottomSheet>
      {picker.sheet}
    </Screen>
  );
}
