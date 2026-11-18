import { Ellipsis, Sparkles } from 'lucide-react-native';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type ViewInstance } from 'react-native';

import { AiFailure, AiInlineStatus } from '@/components/ui/ai';
import { Badge } from '@/components/ui/Bits';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Text } from '@/components/ui/Text';
import { useTryOnJob } from '@/features/tryon/api';
import { currentLanguage } from '@/i18n';
import { formatDate, parseLocalDate } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';

import type { WeekRow } from './logic';

type Props = {
  row: WeekRow;
  isToday: boolean;
  /** Opens the ⋯ menu; `top` is where the menu should sit (window coordinates). */
  onOpenMenu: (top: number) => void;
  onSuggest: () => void;
  /** Try-on job started for this day in this session, if any. */
  tryOnJobId: string | null;
  /** Polling runs only while the screen is focused. */
  focused: boolean;
  onRetryTryOn: () => void;
};

/** One day of 07 Haftalık plan: planned look with its ⋯ menu, or the empty day with "Öner". */
export function WeekDayRow({ row, isToday, onOpenMenu, onSuggest, tryOnJobId, focused, onRetryTryOn }: Props) {
  const { t } = useTranslation();
  const anchor = useRef<ViewInstance>(null);
  const date = parseLocalDate(row.date);
  const weekday = formatDate(date, { weekday: 'long' });
  const dayLabel = formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
  const occasion = row.plan?.occasion ?? row.look?.occasion ?? null;
  const eyebrow = toDisplayUpper(
    occasion ? t('weekPlan.dayEyebrow', { weekday, occasion: t(`occasion.${occasion}`) }) : weekday,
    currentLanguage(),
  );
  const job = useTryOnJob(tryOnJobId, { enabled: focused });
  const image = job.result?.imageUrl ?? row.look?.tryOnImageUrl ?? null;

  if (!row.look) {
    return (
      <View className="flex-row items-center gap-3 rounded-card border border-dashed border-line p-3">
        <View className="h-[70px] w-14 items-center justify-center rounded-image border border-dashed border-line" accessible={false} />
        <View className="flex-1 gap-0.5">
          <Text variant="eyebrow" numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text variant="body" tone="muted" numberOfLines={1}>
            {t('weekPlan.noLook')}
          </Text>
        </View>
        <Pressable
          onPress={onSuggest}
          accessibilityRole="button"
          accessibilityLabel={t('weekPlan.suggestA11y', { day: dayLabel })}
          hitSlop={4}
          className="h-chip flex-row items-center gap-1.5 rounded-pill border border-line bg-paper px-4 active:opacity-80"
        >
          <Icon icon={Sparkles} size={16} />
          <Text variant="bodyMedium" numberOfLines={1}>
            {t('weekPlan.suggest')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-3 rounded-card border border-line bg-paper p-3">
      <View className="flex-row items-center gap-3">
        <PlaceholderImage uri={image} className="h-[70px] w-14 rounded-image" />
        <View className="flex-1 gap-0.5">
          <Text variant="eyebrow" numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text variant="bodyMedium" numberOfLines={1}>
            {row.look.name}
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Text variant="caption" tone="muted">
              {formatDate(date, { day: 'numeric', month: 'long' })}
            </Text>
            {isToday ? <Badge label={t('weekPlan.todayBadge')} /> : null}
            {job.isDone ? <Badge label={t('weekPlan.tryOnReady')} tone="accent" /> : null}
          </View>
        </View>
        <View ref={anchor} collapsable={false}>
          <IconButton
            icon={Ellipsis}
            variant="plain"
            accessibilityLabel={t('weekPlan.dayOptions', { day: dayLabel })}
            onPress={() => {
              // Place the menu under the button; if the platform never answers the measurement
              // (it is asynchronous), open it at a fixed offset below the header instead.
              let opened = false;
              const open = (top: number) => {
                if (opened) return;
                opened = true;
                onOpenMenu(top);
              };
              const node = anchor.current;
              if (node && typeof node.measureInWindow === 'function') {
                node.measureInWindow((_x: number, y: number, _w: number, height: number) => open(y + height));
              }
              setTimeout(() => open(160), 60);
            }}
          />
        </View>
      </View>
      {tryOnJobId && job.isWorking ? (
        <AiInlineStatus label={t('weekPlan.tryOnRowLabel', { day: weekday })} trailing={t('ai.creditCost', { count: 1 })} />
      ) : null}
      {tryOnJobId && job.isFailed ? <AiFailure layout="inline" creditRefunded={job.creditRefunded} onRetry={onRetryTryOn} /> : null}
    </View>
  );
}
