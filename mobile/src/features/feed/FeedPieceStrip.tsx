import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { FeedPiece } from '@/api/contracts/feed';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';

import { pieceKindLabel } from './logic';

/** One piece of the strip: its picture and what kind of piece it is. Not a product; the strip opens nothing (the post's detail shows the pieces large). */
function PieceTile({ piece }: { piece: FeedPiece }) {
  const { t } = useTranslation();
  const label = pieceKindLabel(t, piece.category);
  return (
    <View className="h-[54px] flex-row items-center gap-2 rounded-image-lg border border-feed-line bg-cream py-1 pl-1 pr-3" accessible accessibilityLabel={label}>
      <View className="h-[46px] w-[46px] overflow-hidden rounded-thumb bg-feed-thumb">
        <ImageSlot uri={piece.imageUrl} className="h-full w-full" placeholder={{ kind: 'garment', category: piece.category, glyphSize: 22 }} />
      </View>
      <Text variant="label" className="text-[12.5px]" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * The pieces of a look on Akış (picture + kind), side by side: a member's shared look (F2) and an editor post that is
 * a photograph without products (the pieces cut out of the photograph). Nothing in it can be tapped. Sits in a
 * `px-4` card body (it bleeds to the card's edges).
 */
export function FeedPieceStrip({ postId, pieces }: { postId: string; pieces: FeedPiece[] }) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="-mx-4"
      contentContainerClassName="gap-2 px-4"
      accessibilityLabel={t('homeFeed.piecesA11y')}
      testID={`feed.post.${postId}.pieces`}
    >
      {pieces.map((piece, index) => (
        <PieceTile key={`${piece.category}-${index}`} piece={piece} />
      ))}
    </ScrollView>
  );
}
