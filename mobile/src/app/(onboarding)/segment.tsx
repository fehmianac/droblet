import { Redirect, router } from 'expo-router';
import { Check, Lock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { AppSegment } from '@/api/contracts';
import { useStyleProfile } from '@/api/profile';
import { InfoNote } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Silhouette } from '@/components/ui/Silhouette';
import { Text } from '@/components/ui/Text';
import { appSegment } from '@/features/segment/catalog';
import { segmentStore } from '@/features/segment/store';
import { useAvailableSegments } from '@/features/segment/useAvailableSegments';

/** One of the two 236-high cards of 03a: the segment's figure, its name and a neutral line; selected = ink ring + check. */
function SegmentCard({ segment, selected, onPress }: { segment: AppSegment; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${t(`style.segment.${segment}`)}, ${t(`style.segmentStep.desc.${segment}`)}`}
      testID={`segment.option.${segment}`}
      className={`h-[236px] flex-1 items-center justify-end gap-3 rounded-card px-3 pb-4 active:opacity-80 ${
        selected ? 'border-[1.5px] border-ink bg-paper' : 'border border-line'
      }`}
    >
      <Silhouette height={120} variant={segment} />
      <View className="items-center gap-0.5">
        <Text variant="bodyMedium" className="text-[16px]">
          {t(`style.segment.${segment}`)}
        </Text>
        <Text variant="caption" tone="muted">
          {t(`style.segmentStep.desc.${segment}`)}
        </Text>
      </View>
      {selected ? (
        <View className="absolute right-2.5 top-2.5 h-[22px] w-[22px] items-center justify-center rounded-pill bg-ink">
          <Icon icon={Check} size={12} tone="cream" />
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * 03a Reyon seçimi (canvas 17) — before 03, only when the server opens more than one segment; with one
 * (phase 1, prod until the owner opens men) it hands over to 03 at once and nothing changes. No default:
 * "Devam et" waits for a choice. A returning social sign-in starts from its saved segment. The choice drives
 * 03's tags and every placeholder right away; it is saved with the style profile on 03.
 */
export default function SegmentScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const available = useAvailableSegments();
  const existing = useStyleProfile();
  const [picked, setPicked] = useState<AppSegment | null>(null);
  const saved = existing.data ? appSegment(existing.data.segment) : null;
  const selected = picked ?? saved;

  if (available.loading) return <Screen>{null}</Screen>;
  if (!available.choice) return <Redirect href="/style" />;

  const submit = () => {
    if (!selected) return;
    segmentStore.set(selected);
    router.push('/style');
  };

  return (
    <Screen>
      <View>
        <ScreenHeader />
        <View className="absolute left-[70px] right-[70px] top-0 h-12 items-center justify-center" pointerEvents="none">
          <Text variant="eyebrow">{t('style.segmentStep.eyebrow')}</Text>
        </View>
      </View>
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-6 pb-6 pt-6" testID="segment.screen">
        <View className="gap-2.5">
          <Text variant="display" accessibilityRole="header">
            {t('style.segmentStep.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t('style.segmentStep.body')}
          </Text>
        </View>
        <View className="flex-row gap-2.5" accessibilityRole="radiogroup" accessibilityLabel={t('style.segmentStep.groupLabel')}>
          {available.segments.map((s) => (
            <SegmentCard key={s} segment={s} selected={selected === s} onPress={() => setPicked(s)} />
          ))}
        </View>
        <InfoNote icon={Lock} text={t('style.segmentStep.note')} />
      </ScrollView>
      <View className="px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <Button
          testID="segment.continue"
          label={t('common.continue')}
          onPress={submit}
          disabled={!selected}
          accessibilityHint={selected ? undefined : t('style.segmentStep.needChoice')}
        />
      </View>
    </Screen>
  );
}
