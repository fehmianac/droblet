import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import type { Budget, StyleTag } from '@/api/contracts';
import { useSaveStyleProfile, useStyleProfile } from '@/api/profile';
import { StepHeader } from '@/components/auth/StepHeader';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { styleTagsFor, tagsForSegment } from '@/features/segment/catalog';
import { useSegment } from '@/features/segment/store';

const REQUIRED_TAGS = 3;
const BUDGETS: Budget[] = ['high_street', 'mixed', 'luxury_touch'];

/**
 * 03 Stil profili (1/4). Works offline: the PUT goes through the persisted write queue and the
 * user continues immediately. Prefills from the server profile when one exists (returning social sign-in).
 * With three tags chosen the other tags lock until one is removed. The segment ("reyon") is chosen on 03a
 * when the server opens more than one (canvas 17); the ten tags are that segment's. "Atla" (UX turu 2 · 11b) moves on
 * without saving anything: no style profile is a valid state everywhere (GET → 404 → null), and Profil › Stil profili
 * fills it later. The three-tag + budget rule only applies to "Devam et".
 */
export default function StyleProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const existing = useStyleProfile();
  const save = useSaveStyleProfile();

  const segment = useSegment();
  const allTags = styleTagsFor(segment);
  const [tags, setTags] = useState<StyleTag[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [touched, setTouched] = useState(false);

  // Prefill once from the server profile (render-time state adjustment, no effect).
  const [prefilledFrom, setPrefilledFrom] = useState<typeof existing.data>(undefined);
  if (existing.data && existing.data !== prefilledFrom && !touched) {
    setPrefilledFrom(existing.data);
    setTags(tagsForSegment(existing.data.styleTags, segment).slice(0, REQUIRED_TAGS));
    setBudget(existing.data.budget);
  }

  // Tags of another segment (03a changed after a prefill) drop out.
  const shown = tagsForSegment(tags, segment);
  const full = shown.length >= REQUIRED_TAGS;

  const toggleTag = (tag: StyleTag) => {
    setTouched(true);
    if (shown.includes(tag)) setTags(shown.filter((x) => x !== tag));
    else if (!full) setTags([...shown, tag]);
  };

  const complete = shown.length === REQUIRED_TAGS && budget !== null;

  const submit = () => {
    if (!complete || !budget) return;
    save.save({ segment, styleTags: shown, budget, baseVersion: existing.data?.baseVersion ?? 0 });
    track('signup_step', { step: 'style_profile' });
    router.push('/consents');
  };

  const skip = () => {
    track('signup_step', { step: 'style_profile', skipped: true });
    router.push('/consents');
  };

  return (
    <Screen>
      <StepHeader step={1} total={4} onSkip={skip} skipTestID="style.skip" />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-6 pb-6 pt-6">
        <View className="gap-2.5">
          <Text variant="display">{t('style.title')}</Text>
          <Text variant="body" tone="muted">
            {t('style.body')}
          </Text>
        </View>

        <View className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="eyebrow" className="flex-1">
              {t('style.tagsEyebrow')}
            </Text>
            <View accessibilityLiveRegion="polite">
              <Badge label={t('style.tagsCounter', { count: shown.length })} />
            </View>
          </View>
          <ChipWrap testID={`style.tags.${segment}`}>
            {allTags.map((tag) => {
              const on = shown.includes(tag);
              return <Chip key={tag} testID={`style.tag.${tag}`} label={t(`style.tags.${tag}`)} selected={on} disabled={full && !on} onPress={() => toggleTag(tag)} />;
            })}
          </ChipWrap>
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {t(full ? 'style.tagsFull' : 'style.needTags')}
          </Text>
        </View>

        <View className="gap-3">
          <Text variant="eyebrow">{t('style.budgetEyebrow')}</Text>
          <ChipWrap>
            {BUDGETS.map((b) => (
              <Chip
                key={b}
                testID={`style.budget.${b}`}
                label={t(`style.budget.${b}`)}
                selected={budget === b}
                onPress={() => {
                  setTouched(true);
                  setBudget(b);
                }}
              />
            ))}
          </ChipWrap>
        </View>
      </ScrollView>

      <View className="px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <Button
          testID="style.continue"
          label={t('common.continue')}
          onPress={submit}
          disabled={!complete}
          accessibilityHint={complete ? undefined : t('style.needTags')}
        />
      </View>
    </Screen>
  );
}
