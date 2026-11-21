import { router } from 'expo-router';
import { Check, SlidersHorizontal } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { AppSegment, Budget, StyleTag } from '@/api/contracts';
import { useSaveStyleProfile, useStyleProfile } from '@/api/profile';
import { Badge, InfoNote } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/toast';
import { appSegment, styleTagsFor, tagsForSegment } from '@/features/segment/catalog';
import { segmentStore, useSegment } from '@/features/segment/store';
import { useAvailableSegments } from '@/features/segment/useAvailableSegments';

const REQUIRED_TAGS = 3;
const BUDGETS: Budget[] = ['high_street', 'mixed', 'luxury_touch'];

/** One of the two 52-high segment buttons of the board: selected = ink ring, a check before the name. */
function SegmentOption({ segment, selected, onPress }: { segment: AppSegment; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t(`style.segment.${segment}`)}
      testID={`styleProfile.segment.${segment}`}
      className={`h-[52px] flex-1 flex-row items-center justify-center gap-1.5 rounded-image-lg active:opacity-80 ${
        selected ? 'border-[1.5px] border-ink bg-paper' : 'border border-line'
      }`}
    >
      {selected ? <Icon icon={Check} size={16} /> : null}
      <Text variant="bodyMedium">{t(`style.segment.${segment}`)}</Text>
    </Pressable>
  );
}

/**
 * 28f Profil › Stil profili (canvas 17) — the segment ("reyon", only while the server opens more than one),
 * the three style tags and the budget of 03, saved together with "Kaydet". Switching the segment asks first
 * ("Öneriler ve hazır kütüphane buna göre değişir; gardırobun aynı kalır.") and clears the tags that the new
 * segment does not have; the body type of the other set is asked again by the requirements flow when needed.
 */
export default function StyleProfileScreen() {
  const { t } = useTranslation();
  const existing = useStyleProfile();
  const save = useSaveStyleProfile();
  const available = useAvailableSegments();
  const current = useSegment();

  const [draft, setDraft] = useState<{ segment: AppSegment; tags: StyleTag[]; budget: Budget | null } | null>(null);
  const [pending, setPending] = useState<AppSegment | null>(null);

  const saved = existing.data ?? null;
  const base = {
    segment: saved ? appSegment(saved.segment) : current,
    tags: saved ? tagsForSegment(saved.styleTags, appSegment(saved.segment)).slice(0, REQUIRED_TAGS) : [],
    budget: saved?.budget ?? null,
  };
  const value = draft ?? base;
  const edit = (patch: Partial<typeof value>) => setDraft({ ...value, ...patch });

  const full = value.tags.length >= REQUIRED_TAGS;
  const complete = value.tags.length === REQUIRED_TAGS && value.budget !== null;
  const changed = draft !== null;

  const toggleTag = (tag: StyleTag) => {
    if (value.tags.includes(tag)) edit({ tags: value.tags.filter((x) => x !== tag) });
    else if (!full) edit({ tags: [...value.tags, tag] });
  };

  const confirmSegment = () => {
    if (!pending) return;
    edit({ segment: pending, tags: tagsForSegment(value.tags, pending) });
    setPending(null);
  };

  const submit = () => {
    if (!complete || !value.budget) return;
    save.save({ segment: value.segment, styleTags: value.tags, budget: value.budget, baseVersion: saved?.baseVersion ?? 0 });
    segmentStore.set(value.segment);
    toast.success(t('style.styleProfile.saved'), { testID: 'toast-style-profile' });
    router.back();
  };

  const pendingName = pending ? t(`style.segment.${pending}`) : '';

  return (
    <Screen>
      <ScreenHeader title={t('style.styleProfile.title')} />
      {existing.isPending ? (
        <View className="gap-4 px-gutter pt-3">
          <Skeleton className="h-[52px] w-full rounded-image-lg" />
          <Skeleton className="h-32 w-full rounded-card" />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerClassName="gap-[22px] px-gutter pb-6 pt-3" testID="styleProfile.screen">
          {available.choice ? (
            <View className="gap-2.5" testID="styleProfile.segmentRow">
              <Text variant="eyebrow">{t('style.styleProfile.segmentEyebrow')}</Text>
              <View className="flex-row gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('style.segmentStep.groupLabel')}>
                {available.segments.map((s) => (
                  <SegmentOption key={s} segment={s} selected={value.segment === s} onPress={() => (s === value.segment ? undefined : setPending(s))} />
                ))}
              </View>
              <Text variant="caption" tone="muted">
                {t('style.styleProfile.segmentNote')}
              </Text>
            </View>
          ) : null}

          <View className="gap-3">
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="eyebrow" className="flex-1">
                {t('style.tagsEyebrow')}
              </Text>
              <View accessibilityLiveRegion="polite">
                <Badge label={t('style.tagsCounter', { count: value.tags.length })} />
              </View>
            </View>
            <ChipWrap testID={`styleProfile.tags.${value.segment}`}>
              {styleTagsFor(value.segment).map((tag) => {
                const on = value.tags.includes(tag);
                return (
                  <Chip
                    key={tag}
                    testID={`styleProfile.tag.${tag}`}
                    label={t(`style.tags.${tag}`)}
                    selected={on}
                    disabled={full && !on}
                    onPress={() => toggleTag(tag)}
                  />
                );
              })}
            </ChipWrap>
            {!full ? (
              <Text variant="caption" tone="muted">
                {t('style.needTags')}
              </Text>
            ) : null}
          </View>

          <View className="gap-3">
            <Text variant="eyebrow">{t('style.budgetEyebrow')}</Text>
            <ChipWrap>
              {BUDGETS.map((b) => (
                <Chip key={b} testID={`styleProfile.budget.${b}`} label={t(`style.budget.${b}`)} selected={value.budget === b} onPress={() => edit({ budget: b })} />
              ))}
            </ChipWrap>
          </View>
        </ScrollView>
      )}
      <BottomActionBar actionFill>
        <Button
          label={t('style.styleProfile.save')}
          onPress={submit}
          disabled={!complete || !changed}
          accessibilityHint={complete ? undefined : t('style.needTags')}
          testID="styleProfile.save"
          className="flex-1"
        />
      </BottomActionBar>

      <BottomSheet visible={pending !== null} onClose={() => setPending(null)} title={t('style.styleProfile.confirmTitle', { segment: pendingName })}>
        <View className="gap-3.5" testID="styleProfile.confirm">
          <Text variant="body">{t('style.styleProfile.confirmBody')}</Text>
          <InfoNote icon={SlidersHorizontal} text={t('style.styleProfile.confirmNote')} />
          <Button label={t('style.styleProfile.confirmGo', { segment: pendingName })} onPress={confirmSegment} testID="styleProfile.confirm.go" />
          <Button variant="secondary" label={t('style.styleProfile.confirmCancel')} onPress={() => setPending(null)} testID="styleProfile.confirm.cancel" />
        </View>
      </BottomSheet>
    </Screen>
  );
}
