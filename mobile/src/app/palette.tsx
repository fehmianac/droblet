import { router } from 'expo-router';
import { ChevronRight, ScanFace } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { Palette, PaletteTone } from '@/api/contracts/account';
import { Card } from '@/components/blocks/basics';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAnalyzePalette } from '@/features/account/mutations';
import { paletteCatalogColors, toneName } from '@/features/account/logic';
import { useMyPhotos, usePalette, usePaletteMismatch } from '@/features/account/queries';
import { useAiGate } from '@/features/credits/useAiGate';
import { currentLanguage } from '@/i18n';
import { formatPercent } from '@/lib/intl';
import { suffixed } from '@/lib/trSuffix';

type ReadyPalette = Extract<Palette, { status: 'ready' }>;

function PaletteSkeleton() {
  return (
    <View className="gap-5 px-gutter pt-2">
      <Skeleton className="h-24 w-full rounded-card" />
      <View className="flex-row flex-wrap gap-3">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-16 w-16 rounded-pill" />
        ))}
      </View>
      <Skeleton className="h-16 w-full rounded-card" />
    </View>
  );
}

function Swatch({ tone, size, label }: { tone: PaletteTone; size: number; label?: string }) {
  const name = toneName(tone, currentLanguage());
  return (
    <View className="w-[22%] items-center gap-1.5" accessible accessibilityRole="image" accessibilityLabel={name}>
      {/* The colour is analysis data from the server, not a design token. */}
      <View className="rounded-pill border border-line" style={{ width: size, height: size, backgroundColor: tone.hex }} />
      {label ? (
        <Text variant="caption" numberOfLines={2} className="text-center">
          {label}
        </Text>
      ) : null}
    </View>
  );
}

function ReadyView({ palette }: { palette: ReadyPalette }) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const [mismatchOpen, setMismatchOpen] = useState(false);
  const mismatch = usePaletteMismatch(mismatchOpen);
  const colors = paletteCatalogColors(palette.tones);

  return (
    <>
      <ScrollView contentContainerClassName="gap-5 px-gutter pb-10 pt-2">
        <View className="flex-row items-center gap-4">
          <View className="h-20 w-20 items-center justify-center rounded-pill bg-sand">
            <Icon icon={ScanFace} size={30} tone="accent" />
          </View>
          <View className="flex-1 gap-1">
            <Text variant="eyebrow">{t('palette.seasonEyebrow')}</Text>
            <Text variant="display">{t(`palette.season.${palette.seasonType}`)}</Text>
            <Text variant="caption" tone="muted">
              {t('palette.aiNote')}
            </Text>
          </View>
        </View>

        <View className="gap-3">
          <Text variant="eyebrow">{t('palette.tonesEyebrow')}</Text>
          <View className="flex-row flex-wrap justify-between gap-y-4">
            {palette.tones.map((tone) => (
              <Swatch key={tone.hex} tone={tone} size={56} label={toneName(tone, language)} />
            ))}
          </View>
        </View>

        <View className="gap-3">
          <Text variant="eyebrow">{t('palette.avoidEyebrow')}</Text>
          <View className="flex-row flex-wrap justify-between gap-y-4">
            {palette.avoid.map((tone) => (
              <Swatch key={tone.hex} tone={tone} size={40} label={toneName(tone, language)} />
            ))}
          </View>
        </View>

        {palette.wardrobeMatchPercent !== null ? (
          <Pressable onPress={() => setMismatchOpen(true)} accessibilityRole="button" className="active:opacity-80">
            <Card className="flex-row items-center gap-3 p-4">
              <View className="flex-1 gap-0.5">
                <Text variant="bodyMedium">
                  {t('palette.match', {
                    percent: suffixed(palette.wardrobeMatchPercent, 'possessive', language, formatPercent(palette.wardrobeMatchPercent)),
                  })}
                </Text>
                <Text variant="caption" tone="muted">
                  {t('palette.mismatchLink')}
                </Text>
              </View>
              <Icon icon={ChevronRight} size={18} tone="muted" />
            </Card>
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
                  <PlaceholderImage uri={item.imageUrl} className="aspect-[4/5] w-full rounded-image" />
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

/** Centred prompt used by `PaletBos`, the "ready to analyse" step and the failed state. */
function Prompt({ title, body, action, onAction, note }: { title: string; body: string; action: string; onAction: () => void; note?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-4 px-gutter pb-12">
      <View className="h-20 w-20 items-center justify-center rounded-pill bg-sand">
        <Icon icon={ScanFace} size={30} tone="accent" />
      </View>
      <Text variant="h2" className="text-center">
        {title}
      </Text>
      <Text variant="body" tone="muted" className="text-center">
        {body}
      </Text>
      <Button label={action} onPress={onAction} className="mt-2 self-stretch" />
      {note ? (
        <Text variant="caption" tone="muted" className="text-center">
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * 30 Renk paletim — season type, the 8 tones that suit the user, tones to avoid, how much of the
 * wardrobe matches (+ the pieces that do not) and "Paletime uygun ürünler" → the store filtered by
 * the palette's colours. Without a face photo: `PaletBos`. The analysis is a member AI feature.
 */
export default function PaletteScreen() {
  const { t } = useTranslation();
  const palette = usePalette();
  const photos = useMyPhotos();
  const analyze = useAnalyzePalette();
  const gate = useAiGate();

  const startAnalysis = () => gate('palette', analyze, { costsCredit: false });

  return (
    <Screen bottom>
      <ScreenHeader title={t('screens.palette')} leading="back" />
      <ScreenState query={palette} skeleton={<PaletteSkeleton />}>
        {(data) => {
          if (data?.status === 'ready') return <ReadyView palette={data} />;
          if (data?.status === 'pending') {
            // AI loading component — replace this skeleton with the shared "AiYukleniyor" wait when it lands.
            return (
              <View accessible accessibilityLabel={t('palette.analyzing')} accessibilityLiveRegion="polite">
                <PaletteSkeleton />
                <Text variant="caption" tone="muted" className="pt-4 text-center">
                  {t('palette.analyzing')}
                </Text>
              </View>
            );
          }
          if (data?.status === 'failed') {
            return <Prompt title={t('palette.analyzeTitle')} body={t('palette.failed')} action={t('common.retry')} onAction={startAnalysis} />;
          }
          // No palette yet. Without a face photo (or while that is unknown) the first step is the photo.
          if (photos.data?.face) {
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
              onAction={() => router.push('/settings')}
              note={t('palette.emptyNote')}
            />
          );
        }}
      </ScreenState>
    </Screen>
  );
}
