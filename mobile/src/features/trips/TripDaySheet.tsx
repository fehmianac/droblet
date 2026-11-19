import { Bookmark, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { TripDay } from '@/api/contracts/trips';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { ImageTag } from '@/components/ui/Bits';
import { Zoomable, type ViewerImage } from '@/components/ui/viewer';
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
  const tryOnUrl = day?.look?.imageUrl ?? null;
  const dayName = day?.look?.name ?? '';
  // 13a: the day's try-on (AI, labelled) and the piece photos page together.
  const images: ViewerImage[] = [
    ...(tryOnUrl ? [{ uri: tryOnUrl, label: t('tryOn.imageA11yNamed', { name: dayName }), ai: { tag: t('aiBadge.onYou') } }] : []),
    ...pieces.filter((p) => p.imageUrl).map((p) => ({ uri: p.imageUrl ?? '', label: p.name, caption: p.name })),
  ];
  const at = (uri: string | null | undefined) => (uri ? images.findIndex((img) => img.uri === uri) : -1);
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
        {tryOnUrl ? (
          <Zoomable images={images} index={0} accessibilityLabel={t('tryOn.imageA11yNamed', { name: dayName })} className="self-start" testID="trip-day-image">
            <ImageSlot fit="contain" uri={tryOnUrl} className="h-[200px] w-[152px] rounded-image-lg">
              <ImageTag label={t('aiBadge.onYou')} className="absolute bottom-2 left-2" />
            </ImageSlot>
          </Zoomable>
        ) : null}
        <View className="flex-row flex-wrap gap-2.5" accessibilityLabel={t('tripDetail.dayPieces', { count: pieces.length })}>
          {pieces.map((item) => (
            <View key={item.id} className="w-[72px] gap-1">
              <Zoomable images={images} index={at(item.imageUrl)} disabled={at(item.imageUrl) < 0} accessibilityLabel={item.name}>
                <ItemThumb category={item.category} color={item.color} uri={item.imageUrl} className="h-[88px] w-[72px] rounded-image" glyphSize={28} accessibilityLabel={item.name} />
              </Zoomable>
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
