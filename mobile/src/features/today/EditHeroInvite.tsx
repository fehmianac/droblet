import { View } from 'react-native';

import type { EditProduct } from '@/api/contracts/today';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { heroTiles, HeroPieceColumn } from '@/features/looks/HeroPieces';
import { TryOnInvite } from '@/features/tryon/TryOnInvite';
import { useTryOnAction } from '@/features/tryon/useTryOnAction';

type Props = {
  lookId: string;
  name: string;
  /** The pieces of the selected price band. */
  products: EditProduct[];
  /** Room left for the back / share / heart buttons laid over the top of the hero. */
  topInset: number;
};

/**
 * 08 hero of a look without a generated image (canvas 08 · "davet"): the 06 / 14b card inside the hero — the
 * invitation tile on the left ("Üzerimde gör · 1 kredi" or the missing step), the band's pieces stacked on the
 * right. The pieces are all from the store, so none carries "EKSİK PARÇA" here; the rows below price them.
 */
export function EditHeroInvite({ lookId, name, products, topInset }: Props) {
  const action = useTryOnAction({ target: { kind: 'edit-look', id: lookId }, title: name, feature: 'edit_try_on' });
  const { shown, more } = heroTiles(products);
  return (
    <View className="flex-1 px-gutter pb-[30px]" style={{ paddingTop: topInset }} testID={`edit-hero-invite-${lookId}`}>
      <View className="flex-1 flex-row overflow-hidden rounded-card border border-line bg-paper">
        <View className="flex-[23]">
          <TryOnInvite {...action.invite} figureHeight={84} className="h-full w-full" testID="edit-hero-invite" />
        </View>
        <HeroPieceColumn
          testID="edit-hero-pieces"
          more={more}
          pieces={shown.map((p) => ({
            key: p.id,
            missing: false,
            content: (
              <ImageSlot
                uri={p.imageUrl}
                placeholder={{ kind: 'garment', category: p.category, color: p.color ?? undefined, glyphSize: 24 }}
                accessibilityLabel={p.name}
                className="h-full w-full"
              />
            ),
          }))}
        />
      </View>
      {action.note ? (
        <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" className="pt-1">
          {action.note}
        </Text>
      ) : null}
      {action.sheet}
    </View>
  );
}
