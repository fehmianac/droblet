import { Check, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { Look } from '@/api/contracts/looks';
import { lookCoverSource } from '@/api/imageSources';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { coverPieces, type indexItems } from '@/features/looks/LookCover';
import { useTryOnAction } from '@/features/tryon/useTryOnAction';

type DayLookProps = {
  look: Look | null;
  status: 'worn' | 'planned' | 'missed';
  meta: string | null;
  itemsById: ReturnType<typeof indexItems>;
  onOpen: () => void;
  onChange: () => void;
  /** A planned day: take the look off the calendar. */
  onRemove: (() => void) | null;
  /** A past planned day nobody marked: "Bunu giydim". */
  onWore: (() => void) | null;
};

const STATUS_KEY = { worn: 'calendarScreen.statusWorn', planned: 'calendarScreen.statusPlanned', missed: 'calendarScreen.statusMissed' } as const;

/**
 * 09b the day (the sheet of a calendar day and of a weekly-plan row): the look on the user (left) and its pieces (right). The "on you" image is only ever shown, never made
 * here: without one the left tile invites, and "Üzerimde gör · 1 kredi" runs the shared try-on flow.
 */
export function DayLook({ look, status, meta, itemsById, onOpen, onChange, onRemove, onWore }: DayLookProps) {
  const { t } = useTranslation();
  const name = look?.name ?? t('calendarScreen.savedLook');
  const tryOn = useTryOnAction({ target: { kind: 'look', id: look?.id ?? '' }, title: name, feature: 'calendar_try_on', cachedJobId: null });
  const hasImage = Boolean(look?.tryOnImageUrl);
  return (
    <View className="gap-3.5" testID="calendar-day-look">
      <View className="gap-1.5">
        <Text variant="h3" numberOfLines={2}>
          {name}
        </Text>
        <View className="flex-row items-center gap-2">
          <Badge label={t(STATUS_KEY[status])} tone={status === 'worn' ? 'accent' : 'sand'} icon={status === 'worn' ? Check : undefined} />
          {meta ? (
            <Text variant="caption" tone="muted">
              {meta}
            </Text>
          ) : null}
        </View>
      </View>
      <View className="flex-row gap-2.5">
        {hasImage ? (
          <View className="h-[230px] flex-1 overflow-hidden rounded-image-lg" testID="calendar-day-onyou">
            <ImageSlot uri={look?.tryOnImageUrl} className="h-full w-full" accessibilityLabel={t('tryOn.imageA11yNamed', { name })} />
            <View className="absolute bottom-2 left-2 rounded-pill bg-cream px-2 py-0.5">
              <Text variant="badge">{t('aiBadge.onYou')}</Text>
            </View>
          </View>
        ) : look && !look.inspiration ? (
          <Pressable
            onPress={tryOn.invite.onPress}
            disabled={tryOn.starting}
            accessibilityRole="button"
            accessibilityLabel={t('calendarScreen.tryOnCost')}
            testID="calendar-day-tryon"
            className="h-[230px] flex-1 items-center justify-center gap-2 rounded-image-lg bg-sand px-3 active:opacity-80"
          >
            <Icon icon={Sparkles} size={20} tone="accent" />
            <Text variant="caption" className="text-center">
              {t('calendarScreen.tryOnInvite')}
            </Text>
            <View className="h-8 justify-center rounded-pill border border-accent px-3">
              <Text variant="chip" tone="accent">
                {t('calendarScreen.tryOnCost')}
              </Text>
            </View>
          </Pressable>
        ) : null}
        <View className="h-[230px] flex-1 overflow-hidden rounded-image-lg" testID="calendar-day-pieces">
          <ImageSlot
            {...lookCoverSource(look)}
            className="h-full w-full"
            placeholder={{ kind: 'look', pieces: look ? coverPieces(look.slots, itemsById, 120) : [], seed: look?.id, figureHeight: 120, layout: 'flatlay' }}
          />
        </View>
      </View>
      {tryOn.note ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {tryOn.note}
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        {look ? (
          <View className="min-w-[45%] flex-1">
            <Button variant="secondary" label={t('calendarScreen.openLook')} onPress={onOpen} />
          </View>
        ) : null}
        <View className="min-w-[45%] flex-1">
          <Button size="md" label={t('calendarScreen.change')} onPress={onChange} testID="calendar-change" />
        </View>
      </View>
      {onWore ? <Button variant="secondary" icon={Check} label={t('calendarScreen.wore')} onPress={onWore} testID="calendar-wore" /> : null}
      {onRemove ? (
        <Pressable onPress={onRemove} accessibilityRole="button" testID="calendar-remove" className="min-h-icon-btn items-center justify-center active:opacity-70">
          <Text variant="label" tone="danger">
            {t('calendarScreen.remove')}
          </Text>
        </Pressable>
      ) : null}
      {tryOn.sheet}
    </View>
  );
}
