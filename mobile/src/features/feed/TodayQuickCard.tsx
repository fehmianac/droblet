import { Check, ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { TodayLook } from '@/api/contracts';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { toDisplayUpper } from '@/lib/upper';

type Props = {
  look: TodayLook;
  onOpen: () => void;
  onWear: () => void;
};

/**
 * "Bugünün kombini" on Akış (canvas 06″ · bugünün kombini satırı): since Bugün left the first tab, today's planned
 * look stays one tap from "Bunu giyiyorum" — the action the product is measured by. A calm paper row: the look's
 * picture, eyebrow, name, and the wear button; once worn the button turns into the quiet "Giyildi" mark. The row
 * itself opens Bugün. Shown only while today has a look.
 */
export function TodayQuickCard({ look, onOpen, onWear }: Props) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const image = look.tryOnImageUrl ?? look.pieces.find((p) => p.imageUrl)?.imageUrl ?? null;
  const eyebrow = toDisplayUpper(t('todayHome.lookEyebrow', { occasion: t(`occasion.${look.occasion}`) }), language);
  return (
    <View className="flex-row items-center gap-3 rounded-[18px] border border-line bg-paper p-2.5" testID="feed.todayCard">
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('homeFeed.todayCardA11y', { name: look.name })}
        className="flex-1 flex-row items-center gap-3 active:opacity-80"
        testID="feed.todayCard.open"
      >
        <View className="h-[64px] w-[52px] overflow-hidden rounded-[10px]" accessible={false}>
          <ImageSlot
            uri={image}
            className="h-full w-full"
            placeholder={{ kind: 'look', pieces: look.pieces.map((p) => ({ imageUrl: p.imageUrl })), seed: look.id, figureHeight: 44 }}
          />
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="eyebrow" numberOfLines={1}>
            {eyebrow}
          </Text>
          <Text variant="h3" numberOfLines={1} className="text-[20px] leading-[22px]">
            {look.name}
          </Text>
        </View>
      </Pressable>
      {look.wornToday ? (
        <View
          className="h-11 flex-row items-center gap-1.5 rounded-pill bg-sand px-3.5"
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={t('today.worn')}
          testID="feed.todayCard.worn"
        >
          <Icon icon={Check} tone="accent" size={16} />
          <Text variant="caption" tone="ink" className="font-sans-medium">
            {t('homeFeed.todayCardWorn')}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={onWear}
          accessibilityRole="button"
          accessibilityLabel={t('today.wearThis')}
          className="h-11 flex-row items-center gap-1.5 rounded-pill bg-ink px-4 active:opacity-85"
          testID="feed.todayCard.wear"
        >
          <Icon icon={Check} tone="cream" size={16} />
          <Text variant="caption" tone="cream" className="font-sans-medium">
            {t('today.wearThis')}
          </Text>
        </Pressable>
      )}
      {look.wornToday ? <Icon icon={ChevronRight} size={18} tone="muted" /> : null}
    </View>
  );
}
