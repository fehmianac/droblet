import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { StylistPiece } from '@/api/contracts/stylist';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { formatMoney } from '@/lib/format';

import { useAddSuggestedPieces } from './gapFill';

type Props = {
  pieces: StylistPiece[];
};

/**
 * Piece rows of a suggestion (17): 40 × 48 thumb, name over its source, a hairline under every row.
 * Wardrobe pieces end with the "Gardırobunda var" check; a missing store piece reads in espresso and
 * ends with the "Look'u tamamla" chip, which opens the product (22) as on the board.
 */
export function SuggestionPieces({ pieces }: Props) {
  const { t } = useTranslation();
  const suggested = useAddSuggestedPieces();
  return (
    <View>
      {pieces.map((piece) => {
        if (piece.source === 'library') {
          const added = suggested.isAdded(piece.refId);
          return (
            <View key={`${piece.slot}${piece.refId}`} className="flex-row items-center gap-3 border-b border-line py-[7px]" testID={`suggested-library-${piece.refId}`}>
              <ItemThumb category={piece.category} color={piece.color ?? undefined} uri={piece.imageUrl} className="h-12 w-10 rounded-[8px]" glyphSize={18} />
              <View className="flex-1" accessible accessibilityLabel={`${piece.name}, ${t('req.gapFill.library')}`}>
                <Text variant="body" numberOfLines={1}>
                  {piece.name}
                </Text>
                <Text variant="caption" tone="accent" numberOfLines={1} className="font-sans-medium">
                  {added ? t('req.gapFill.added') : t('req.gapFill.library')}
                </Text>
              </View>
              {added ? (
                <Icon icon={Check} size={18} />
              ) : (
                <Pressable
                  onPress={() => void suggested.add([piece.refId]).catch(() => undefined)}
                  disabled={suggested.isAdding}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('req.gapFill.add')}: ${piece.name}`}
                  hitSlop={{ top: 4, bottom: 4 }}
                  testID={`suggested-library-add-${piece.refId}`}
                  className="h-chip items-center justify-center rounded-pill border border-accent px-[15px] active:opacity-80"
                >
                  <Text variant="chip" tone="accent" numberOfLines={1}>
                    {t('req.gapFill.add')}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        }
        const missing = piece.source === 'store';
        const caption = !missing
          ? t('stylistResult.fromWardrobe')
          : piece.suggested
            ? t('req.gapFill.store')
            : piece.brand && piece.price !== null
            ? t('stylistResult.missingStoreBrand', { brand: piece.brand, price: formatMoney(piece.price) })
            : piece.price !== null
              ? t('stylistResult.missingStorePrice', { price: formatMoney(piece.price) })
              : t('stylistResult.missingStore');
        return (
          <View key={`${piece.slot}${piece.refId}`} className="flex-row items-center gap-3 border-b border-line py-[7px]">
            <ItemThumb category={piece.category} color={piece.color ?? undefined} uri={piece.imageUrl} className="h-12 w-10 rounded-[8px]" glyphSize={18} />
            <View
              className="flex-1"
              accessible
              accessibilityLabel={missing ? t('stylistResult.missingPieceA11y', { name: piece.name, detail: caption }) : t('stylistResult.wardrobePieceA11y', { name: piece.name })}
            >
              <Text variant="body" numberOfLines={1}>
                {piece.name}
              </Text>
              {missing ? (
                <Text variant="caption" tone="accent" numberOfLines={2} className="font-sans-medium">
                  {caption}
                </Text>
              ) : (
                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {caption}
                </Text>
              )}
            </View>
            {missing ? (
              <Pressable
                onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: piece.refId } })}
                accessibilityRole="button"
                accessibilityLabel={piece.suggested ? `${t('req.gapFill.see')}: ${piece.name}` : t('stylistResult.completeLook')}
                hitSlop={{ top: 4, bottom: 4 }}
                testID={piece.suggested ? `suggested-store-${piece.refId}` : 'complete-look'}
                className="h-chip items-center justify-center rounded-pill border border-accent px-[15px] active:opacity-80"
              >
                <Text variant="chip" tone="accent" numberOfLines={1}>
                  {piece.suggested ? t('req.gapFill.see') : t('stylistResult.completeLook')}
                </Text>
              </Pressable>
            ) : (
              <Icon icon={Check} size={18} />
            )}
          </View>
        );
      })}
    </View>
  );
}
