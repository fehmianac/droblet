import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AiBadge } from '@/components/ui/AiBadge';
import { ImageSlot, type Piece } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import type { ImageRefresh } from '@/lib/images';

type Props = {
  /** Owner-only try-on image; null until one is generated. */
  uri: string | null;
  /** Stable cache key (`tryon:{id}`) and refresh of an expired URL — `tryOnImageSource(result)`. */
  cacheKey?: string | null;
  onExpired?: ImageRefresh;
  /** Size, flex and radius (the 06 card and the 08 hero draw it square-cornered, edge to edge). */
  className?: string;
  /** The look's pieces — drawn as the piece collage ("Parça kolajı", 17b) when there is no uri. */
  pieces: Piece[];
  /** Look id: ground of the standing figure when the look has no pieces at all. */
  seed?: string;
  /** Height of that standing figure. */
  silhouetteHeight: number;
  /** Label of the generated image. */
  accessibilityLabel?: string;
  /** Label of the collage that stands in for it. */
  collageLabel?: string;
  /** Where the "Parça kolajı" badge sits (default top-left). */
  badgeClassName?: string;
};

/**
 * The "SENİN ÜZERİNDE" image of 06, 08 and 17: the generated image, whole, and the AI marker bottom-left (always on —
 * AI output is marked). A screen that may have no image yet shows the invitation tile (`TryOnInvite`) beside the
 * pieces instead. Without a uri this draws the piece collage with its "Parça kolajı" badge (never an empty box), and
 * it never carries a call to action over the picture (canvas pattern "görsel üstündeki düğme").
 */
export function OnYouImage({ uri, cacheKey, onExpired, className, pieces, seed, silhouetteHeight, accessibilityLabel, collageLabel, badgeClassName = 'left-3.5 top-3.5' }: Props) {
  const { t } = useTranslation();
  return (
    <View className={`overflow-hidden ${className ?? ''}`}>
      <ImageSlot
        fit="contain"
        uri={uri}
        cacheKey={cacheKey}
        onExpired={onExpired}
        className="h-full w-full"
        accessibilityLabel={uri ? accessibilityLabel : (collageLabel ?? accessibilityLabel)}
        placeholder={{ kind: 'look', pieces, seed, figureHeight: silhouetteHeight }}
      />
      {uri ? (
        <View className="absolute bottom-2 left-2" pointerEvents="none" testID="on-you-tag">
          <AiBadge kind="onYou" />
        </View>
      ) : pieces.length > 0 ? (
        <View
          className={`absolute h-badge justify-center rounded-pill border border-line bg-paper px-2 ${badgeClassName}`}
          pointerEvents="none"
          testID="on-you-collage-badge"
        >
          <Text variant="badge" numberOfLines={1}>
            {t('stylistResult.collageBadge')}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
