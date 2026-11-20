import { Ellipsis, Plus, Sparkles } from 'lucide-react-native';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View, type ViewInstance } from 'react-native';

import { tryOnImageSource, viewerSourceOf } from '@/api/imageSources';
import { AiFailure, AiInlineStatus } from '@/components/ui/ai';
import { Badge } from '@/components/ui/Bits';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Zoomable } from '@/components/ui/viewer';
import { Text } from '@/components/ui/Text';
import { coverPieces } from '@/features/looks/LookCover';
import { useTryOnJob } from '@/features/tryon/api';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, parseLocalDate } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';

import type { WeekRow } from './logic';

type Props = {
  row: WeekRow;
  /** Opens the ⋯ menu; `top` is where the menu should sit (window coordinates). */
  onOpenMenu: (top: number) => void;
  onSuggest: () => void;
  /** Try-on job started for this day in this session, if any. */
  tryOnJobId: string | null;
  /** Polling runs only while the screen is focused. */
  focused: boolean;
  onRetryTryOn: () => void;
};

/**
 * One day of 07 Haftalık plan, as drawn: a paper card (56 × 72 look thumbnail, "PAZARTESİ · OFİS", the look
 * name, the date and the borderless ⋯ button) or the dashed empty day (sand "+" tile, "Kombin seçilmedi", "Öner").
 */
export function WeekDayRow({ row, onOpenMenu, onSuggest, tryOnJobId, focused, onRetryTryOn }: Props) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const anchor = useRef<ViewInstance>(null);
  const date = parseLocalDate(row.date);
  const weekday = formatDate(date, { weekday: 'long' });
  const dayLabel = formatDate(date, { weekday: 'long', day: 'numeric', month: 'long' });
  const occasion = row.plan?.occasion ?? row.look?.occasion ?? null;
  const eyebrow = toDisplayUpper(
    occasion ? t('weekPlan.dayEyebrow', { weekday, occasion: t(`occasion.${occasion}`) }) : weekday,
    language,
  );
  const job = useTryOnJob(tryOnJobId, { enabled: focused });
  const tryOn = job.result?.imageUrl ? tryOnImageSource(job.result) : { uri: row.look?.tryOnImageUrl ?? null, cacheKey: null };
  const image = tryOn.uri;
  const viewer = viewerSourceOf(tryOn);

  if (!row.look) {
    return (
      <View className="flex-row items-center gap-3 rounded-card border-[1.5px] border-dashed border-line p-2.5">
        <View className="h-[72px] w-14 items-center justify-center rounded-thumb bg-sand" accessible={false}>
          <Icon icon={Plus} size={22} tone="muted" />
        </View>
        <View className="flex-1 gap-[3px]">
          <Text variant="eyebrow" numberOfLines={2}>
            {eyebrow}
          </Text>
          <Text variant="title" tone="muted" numberOfLines={1}>
            {t('weekPlan.noLook')}
          </Text>
        </View>
        <Pressable
          onPress={onSuggest}
          accessibilityRole="button"
          accessibilityLabel={t('weekPlan.suggestA11y', { day: dayLabel })}
          hitSlop={4}
          className="h-chip flex-row items-center gap-1.5 rounded-pill border border-line px-[15px] active:opacity-80"
        >
          <Icon icon={Sparkles} size={15} />
          <Text variant="chip" numberOfLines={1}>
            {t('weekPlan.suggest')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-3 rounded-card border border-line bg-paper p-2.5">
      <View className="flex-row items-center gap-3">
        <Zoomable
          images={viewer ? [{ ...viewer, label: t('tryOn.imageA11yNamed', { name: row.look.name }), ai: { tag: t('aiBadge.onYou') } }] : []}
          disabled={!image}
          accessibilityLabel={t('tryOn.imageA11yNamed', { name: row.look.name })}
          className="h-[72px] w-14 items-center justify-center overflow-hidden rounded-thumb"
          testID={`week-day-image-${row.date}`}
        >
          <ImageSlot
            fit="contain"
            {...tryOn}
            className="h-full w-full"
            placeholder={{ kind: 'look', pieces: coverPieces(row.look.slots, undefined, 45), seed: row.look.id, figureHeight: 45 }}
          />
        </Zoomable>
        <View className="flex-1 gap-[3px]">
          <Text variant="eyebrow" numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text variant="title" numberOfLines={1}>
            {row.look.name}
          </Text>
          <View className="flex-row flex-wrap items-center gap-2">
            <Text variant="caption" tone="muted">
              {formatDate(date, { day: 'numeric', month: 'long' })}
            </Text>
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
