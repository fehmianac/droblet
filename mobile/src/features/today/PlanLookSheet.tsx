import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check, ChevronRight, Sparkles, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { Occasion } from '@/api/contracts';
import type { Look } from '@/api/contracts/looks';
import type { PlanDay } from '@/api/contracts/today';
import { lookCoverSource } from '@/api/imageSources';
import { Badge } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { toast } from '@/components/ui/toast';
import { indexItems, LookCover, type ItemsById } from '@/features/looks/LookCover';
import { useLooks } from '@/features/looks/queries';
import { useRequirements } from '@/features/requirements/useRequirements';
import { cachedPlanDay, calendarToastMessage, longDay } from '@/features/stylist/suggestionActions';
import { useItems } from '@/features/wardrobe/queries';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { toDisplayUpper } from '@/lib/upper';
import { newClientMutation } from '@/sync/clientMutation';

import { usePlanDays, usePutPlanDay } from './api';

/** The occasion chips of 07c: "Tümü" plus the occasions the saved looks have, in the order they first appear. */
export function lookOccasions(looks: readonly Look[]): Occasion[] {
  return [...new Set(looks.map((l) => l.occasion))];
}

/**
 * Plans a saved look on a day with the same queued, optimistic plan-day write the stylist's "Takvime ekle" uses
 * (`usePutPlanDay`, versioned on the day's record), and the same toast: "Perşembe 19 Kasım'a eklendi" + "Gör".
 * No AI and no membership: the look is already the user's.
 */
export function usePlanLook() {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const putPlanDay = usePutPlanDay();

  const plan = (look: Look, date: string, current: PlanDay | null) => {
    const existing = current ?? cachedPlanDay(client, date);
    if (existing?.lookId === look.id) return;
    const replaced = Boolean(existing?.lookId);
    putPlanDay.mutate(
      // The day keeps its occasion; the row falls back to the look's own when the day has none.
      { date, occasion: existing?.occasion ?? null, lookId: look.id, baseVersion: existing?.baseVersion ?? 0, ...newClientMutation() },
      {
        onError: () =>
          toast.error(t('feedback.calendar.failed'), {
            action: { label: t('common.retry'), onPress: () => plan(look, date, null) },
            testID: 'toast-plan-look-failed',
          }),
      },
    );
    toast.success(calendarToastMessage(t, i18n.language, date, replaced, false), {
      action: { label: t('feedback.see'), onPress: () => router.navigate({ pathname: '/plan/week', params: { day: date } }) },
      testID: 'toast-plan-look',
    });
  };

  return { plan };
}

type Props = {
  /** The day being planned (ISO); null = closed. */
  date: string | null;
  /** The day's occasion when the screen knows it (header line); otherwise the day's plan record is read. */
  occasion?: Occasion | null;
  onClose: () => void;
  /** "Stilistten öner": the screen's current stylist path (it keeps its membership gate). */
  onSuggest: () => void;
};

/**
 * 07c "Bu güne look seç" — planning a day without AI: the day and its occasion, occasion chips, the saved looks
 * (flat-lay cover, name, occasion, pieces), "Tüm looklarım (N)", and the stylist as the outlined way out. Tapping a
 * look plans it at once (the sheet closes, the toast speaks).
 */
export function PlanLookSheet({ date, occasion = null, onClose, onSuggest }: Props) {
  return (
    <BottomSheet visible={date !== null} onClose={onClose}>
      {date ? <PlanLookBody date={date} occasion={occasion} onClose={onClose} onSuggest={onSuggest} /> : null}
    </BottomSheet>
  );
}

