import { router, useLocalSearchParams, type Href } from 'expo-router';
import { ArrowUp, CalendarDays, Check, CloudSun, History, Luggage, Palette, Shirt, Sparkles, X, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';

import type { Occasion } from '@/api/contracts';
import { STYLIST_TEXT_MAX } from '@/api/contracts/stylist';
import { extractApiError } from '@/api/errors';
import { Logo } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { openCreditTopUp, useAiCredits } from '@/features/credits/useAiCredits';
import { dateParamOrToday, useStartStylistOutfit, useStylistWeather, validateStylistDraft, type StylistDraft } from '@/features/stylist/api';
import { useItems } from '@/features/wardrobe/queries';
import { formatDate, formatTemperature, parseLocalDate, seasonOf, toIsoDate, weekdayShort } from '@/lib/format';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

/** Chips on the board: Ofis · Akşam yemeği · Hafta sonu · Düğün · Seyahat · Spor. */
const OCCASIONS: readonly Occasion[] = ['office', 'dinner', 'weekend', 'wedding', 'travel', 'sport'];

function isOccasion(value: string | undefined): value is Occasion {
  return Boolean(value) && (OCCASIONS as readonly string[]).includes(value ?? '');
}

type Shortcut = { key: 'Trip' | 'Week' | 'Look' | 'Palette'; icon: LucideIcon; href: Href };
const SHORTCUTS: Shortcut[] = [
  { key: 'Trip', icon: Luggage, href: '/trip/new' },
  { key: 'Week', icon: CalendarDays, href: '/plan/week' },
  { key: 'Look', icon: Shirt, href: '/look/new' },
  { key: 'Palette', icon: Palette, href: '/palette' },
];

/**
 * 16 Stilist — say where you are going (free text and/or an occasion chip), see the context the
 * stylist will use (weather, season, day, "Sadece gardırobum", a pinned piece) and ask for three
 * outfits. Suggestions are text: they never use AI credits. Route params: `itemId` ("Bununla kombin
 * yap" from 11), `date` (plan for that day), `occasion`.
 */
export default function StylistTab() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ itemId?: string; date?: string; occasion?: string }>();
  const today = toIsoDate(new Date());
  const date = dateParamOrToday(params.date);

  const online = useIsOnline();
  const credits = useAiCredits();
  const items = useItems();
  const weather = useStylistWeather(date);
  const start = useStartStylistOutfit();

  const [text, setText] = useState('');
  const [occasion, setOccasion] = useState<Occasion | null>(isOccasion(params.occasion) ? params.occasion : null);
  const [wardrobeOnly, setWardrobeOnly] = useState(true);
  const [unpinned, setUnpinned] = useState<string | null>(null);
  const [showProblem, setShowProblem] = useState(false);

  const pinned = params.itemId && params.itemId !== unpinned ? (items.data?.find((i) => i.id === params.itemId) ?? null) : null;
  const wardrobeEmpty = items.data !== undefined && items.data.length === 0;
  const notMember = !credits.isLoading && !credits.isMember;

  const draft: StylistDraft = { date, occasion, text, wardrobeOnly, itemIds: pinned ? [pinned.id] : [] };
  const problem = validateStylistDraft(draft);
  const blockedByWardrobe = wardrobeEmpty && wardrobeOnly;
  const canSubmit = online && !problem && !blockedByWardrobe;

  const submit = () => {
    if (notMember) {
      openCreditTopUp(false);
      return;
    }
    if (!canSubmit) {
      setShowProblem(true);
      return;
    }
    const title = occasion ? t(`occasion.${occasion}`) : text.trim();
    void start
      .start(draft)
      .then(({ jobId }) => router.push({ pathname: '/stylist/[jobId]', params: { jobId, title } }))
      .catch(() => undefined);
  };

  const day = parseLocalDate(date);
  const dateLabel = formatDate(day, { day: 'numeric', month: 'long' });
  const weatherLabel = weather.data
    ? weather.data.summary
      ? t('stylistHome.weather', { temperature: formatTemperature(weather.data.temperatureC), summary: weather.data.summary })
      : t('stylistHome.weatherNoSummary', { temperature: formatTemperature(weather.data.temperatureC) })
    : weather.isPending
      ? null
      : t('stylistHome.weatherUnavailable');

  const hint = !online
    ? t('stylistHome.offline')
    : notMember
      ? t('stylistHome.memberOnly')
      : start.error
        ? t(`errors.${extractApiError(start.error)}`)
        : showProblem && problem === 'text_too_short'
          ? t('stylistHome.textTooShort')
          : showProblem && problem
            ? t('stylistHome.needInput')
            : null;

  return (
    <Screen>
      <OfflineBanner />
      <ScrollView contentContainerClassName="gap-5 px-gutter pb-10" keyboardShouldPersistTaps="handled">
        <View className="h-12 flex-row items-center justify-between">
          <Logo />
          <IconButton icon={History} onPress={() => router.navigate('/wardrobe/looks')} accessibilityLabel={t('stylistHome.history')} />
        </View>

        <View className="gap-1">
          <Text variant="eyebrow">{t('stylistHome.eyebrow')}</Text>
          <Text variant="display">{date === today ? t('stylistHome.title') : t('stylistHome.titleForDate', { date: dateLabel })}</Text>
        </View>

        <View className="flex-row items-end gap-2 rounded-card border border-line bg-paper p-2 pl-4">
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              start.reset();
            }}
            accessibilityLabel={t('stylistHome.textLabel')}
            placeholder={t('stylistHome.textPlaceholder')}
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            multiline
            maxLength={STYLIST_TEXT_MAX}
            maxFontSizeMultiplier={1.6}
            className="max-h-28 min-h-icon-btn flex-1 py-2.5 font-sans text-body text-ink"
          />
          <IconButton icon={ArrowUp} variant="plain" onPress={submit} disabled={start.isStarting} accessibilityLabel={t('stylistHome.send')} />
        </View>

        <View className="gap-2.5">
          <Text variant="eyebrow">{t('stylistHome.occasionEyebrow')}</Text>
          <ChipWrap>
            {OCCASIONS.map((o) => (
              <Chip
                key={o}
                label={t(`occasion.${o}`)}
                selected={occasion === o}
                onPress={() => {
                  setOccasion(occasion === o ? null : o);
                  start.reset();
                }}
              />
            ))}
          </ChipWrap>
        </View>

        <View className="flex-row flex-wrap items-center gap-2">
          {weatherLabel ? (
            <View accessible accessibilityLabel={t('stylistHome.weatherA11y', { value: weatherLabel })}>
              <Badge icon={CloudSun} label={weatherLabel} />
            </View>
          ) : null}
          <Badge label={t(`season.${seasonOf(day)}`)} />
          {date !== today ? <Badge icon={CalendarDays} label={t('stylistHome.dateBadge', { weekday: weekdayShort(day), date: dateLabel })} /> : null}
          <Pressable
            onPress={() => setWardrobeOnly((v) => !v)}
            accessibilityRole="switch"
            accessibilityLabel={t('stylistHome.wardrobeOnly')}
            accessibilityState={{ checked: wardrobeOnly }}
            hitSlop={8}
            className={`h-7 flex-row items-center gap-1 rounded-pill border px-2.5 ${wardrobeOnly ? 'border-ink bg-ink' : 'border-line bg-paper'}`}
          >
            {wardrobeOnly ? <Icon icon={Check} size={13} tone="paper" /> : null}
            <Text variant="caption" tone={wardrobeOnly ? 'paper' : 'ink'}>
              {t('stylistHome.wardrobeOnly')}
            </Text>
          </Pressable>
          {pinned ? (
            <Pressable
              onPress={() => setUnpinned(pinned.id)}
              accessibilityRole="button"
              accessibilityLabel={t('stylistHome.removePinned', { name: pinned.name })}
              hitSlop={8}
              className="h-7 max-w-full flex-row items-center gap-1 rounded-pill bg-sand px-2.5"
            >
              <Text variant="caption" numberOfLines={1} className="shrink">
                {t('stylistHome.pinnedItem', { name: pinned.name })}
              </Text>
              <Icon icon={X} size={13} />
            </Pressable>
          ) : null}
        </View>

        {blockedByWardrobe ? (
          <View className="gap-3 rounded-card border border-dashed border-line p-4">
            <Text variant="body" tone="muted">
              {t('stylistHome.emptyWardrobe')}
            </Text>
            <Button variant="secondary" label={t('stylistHome.addItem')} onPress={() => router.push('/item/add')} />
          </View>
        ) : null}

        <View className="gap-2">
          <Button
            icon={Sparkles}
            label={t('stylistHome.submit')}
            onPress={submit}
            loading={start.isStarting}
            disabled={!online || blockedByWardrobe || (!notMember && Boolean(problem))}
            testID="stylist-submit"
          />
          {hint ? (
            <Text variant="caption" tone="muted" className="text-center" accessibilityLiveRegion="polite">
              {hint}
            </Text>
          ) : null}
        </View>

        <View className="h-px bg-line" />

        <View className="flex-row flex-wrap gap-3">
          {SHORTCUTS.map((s) => {
            const title = t(`stylistHome.shortcut${s.key}Title`);
            const body = t(`stylistHome.shortcut${s.key}Body`);
            return (
              <Pressable
                key={s.key}
                onPress={() => router.push(s.href)}
                accessibilityRole="button"
                accessibilityLabel={title}
                accessibilityHint={body}
                className="min-h-24 grow basis-[46%] gap-2 rounded-card border border-line bg-paper p-4 active:opacity-80"
              >
                <Icon icon={s.icon} />
                <View className="gap-0.5">
                  <Text variant="bodyMedium">{title}</Text>
                  <Text variant="caption" tone="muted">
                    {body}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}
