import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { STYLE_TAGS, type Budget, type Segment, type StyleTag } from '@/api/contracts';
import { useSaveStyleProfile, useStyleProfile } from '@/api/profile';
import { StepHeader } from '@/components/auth/StepHeader';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';

const REQUIRED_TAGS = 3;
const SEGMENTS: Segment[] = ['women', 'men', 'teen'];
/** Phase 1 is women only; men and teen are visible but disabled with "Yakında" (README §9.1). */
const ENABLED_SEGMENTS: Segment[] = ['women'];
const BUDGETS: Budget[] = ['high_street', 'mixed', 'luxury_touch'];

/** One of the three 92-high segment cards: selected = ink with a check; not yet available = paper with "Yakında". */
function SegmentCard({ label, selected, enabled, soonLabel }: { label: string; selected: boolean; enabled: boolean; soonLabel: string }) {
  return (
    <View
      accessible
      accessibilityRole="radio"
      accessibilityLabel={enabled ? label : `${label}, ${soonLabel}`}
      accessibilityState={{ checked: selected, disabled: !enabled }}
      className={`h-[92px] flex-1 items-start justify-between rounded-card border p-3 ${
        selected ? 'border-ink bg-ink' : 'border-line bg-paper'
      }`}
    >
      {selected ? (
        <Icon icon={Check} size={18} tone="cream" />
      ) : (
        <View className="h-5 justify-center rounded-pill bg-sand px-2">
          <Text variant="badge" className="text-[10.5px]" numberOfLines={1}>
            {soonLabel}
          </Text>
        </View>
      )}
      <Text variant="bodyMedium" tone={selected ? 'cream' : 'ink'} className={selected ? '' : 'opacity-55'} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

/**
 * 03 Stil profili (1/3). Works offline: the PUT goes through the persisted write queue and the
 * user continues immediately. Prefills from the server profile when one exists (returning social sign-in).
 * With three tags chosen the other tags lock until one is removed.
 */
export default function StyleProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const existing = useStyleProfile();
  const save = useSaveStyleProfile();

  const [segment] = useState<Segment>('women');
  const [tags, setTags] = useState<StyleTag[]>([]);
  const [budget, setBudget] = useState<Budget | null>(null);
  const [touched, setTouched] = useState(false);

  // Prefill once from the server profile (render-time state adjustment, no effect).
  const [prefilledFrom, setPrefilledFrom] = useState<typeof existing.data>(undefined);
  if (existing.data && existing.data !== prefilledFrom && !touched) {
    setPrefilledFrom(existing.data);
    setTags(existing.data.styleTags.slice(0, REQUIRED_TAGS));
    setBudget(existing.data.budget);
  }

  const full = tags.length >= REQUIRED_TAGS;

  const toggleTag = (tag: StyleTag) => {
    setTouched(true);
    if (tags.includes(tag)) setTags(tags.filter((x) => x !== tag));
    else if (!full) setTags([...tags, tag]);
  };

  const complete = tags.length === REQUIRED_TAGS && budget !== null;

  const submit = () => {
    if (!complete || !budget) return;
    save.save({ segment, styleTags: tags, budget, baseVersion: existing.data?.baseVersion ?? 0 });
    track('signup_step', { step: 'style_profile' });
    router.push('/consents');
  };

  return (
    <Screen>
      <StepHeader step={1} total={4} />
      <ScrollView className="flex-1" contentContainerClassName="gap-6 px-6 pb-6 pt-6">
        <View className="gap-2.5">
          <Text variant="display">{t('style.title')}</Text>
          <Text variant="body" tone="muted">
            {t('style.body')}
          </Text>
        </View>

        <View className="gap-3">
          <Text variant="eyebrow">{t('style.segmentEyebrow')}</Text>
          <View className="flex-row gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('style.segmentLabel')}>
            {SEGMENTS.map((s) => (
              <SegmentCard
                key={s}
                label={t(`style.segment.${s}`)}
                selected={segment === s}
                enabled={ENABLED_SEGMENTS.includes(s)}
                soonLabel={t('common.comingSoon')}
              />
            ))}
          </View>
        </View>

        <View className="gap-3">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="eyebrow" className="flex-1">
              {t('style.tagsEyebrow')}
            </Text>
            <View accessibilityLiveRegion="polite">
              <Badge label={t('style.tagsCounter', { count: tags.length })} />
            </View>
          </View>
          <ChipWrap>
            {STYLE_TAGS.map((tag) => {
              const on = tags.includes(tag);
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
