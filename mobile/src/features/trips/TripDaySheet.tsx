import { Bookmark, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { TripDay } from '@/api/contracts/trips';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import type { ItemsById } from '@/features/looks/LookCover';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { formatDate, parseLocalDate } from '@/lib/format';

type Props = {
  day: TripDay | null;
  itemsById: ItemsById;
  onClose: () => void;
  /** "Üzerimde gör" for this day (the caller confirms the credit first). */
  onTryOn: (day: TripDay) => void;
  /** "Look olarak kaydet" — opens the look builder with the day's pieces. */
  onSaveAsLook: (day: TripDay) => void;
};

/**
 * 19 → a trip day's look. A trip day is the packed pieces planned for that date (not a saved look), so
 * it opens here: the pieces, "Üzerimde gör" (try-on target `tripDay`) and "Look olarak kaydet".
 */
export function TripDaySheet({ day, itemsById, onClose, onTryOn, onSaveAsLook }: Props) {
  const { t } = useTranslation();
  const pieces = (day?.itemIds ?? []).flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });
  return (
    <BottomSheet
      visible={day !== null}
      onClose={onClose}
      title={day ? (day.look?.name || formatDate(parseLocalDate(day.date), { weekday: 'long', day: 'numeric', month: 'long' })) : undefined}
    >
      <View className="gap-4">
        {day?.look?.name ? (
          <Text variant="caption" tone="muted">
            {formatDate(parseLocalDate(day.date), { weekday: 'long', day: 'numeric', month: 'long' })}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-2.5" accessibilityLabel={t('tripDetail.dayPieces', { count: pieces.length })}>
          {pieces.map((item) => (
            <View key={item.id} className="w-[72px] gap-1">
              <ItemThumb category={item.category} color={item.color} uri={item.imageUrl} className="h-[88px] w-[72px] rounded-image" glyphSize={28} accessibilityLabel={item.name} />
              <Text variant="caption" numberOfLines={1}>
                {item.name}
              </Text>
            </View>
          ))}
        </View>
        <View className="gap-2">
          <Button icon={Sparkles} label={t('tripDetail.dayTryOn')} onPress={() => day && onTryOn(day)} testID="trip-day-tryon" />
          <Button variant="secondary" icon={Bookmark} label={t('tripDetail.daySaveLook')} onPress={() => day && onSaveAsLook(day)} testID="trip-day-save-look" />
        </View>
      </View>
    </BottomSheet>
  );
}
