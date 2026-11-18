import { router } from 'expo-router';
import { CircleCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { StylistPiece } from '@/api/contracts/stylist';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { formatTry } from '@/lib/format';

type Props = {
  pieces: StylistPiece[];
  /** `{stylistJobId}:{index}` — lets the builder load the suggestion it completes. */
  suggestionId: string;
};

/** Piece rows of a suggestion: wardrobe pieces ("Gardırobun" ✓) and missing store pieces with "Look'u tamamla". */
export function SuggestionPieces({ pieces, suggestionId }: Props) {
  const { t } = useTranslation();
  return (
    <View className="gap-2.5">
      {pieces.map((piece) => {
        const missing = piece.source === 'store';
        const caption = !missing
          ? t('stylistResult.fromWardrobe')
          : piece.brand && piece.price !== null
            ? t('stylistResult.missingStoreBrand', { brand: piece.brand, price: formatTry(piece.price) })
            : piece.price !== null
              ? t('stylistResult.missingStorePrice', { price: formatTry(piece.price) })
              : t('stylistResult.missingStore');
        return (
          <View key={`${piece.slot}${piece.refId}`} className="min-h-12 flex-row items-center gap-3">
            <View className={`overflow-hidden rounded-[8px] ${missing ? 'border border-dashed border-accent' : ''}`}>
              <ItemThumb category={piece.category} color={piece.color ?? undefined} uri={piece.imageUrl} className="h-12 w-10" glyphSize={20} />
            </View>
            <View
              className="flex-1 gap-0.5"
              accessible
              accessibilityLabel={missing ? t('stylistResult.missingPieceA11y', { name: piece.name, detail: caption }) : t('stylistResult.wardrobePieceA11y', { name: piece.name })}
            >
              <Text variant="body" numberOfLines={1}>
                {piece.name}
              </Text>
              <Text variant="caption" tone={missing ? 'accent' : 'muted'} numberOfLines={1}>
                {caption}
              </Text>
            </View>
            {missing ? (
              <Pressable
                onPress={() => router.push({ pathname: '/shop/builder', params: { suggestion: suggestionId, productId: piece.refId } })}
                accessibilityRole="button"
                accessibilityLabel={t('stylistResult.completeLook')}
                hitSlop={{ top: 4, bottom: 4 }}
                className="h-chip items-center justify-center rounded-pill border border-ink px-3.5 active:opacity-80"
              >
                <Text variant="bodyMedium" numberOfLines={1}>
                  {t('stylistResult.completeLook')}
                </Text>
              </Pressable>
            ) : (
              <Icon icon={CircleCheck} size={18} tone="accent" />
            )}
          </View>
        );
      })}
    </View>
  );
}