function PlanLookBody({ date, occasion, onClose, onSuggest }: Required<Props> & { date: string }) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const looks = useLooks();
  const items = useItems();
  const day = usePlanDays(date, date);
  const stylist = useRequirements('stylist');
  const { plan } = usePlanLook();
  const [filter, setFilter] = useState<Occasion | 'all'>('all');

  const current = day.data?.find((p) => p.date === date) ?? null;
  const dayOccasion = occasion ?? current?.occasion ?? null;
  const eyebrow = toDisplayUpper(dayOccasion ? t('planPick.eyebrow', { day: longDay(date), occasion: t(`occasion.${dayOccasion}`) }) : longDay(date), language);
  const list = looks.data ?? [];
  const occasions = lookOccasions(list);
  const shown = filter === 'all' ? list : list.filter((l) => l.occasion === filter);
  const itemsById = indexItems(items.data);
  const needsMembership = stylist.steps.some((s) => s.kind === 'premium');

  return (
    <View className="gap-3.5">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="eyebrow">{eyebrow}</Text>
          <Text variant="h2">{t('planPick.title')}</Text>
        </View>
        <IconButton icon={X} variant="plain" onPress={onClose} accessibilityLabel={t('a11y.close')} />
      </View>

      {looks.isPending ? (
        <View className="gap-2" accessibilityState={{ busy: true }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[84px] w-full rounded-card" />
          ))}
        </View>
      ) : list.length === 0 ? (
        <Text variant="body" tone="muted" testID="planPick.empty">
          {t('planPick.empty')}
        </Text>
      ) : (
        <>
          {occasions.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 py-0.5">
              <Chip label={t('planPick.filterAll')} selected={filter === 'all'} onPress={() => setFilter('all')} />
              {occasions.map((o) => (
                <Chip key={o} label={t(`occasion.${o}`)} selected={filter === o} onPress={() => setFilter(o)} />
              ))}
            </ScrollView>
          ) : null}
          <ScrollView className="max-h-[320px]" contentContainerClassName="gap-2" accessibilityLabel={t('planPick.looksA11y')}>
            {shown.map((look) => (
              <LookRow
                key={look.id}
                look={look}
                itemsById={itemsById}
                planned={current?.lookId === look.id}
                onPress={() => {
                  onClose();
                  plan(look, date, current);
                }}
              />
            ))}
          </ScrollView>
          <Pressable
            onPress={() => {
              onClose();
              router.navigate('/wardrobe/looks');
            }}
            accessibilityRole="link"
            hitSlop={8}
            className="min-h-[32px] flex-row items-center gap-1 self-start active:opacity-70"
            testID="planPick.allLooks"
          >
            <Text variant="caption">{t('planPick.allLooks', { count: list.length })}</Text>
            <Icon icon={ChevronRight} size={14} />
          </Pressable>
        </>
      )}

      <View className="gap-2">
        {/* Canvas `.btn2` 48 high with the "Üyelik" badge: the only AI path on this sheet. */}
        <Pressable
          onPress={() => {
            onClose();
            onSuggest();
          }}
          accessibilityRole="button"
          accessibilityLabel={needsMembership ? `${t('planPick.suggest')}, ${t('planPick.membership')}` : t('planPick.suggest')}
          className="h-btn-bar flex-row items-center justify-center gap-2 rounded-pill border border-ink px-5 active:opacity-80"
          testID="planPick.suggest"
        >
          <Icon icon={Sparkles} size={17} />
          <Text variant="button" numberOfLines={1} className="shrink">
            {t('planPick.suggest')}
          </Text>
          {needsMembership ? <Badge label={t('planPick.membership')} /> : null}
        </Pressable>
        {list.length > 0 ? (
          <Text variant="caption" tone="muted" className="text-center">
            {t('planPick.hint')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function LookRow({ look, itemsById, planned, onPress }: { look: Look; itemsById: ItemsById; planned: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  const occasion = t(`occasion.${look.occasion}`);
  const pieces = t('product.piecesCount', { count: look.slots.length });
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: planned }}
      accessibilityLabel={t(planned ? 'planPick.lookPlannedA11y' : 'planPick.lookA11y', { name: look.name, occasion, pieces })}
      className={`flex-row items-center gap-3 rounded-card border bg-paper py-2 pl-2 pr-2.5 active:opacity-80 ${planned ? 'border-ink' : 'border-line'}`}
      testID={`planPick.look.${look.id}`}
    >
      <LookCover
        seed={look.id}
        figureHeight={44}
        tryOnImageUrl={look.tryOnImageUrl}
        cover={look.tryOnImageUrl ? null : lookCoverSource(look)}
        slots={look.slots}
        itemsById={itemsById}
        className="h-[66px] w-[52px] rounded-thumb"
      />
      <View className="flex-1 gap-1">
        <Text variant="title" numberOfLines={1}>
          {look.name}
        </Text>
        <View className="flex-row flex-wrap items-center gap-2">
          <Badge label={occasion} />
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {pieces}
          </Text>
        </View>
      </View>
      <View
        className={`h-6 w-6 items-center justify-center rounded-pill border-[1.5px] ${planned ? 'border-ink bg-ink' : 'border-line'}`}
        accessible={false}
      >
        {planned ? <Icon icon={Check} size={12} tone="paper" /> : null}
      </View>
    </Pressable>
  );
}
