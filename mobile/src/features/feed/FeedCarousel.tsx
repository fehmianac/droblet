import { ShoppingBag } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

import type { FeedPost } from '@/api/contracts/feed';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot, type Piece } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { Zoomable, type ViewerImage } from '@/components/ui/viewer';
import { refreshImageQueries, type ImageSource } from '@/lib/images';

import { feedKeys } from './queries';

/** What the placeholder figure wears: the products; on a photograph without products (and a member's look), its pieces. */
export function feedLookPieces(post: Pick<FeedPost, 'products' | 'pieces'>): Piece[] {
  return post.products.length > 0
    ? post.products.map((p) => ({ category: p.category, color: p.colors[0], imageUrl: p.imageUrl }))
    : post.pieces.map((p) => ({ category: p.category, imageUrl: p.imageUrl }));
}

/**
 * The picture source of one photograph of a post. A member's cover is a public CDN URL (owner decision 22) or, until
 * the CDN is on, a presigned one (about an hour): keyed by the post and the file so a new signature still hits the
 * cache, a new cover does not, and an expired URL re-reads the feed and the saved list once.
 */
export function feedImageSource(post: Pick<FeedPost, 'id' | 'kind'>, uri: string | null): ImageSource {
  if (post.kind !== 'user' || !uri) return { uri, cacheKey: null };
  return {
    uri,
    cacheKey: `feed-cover:${post.id}:${uri.split('?')[0]?.split('/').pop() ?? ''}`,
    onExpired: () => refreshImageQueries([feedKeys.posts, feedKeys.saved]),
  };
}

type Props = {
  post: FeedPost;
  /** Width and height of one page. */
  width: number;
  height: number;
  /** A tap on a photograph: the card opens the post's detail. */
  onPress?: () => void;
  /** Accessible name of that tap ("… detayını aç"). */
  pressLabel?: string;
  /** The detail: a tap opens the full-screen viewer on that photograph (all of the post's photographs, pageable). */
  zoom?: boolean;
  /** "Satın alınabilir · N parça" on the photo (never for a teen). */
  buyable?: boolean;
  /** Something on the photo (the compact card's try-on pill). */
  overlay?: ReactNode;
  /** The frame around the photographs (the detail's rounded, hairlined corner); the dots stay outside it. */
  frameClassName?: string;
  /** Prefix of the test ids: `feed.post.{id}` on a card, `feed.detail` on the detail. */
  testIDPrefix: string;
};

/**
 * The photographs of a post, one page each (canvas 06″): the "1 / N" counter, the buyable chip and the dots under the
 * photo. The pages swipe; a tap opens the post's detail (card) or the full-screen viewer (detail).
 */
export function FeedCarousel({ post, width, height, onPress, pressLabel, zoom = false, buyable = false, overlay, frameClassName, testIDPrefix }: Props) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const count = Math.max(1, post.images.length);
  const pieces = feedLookPieces(post);
  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  const label = (i: number) => (post.kind === 'user' ? t('homeFeed.coverA11y', { title: post.title }) : t('homeFeed.imageA11y', { title: post.title, index: i + 1, count }));
  const viewer: ViewerImage[] = zoom
    ? post.images.map((uri, i) => {
        const source = feedImageSource(post, uri);
        return { uri, cacheKey: source.cacheKey, onExpired: source.onExpired, label: label(i) };
      })
    : [];

  return (
    <View style={{ height }}>
      <View className={`h-full overflow-hidden bg-sand ${frameClassName ?? ''}`}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={count > 1}
        onMomentumScrollEnd={onScrollEnd}
        testID={`${testIDPrefix}.carousel`}
      >
        {(post.images.length > 0 ? post.images : [null]).map((uri, i) => {
          const slot = (
            <ImageSlot
              {...feedImageSource(post, uri)}
              className="h-full w-full"
              accessibilityLabel={label(i)}
              placeholder={{ kind: 'look', pieces, seed: post.kind === 'user' ? post.id : `${post.id}-${i}`, figureHeight: Math.round(height * 0.6) }}
            />
          );
          const key = `${post.id}-${i}`;
          if (zoom) {
            return (
              <Zoomable key={key} images={viewer} index={i} disabled={!uri} accessibilityLabel={label(i)} style={{ width, height }} testID={`${testIDPrefix}.photo.${i}`}>
                {slot}
              </Zoomable>
            );
          }
          if (onPress) {
            return (
              <Pressable key={key} onPress={onPress} accessibilityRole="button" accessibilityLabel={pressLabel} style={{ width, height }} testID={`${testIDPrefix}.photo.${i}`}>
                {slot}
              </Pressable>
            );
          }
          return (
            <View key={key} style={{ width, height }}>
              {slot}
            </View>
          );
        })}
      </ScrollView>
      {count > 1 ? (
        <View className="absolute right-3 top-3 h-6 justify-center rounded-pill bg-feed-counter px-[9px]" pointerEvents="none" accessible={false}>
          <Text variant="badge" tone="cream" testID={`${testIDPrefix}.counter`}>
            {t('homeFeed.imageCounter', { index: index + 1, count })}
          </Text>
        </View>
      ) : null}
      {buyable && post.products.length > 0 && post.buyableCount > 0 ? (
        <View className="absolute bottom-3 left-3 h-7 flex-row items-center gap-[5px] rounded-pill bg-feed-chip px-2.5" pointerEvents="none" testID={`${testIDPrefix}.buyable`}>
          <Icon icon={ShoppingBag} size={13} />
          <Text variant="badge" className="text-[11.5px]">
            {t('homeFeed.buyable', { count: post.buyableCount })}
          </Text>
        </View>
      ) : null}
      {overlay}
      </View>
      {count > 1 ? (
        <View className="absolute -bottom-3.5 left-0 right-0 flex-row justify-center gap-[5px]" pointerEvents="none" accessible={false}>
          {Array.from({ length: count }, (_, i) => (
            <View key={i} className={`h-1.5 w-1.5 rounded-pill ${i === index ? 'bg-ink' : 'bg-feed-dot'}`} />
          ))}
        </View>
      ) : null}
    </View>
  );
}
