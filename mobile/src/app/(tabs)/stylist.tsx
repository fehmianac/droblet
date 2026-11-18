import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Briefcase, Calendar, Cloud, LayoutGrid, Palette, ShoppingBag, Sparkles, X, type LucideIcon } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { Occasion } from '@/api/contracts';
import { STYLIST_TEXT_MAX } from '@/api/contracts/stylist';
import { extractApiError } from '@/api/errors';
import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
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
  { key: 'Trip', icon: Briefcase, href: '/trip/new' },
  { key: 'Week', icon: Calendar, href: '/plan/week' },
  { key: 'Look', icon: LayoutGrid, href: '/look/new' },
  { key: 'Palette', icon: Palette, href: '/palette' },
];

/** The hanger of the board (same glyph as the Gardırop tab), 15 pt inside the "Sadece gardırobum" badge. */
function HangerGlyph({ color }: { color: string }) {
  return (
    <Svg width={15} height={15} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Path d="M10 6.5a2 2 0 1 1 2.6 1.9c-.4.2-.6.6-.6 1V10.5" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M12 10.5 3.4 17.4c-.6.5-.3 1.6.5 1.6h16.2c.8 0 1.1-1.1.5-1.6z"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Context badge of 16: 30 high, 12 inset, Jost 500 11 — sand (weather) or outlined on the screen colour. */
function ContextBadge({ label, leading, outlined = false, trailing }: { label: string; leading?: ReactNode; outlined?: boolean; trailing?: ReactNode }) {
  return (
    <View className={`h-[30px] max-w-full flex-row items-center gap-1.5 rounded-pill px-3 ${outlined ? 'border border-line' : 'bg-sand'}`}>
      {leading}
      <Text variant="badge" numberOfLines={1} className="shrink">
        {label}
      </Text>
      {trailing}
    </View>
  );
}

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
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Logo />
        <IconButton icon={LayoutGrid} iconSize={19} onPress={() => router.navigate('/wardrobe/looks')} accessibilityLabel={t('stylistHome.history')} />
      </View>
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-10 pt-1.5" keyboardShouldPersistTaps="handled">
        <View className="gap-1.5">
          <Text variant="eyebrow">{t('stylistHome.eyebrow')}</Text>
          <Text variant="display">{date === today ? t('stylistHome.title') : t('stylistHome.titleForDate', { date: dateLabel })}</Text>
        </View>

        <View className="flex-row items-center gap-2 rounded-[26px] border border-line bg-paper p-1 pl-4">
          <TextInput
            value={text}
            onChangeText={(v) => {
              setText(v);
              start.reset();
            }}
            accessibilityLabel={t('stylistHome.textLabel')}
            testID="stylist.text"
            placeholder={t('stylistHome.textPlaceholder')}
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            returnKeyType="send"
            onSubmitEditing={submit}
            maxLength={STYLIST_TEXT_MAX}
            maxFontSizeMultiplier={1.6}
            className="h-icon-btn flex-1 py-0 font-sans text-[15px] text-ink"
          />
          <IconButton
            icon={Sparkles}
            variant="filled"
            iconSize={19}
            onPress={submit}
            disabled={start.isStarting}
            accessibilityLabel={t('stylistHome.send')}
            testID="stylist.send"
          />
        </View>

        <View className="gap-2.5">
          <Text variant="eyebrow">{t('stylistHome.occasionEyebrow')}</Text>
          {/* Three equal columns, 8 apart, labels centred (canvas grid). */}
          <View className="gap-2">
            {[OCCASIONS.slice(0, 3), OCCASIONS.slice(3, 6)].map((row) => (
              <View key={row.join()} className="flex-row gap-2">
                {row.map((o) => (
                  <View key={o} className="flex-1">
                    <Chip
                      fill
                      label={t(`occasion.${o}`)}
                      selected={occasion === o}
                      onPress={() => {
                        setOccasion(occasion === o ? null : o);
                        start.reset();
                      }}
                    />
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>

        <View className="flex-row flex-wrap items-center gap-2">
          {weatherLabel ? (
            <View accessible accessibilityLabel={t('stylistHome.weatherA11y', { value: weatherLabel })}>
              <ContextBadge leading={<Icon icon={Cloud} size={15} />} label={weatherLabel} />
            </View>
          ) : null}
          <ContextBadge outlined label={t(`season.${seasonOf(day)}`)} />
          {date !== today ? (
            <ContextBadge outlined leading={<Icon icon={Calendar} size={15} />} label={t('stylistHome.dateBadge', { weekday: weekdayShort(day), date: dateLabel })} />
          ) : null}
          {/* On = the board ("Sadece gardırobum", hanger). Off names the other source, so the state never depends on colour. */}
          <Pressable
            onPress={() => setWardrobeOnly((v) => !v)}
            accessibilityRole="switch"
            accessibilityLabel={t('stylistHome.wardrobeOnly')}
            accessibilityState={{ checked: wardrobeOnly }}
            hitSlop={8}
            testID="wardrobe-only"
            className="active:opacity-80"
          >
            <ContextBadge
              outlined
              leading={wardrobeOnly ? <HangerGlyph color={colors.ink} /> : <Icon icon={ShoppingBag} size={15} />}
              label={t(wardrobeOnly ? 'stylistHome.wardrobeOnly' : 'stylistHome.withStore')}
            />
          </Pressable>
          {pinned ? (
            <Pressable
              onPress={() => setUnpinned(pinned.id)}
              accessibilityRole="button"
              accessibilityLabel={t('stylistHome.removePinned', { name: pinned.name })}
              hitSlop={8}
              className="max-w-full active:opacity-80"
            >
              <ContextBadge label={t('stylistHome.pinnedItem', { name: pinned.name })} trailing={<Icon icon={X} size={13} />} />
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

        <View className="flex-row flex-wrap gap-2.5">
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
                className="grow basis-[46%] gap-[18px] rounded-card border border-line bg-paper p-3.5 active:opacity-80"
              >
                <Icon icon={s.icon} size={22} />
                <View>
                  <Text variant="bodyMedium" className="text-[14.5px]">
                    {title}
                  </Text>
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
