import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { Check, Lock } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppSegment } from '@/api/contracts';
import { useStyleProfile } from '@/api/profile';
import { InfoNote } from '@/components/ui/Bits';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { appSegment } from '@/features/segment/catalog';
import { segmentStore } from '@/features/segment/store';
import { useAvailableSegments } from '@/features/segment/useAvailableSegments';
import { WELCOME_HEROES } from '@/features/welcome/heroImage';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { onPhotoTones, placeholderTones, visualTones } from '@/theme/tokens';

/** How long the tapped card shows its selected state before 03 opens (canvas n_ux2 · 11a); reduce motion advances at once. */
export const SEGMENT_ADVANCE_MS = 250;

/** The welcome photos (canvas 22b reuses them; no new image), each framed on the figure like the board. */
const CARD_PHOTOS: Record<AppSegment, { source: number; left: `${number}%` }> = {
  women: { source: WELCOME_HEROES.women, left: '44%' },
  men: { source: WELCOME_HEROES.men, left: '60%' },
};

/**
 * One of the two 300-high photo cards of 03a (canvas 22b): the segment's welcome photo, a dark fade at the bottom with the
 * serif name and a neutral line; selected = a dark ring 3 pt outside the card + a check, the other card dims slightly.
 * A tap picks the segment and moves on, so each card is a button.
 */
function SegmentCard({ segment, selected, onPress }: { segment: AppSegment; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const photo = CARD_PHOTOS[segment];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${t(`style.segment.${segment}`)}, ${t(`style.segmentStep.desc.${segment}`)}`}
      testID={`segment.option.${segment}`}
      className={`h-[300px] flex-1 active:opacity-80 ${selected ? '' : 'opacity-[0.92]'}`}
    >
      {/* The ring sits outside the clipped card (canvas `outline: 2.5px; outline-offset: 3px`). */}
      {selected ? <View className="absolute -inset-[5.5px] rounded-[23.5px] border-[2.5px] border-ink" pointerEvents="none" /> : null}
      <View className="flex-1 items-start justify-end gap-0.5 overflow-hidden rounded-tile p-4" style={{ backgroundColor: placeholderTones.dark }}>
        <Image
          source={photo.source}
          contentFit="cover"
          contentPosition={{ left: photo.left, top: '8%' }}
          style={StyleSheet.absoluteFill}
          accessible={false}
          testID={`segment.photo.${segment}`}
        />
        <LinearGradient
          colors={[onPhotoTones.groundClear, visualTones.cardShade]}
          locations={[0.45, 1]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <Text variant="h2" tone="cream" className="leading-[26px]">
          {t(`style.segment.${segment}`)}
        </Text>
        <Text variant="caption" tone="onPhoto">
          {t(`style.segmentStep.desc.${segment}`)}
        </Text>
        {selected ? (
          <View className="absolute right-2.5 top-2.5 h-6 w-6 items-center justify-center rounded-pill bg-cream">
            <Icon icon={Check} size={12} tone="ink" />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * 03a Reyon seçimi (canvas 17, photo cards 22b) — before 03, only when the server opens more than one segment; with one
 * (phase 1, prod until the owner opens men) it hands over to 03 at once and nothing changes. No default and no
 * "Devam et" (UX turu 2 · 11a): tapping a card shows it selected for ~250 ms, then 03 opens. A returning social
 * sign-in starts from its saved segment. The choice drives 03's tags and every placeholder right away; it is saved
 * with the style profile on 03.
 */
export default function SegmentScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const available = useAvailableSegments();
  const existing = useStyleProfile();
  const [picked, setPicked] = useState<AppSegment | null>(null);
  const saved = existing.data ? appSegment(existing.data.segment) : null;
  const selected = picked ?? saved;
  // The pending hand-over to 03: one at a time (a second tap during the 250 ms only moves the selection).
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (advance.current) clearTimeout(advance.current);
    },
    [],
  );

  if (available.loading) return <Screen>{null}</Screen>;
  if (!available.choice) return <Redirect href="/style" />;

  const go = () => {
    advance.current = null;
    router.push('/style');
  };

  const pick = (segment: AppSegment) => {
    setPicked(segment);
    segmentStore.set(segment);
    if (advance.current) return;
    if (reduceMotion) go();
    else advance.current = setTimeout(go, SEGMENT_ADVANCE_MS);
  };

  return (
    <Screen>
      <View>
        <ScreenHeader />
        <View className="absolute left-[70px] right-[70px] top-0 h-12 items-center justify-center" pointerEvents="none">
          <Text variant="eyebrow">{t('style.segmentStep.eyebrow')}</Text>
        </View>
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-6 px-6 pt-6"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
        testID="segment.screen"
      >
        <View className="gap-2.5">
          <Text variant="display" accessibilityRole="header">
            {t('style.segmentStep.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('style.segmentStep.body')}
          </Text>
        </View>
        <View className="flex-row gap-2.5" accessibilityLabel={t('style.segmentStep.groupLabel')}>
          {available.segments.map((s) => (
            <SegmentCard key={s} segment={s} selected={selected === s} onPress={() => pick(s)} />
          ))}
        </View>
        <InfoNote icon={Lock} text={t('style.segmentStep.note')} />
      </ScrollView>
    </Screen>
  );
}
