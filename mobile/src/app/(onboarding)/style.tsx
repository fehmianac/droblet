import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ScrollView, View } from 'react-native';

import { track } from '@/analytics/track';
import { STYLE_TAGS, type Budget, type Segment, type StyleTag } from '@/api/contracts';
import { useSaveStyleProfile, useStyleProfile } from '@/api/profile';
import { Button } from '@/components/ui/Button';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';

const REQUIRED_TAGS = 3;
const SEGMENTS: Segment[] = ['women', 'men', 'teen'];
/** Phase 1 is women only; men and teen are visible but disabled with "Yakında" (README §9.1). */
const ENABLED_SEGMENTS: Segment[] = ['women'];
const BUDGETS: Budget[] = ['high_street', 'mixed', 'luxury_touch'];

/**
 * 03 Stil profili (1/3). Works offline: the PUT goes through the persisted write queue and the
 * user continues immediately. Prefills from the server profile when one exists (returning social sign-in).
 */
export default function StyleProfileScreen() {
  const { t } = useTranslation();
  const existing = useStyleProfile();
  const save = useSaveStyleProfile();

  const [segment] = useState<Segment>('women');
  const [tags, setTags] = useState<StyleTag[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [touched, setTouched] = useState(false);

  // Prefill once from the server profile (render-time state adjustment, no effect).
  const [prefilledFrom, setPrefilledFrom] = useState<typeof existing.data>(undefined);
  if (existing.data && existing.data !== prefilledFrom && !touched) {
    setPrefilledFrom(existing.data);
    setTags(existing.data.styleTags.slice(0, REQUIRED_TAGS));
    setBudget(existing.data.budget);
  }

  const toggleTag = (tag: StyleTag) => {
    setTouched(true);
    if (tags.includes(tag)) {
      setTags(tags.filter((x) => x !== tag));
      setLimitHit(false);
      return;
    }
    if (tags.length >= REQUIRED_TAGS) {
      setLimitHit(true);
      AccessibilityInfo.announceForAccessibility(t('style.tagsLimit'));
      return;
    }
    setTags([...tags, tag]);
  };

  const complete = tags.length === REQUIRED_TAGS && budget !== null;

  const submit = () => {
    if (!complete || !budget) return;
    save.save({ segment, styleTags: tags, budget, baseVersion: existing.data?.baseVersion ?? 0 });
    track('signup_step', { step: 'style_profile' });
    router.push('/body');
  };

  return (
    <Screen>
      <OfflineBanner />
      <ScreenHeader leading="none" />
      <ScrollView contentContainerClassName="gap-8 px-gutter pb-10">
        <View className="gap-2">
          <Text variant="eyebrow">
            {t('common.eyebrowWithStep', { label: t('style.eyebrow'), step: t('common.stepOf', { current: 1, total: 3 }) })}
          </Text>
          <Text variant="display">{t('style.title')}</Text>
          <Text variant="body" tone="muted">
            {t('style.body')}
          </Text>
        </View>

        <View className="gap-3">
          <Text variant="h3">{t('style.segmentLabel')}</Text>
          <ChipWrap>
            {SEGMENTS.map((s) => {
              const enabled = ENABLED_SEGMENTS.includes(s);
              return (
                <Chip
                  key={s}
                  label={t(`style.segment.${s}`)}
                  selected={segment === s}
                  disabled={!enabled}
                  badge={enabled ? undefined : t('common.comingSoon')}
                />
              );
            })}
          </ChipWrap>
        </View>

        <View className="gap-3">
          <View className="flex-row items-end justify-between gap-3">
            <Text variant="h3" className="flex-1">
              {t('style.tagsLabel')}
            </Text>
            <Text variant="bodyMedium" tone="accent" accessibilityLiveRegion="polite">
              {t('style.tagsCounter', { count: tags.length })}
            </Text>
          </View>
          <ChipWrap>
            {STYLE_TAGS.map((tag) => (
              <Chip key={tag} label={t(`style.tags.${tag}`)} selected={tags.includes(tag)} onPress={() => toggleTag(tag)} />
            ))}
          </ChipWrap>
          {limitHit ? (
            <Text variant="caption" tone="muted">
              {t('style.tagsLimit')}
            </Text>
          ) : null}
        </View>

        <View className="gap-3">
          <Text variant="h3">{t('style.budgetLabel')}</Text>
          <ChipWrap>
            {BUDGETS.map((b) => (
              <Chip
                key={b}
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

      <BottomActionBar>
        <Button
          label={t('common.continue')}
          onPress={submit}
          disabled={!complete}
          accessibilityHint={complete ? undefined : t('style.needTags')}
        />
      </BottomActionBar>
    </Screen>
  );
}
