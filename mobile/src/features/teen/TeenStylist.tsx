import { router } from 'expo-router';
import { Lock, Moon, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import { useTeenRules } from './store';

/**
 * Canvas 18 · 16t / 16v: the small allowance line of an approved teen under "Kombin öner" / "Haftamı planla" — "Bugün 2
 * öneri hakkın kaldı", "Bugünlük hakkın doldu · Yarın yenilenir", "Bu hafta 1 plan hakkın var". The numbers are the
 * server's (`teen.stylist`). Nothing for adults, limited teens or when the server did not send the allowance.
 */
export function TeenStylistQuotaLine({ kind, testID = 'teen.stylistQuota' }: { kind: 'outfit' | 'week'; testID?: string }) {
  const { t } = useTranslation();
  const { stylist } = useTeenRules();
  const allowance = stylist?.allowance;
  if (!stylist || !allowance) return null;
  const state = stylist[kind];
  if (state === 'unavailable') return null;
  const text =
    kind === 'outfit'
      ? state === 'limitReached'
        ? t('teen.stylist.quotaDone')
        : t('teen.stylist.quotaLeft', { count: allowance.remainingToday })
      : state === 'limitReached'
        ? t('teen.stylist.weekDone')
        : t('teen.stylist.weekLeft', { count: allowance.weekPlanRemaining });
  return (
    <View className="flex-row items-center justify-center gap-1.5" testID={`${testID}.${kind}.${state}`} accessible accessibilityLiveRegion="polite">
      <Icon icon={Sparkles} size={13} />
      <Text variant="caption" tone="muted" className="text-center">
        {text}
      </Text>
    </View>
  );
}

/**
 * Canvas 18 · 16u Stilist · günlük hak doldu — calm, no paywall and no upsell: "Bugünlük bu kadar", what happened,
 * "Yarın yenilenir", and a way to the saved looks.
 */
export function TeenStylistLimitState({ compact = false, onLeave, testID = 'teen.stylistLimit' }: { compact?: boolean; onLeave?: () => void; testID?: string }) {
  const { t } = useTranslation();
  const { stylist } = useTeenRules();
  const limit = stylist?.allowance?.dailyLimit ?? 0;
  return (
    <View className={compact ? 'items-center gap-[18px] px-2 py-4' : 'flex-1 items-center justify-center gap-[18px] px-8 pb-20'} testID={testID}>
      <View className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-sand">
        <Icon icon={Moon} size={30} />
      </View>
      <View className="items-center gap-2.5">
        <Text variant="h2" className="text-center" accessibilityRole="header">
          {t('teen.stylist.limitTitle')}
        </Text>
        <Text variant="body" tone="muted" className="text-center">
          {t('teen.stylist.limitBody', { count: limit })}
        </Text>
      </View>
      <View className="h-[30px] flex-row items-center rounded-pill bg-sand px-3">
        <Text variant="badge">{t('teen.stylist.limitReset')}</Text>
      </View>
      <View className="self-stretch">
        <Button
          variant="secondary"
          label={t('teen.stylist.limitAction')}
          onPress={() => {
            onLeave?.();
            router.navigate('/wardrobe/looks');
          }}
          testID={`${testID}.looks`}
        />
      </View>
    </View>
  );
}

/**
 * The stylist switched off for teens by the server (`teen.stylist.enabled: false` or a limit of 0): the one place for
 * "Bu özellik genç hesaplarda şimdilik açık değil."
 */
export function TeenStylistUnavailable({ testID = 'teen.stylistUnavailable' }: { testID?: string }) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 items-center justify-center gap-[18px] px-8 pb-20" testID={testID}>
      <View className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-sand">
        <Icon icon={Lock} size={30} />
      </View>
      <Text variant="body" tone="muted" className="text-center">
        {t('teen.unavailable')}
      </Text>
    </View>
  );
}

/**
 * Canvas 18 · 16w Bavul detayı · genç: AI packing off for teens (`tripPackLimit` 0) or this week's used — a quiet card
 * instead of the packing button; the list is packed by hand.
 */
export function TeenPackLock({
  className,
  state: forced,
  testID = 'teen.packLock',
}: {
  className?: string;
  /** The server's answer to a start (wins over the cached allowance). */
  state?: 'unavailable' | 'limitReached';
  testID?: string;
}) {
  const { t } = useTranslation();
  const { stylist } = useTeenRules();
  const state = forced ?? (stylist && stylist.pack !== 'open' ? stylist.pack : null);
  if (!state) return null;
  return (
    <View className={`flex-row items-start gap-3 rounded-card bg-sand p-4 ${className ?? ''}`} testID={`${testID}.${state}`} accessibilityLiveRegion="polite">
      <Icon icon={Lock} size={18} />
      <Text variant="body" className="flex-1 text-[14px] leading-[20px]">
        {state === 'limitReached' ? t('teen.stylist.packDone') : t('teen.stylist.packOff')}
      </Text>
    </View>
  );
}
