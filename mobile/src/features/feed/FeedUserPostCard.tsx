import { router } from 'expo-router';
import { Bookmark, Ellipsis, Heart, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { FeedPiece, FeedPost } from '@/api/contracts/feed';
import { ITEM_CATEGORIES, type ItemCategory } from '@/api/contracts/wardrobe';
import { toSubcategoryLabel } from '@/api/wire/subcategories';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { formatNumber } from '@/lib/format';
import { refreshImageQueries } from '@/lib/images';

import { AuthorAvatar } from './FeedBits';
import { postMeta } from './logic';
import { useLikeFeedPost, useSaveFeedPost } from './mutations';
import { feedKeys } from './queries';

type Props = {
  post: FeedPost;
  /** Teen account: no "Benzerlerini gör" (the store is closed to teens; the server sends them no member posts anyway). */
  teen: boolean;
  /** "⋯": Bunu gösterme · Şikâyet et. Without a handler the button is not drawn. */
  onMenu?: (post: FeedPost) => void;
  /** "Benzerlerini gör": the catalogue's similar products. Without a handler the button is not drawn. */
  onSimilar?: (post: FeedPost) => void;
};

/** Cover height on the board: the same 410 as an editor card. */
const COVER = 410;

/** One piece of the strip: its picture and what kind of piece it is. Not a product — it opens nothing. */
function PieceTile({ piece }: { piece: FeedPiece }) {
  const { t } = useTranslation();
  // The kind of piece in the singular ("Üst", "Ayakkabı"); a sub-type id reads by its name ("Kazak"), anything else as sent.
  const known = (ITEM_CATEGORIES as readonly string[]).includes(piece.category);
  const label = known ? t(`homeFeed.pieceKind.${piece.category as ItemCategory}`) : (toSubcategoryLabel(piece.category) ?? piece.category);
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
 * A member's look on Akış (canvas 06‴ Akış F2, decision 21): avatar and @handle (they open the profile — "Takip et"
 * lives there), "Topluluk · Hafta sonu · 1 sa", the "⋯" menu, the look's cover, its name, the piece strip (picture +
 * kind), "Benzerlerini gör" when the catalogue has something close, ♡ with the count and Kaydet. No "Üzerimde dene",
 * no buying, no buyable chip, no verified mark, no comments.
 */
export function FeedUserPostCard({ post, teen, onMenu, onSimilar }: Props) {
  const { t } = useTranslation();
  const like = useLikeFeedPost();
  const save = useSaveFeedPost();
  const author = post.author.name;
  const handle = post.author.handle;
  const likes = t('homeFeed.likes', { count: post.likeCount, formatted: formatNumber(post.likeCount) });

  const who = (
    <>
      <AuthorAvatar author={post.author} />
      <View className="min-w-0 flex-1">
        <Text variant="bodyMedium" numberOfLines={1}>
          {author}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} testID={`feed.post.${post.id}.meta`}>
          {postMeta(t, post)}
        </Text>
      </View>
    </>
  );

  return (
    <View
      className="overflow-hidden rounded-card border border-feed-line bg-paper"
      accessibilityLabel={t('homeFeed.userPostA11y', { author, title: post.title })}
      testID={`feed.post.${post.id}`}
    >
      <View className="flex-row items-center gap-2.5 py-2.5 pl-3 pr-1.5">
        {handle ? (
          <Pressable
            onPress={() => router.push({ pathname: '/u/[handle]', params: { handle } })}
            accessibilityRole="link"
            accessibilityLabel={t('homeFeed.openProfileA11y', { author })}
            testID={`feed.post.${post.id}.author`}
            className="min-h-icon-btn min-w-0 flex-1 flex-row items-center gap-2.5 active:opacity-70"
          >
            {who}
          </Pressable>
        ) : (
          <View className="min-h-icon-btn min-w-0 flex-1 flex-row items-center gap-2.5">{who}</View>
        )}
        {onMenu ? (
          <IconButton icon={Ellipsis} iconSize={20} variant="plain" onPress={() => onMenu(post)} accessibilityLabel={t('homeFeed.postMenuA11y')} testID={`feed.post.${post.id}.menu`} />
        ) : null}
      </View>

      <View style={{ height: COVER }} className="bg-sand">
        <ImageSlot
          uri={post.images[0] ?? null}
          // The cover is a public CDN URL (owner decision 22) or, until the CDN is on, a presigned one (about an hour):
          // keyed by the post and the file so a new signature still hits the cache, a new cover does not, and an
          // expired URL re-reads the feed and the saved list once.
          cacheKey={post.images[0] ? `feed-cover:${post.id}:${post.images[0].split('?')[0]?.split('/').pop() ?? ''}` : null}
          onExpired={() => refreshImageQueries([feedKeys.posts, feedKeys.saved])}
          className="h-full w-full"
          accessibilityLabel={t('homeFeed.coverA11y', { title: post.title })}
          placeholder={{ kind: 'look', pieces: post.pieces.map((p) => ({ category: p.category, imageUrl: p.imageUrl })), seed: post.id, figureHeight: Math.round(COVER * 0.6) }}
        />
      </View>

      <View className="gap-3 px-4 pb-4 pt-3.5">
        <Text variant="h2" className="text-[24px] leading-[25px]">
          {post.title}
        </Text>
        {post.pieces.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            className="-mx-4"
            contentContainerClassName="gap-2 px-4"
            accessibilityLabel={t('homeFeed.piecesA11y')}
            testID={`feed.post.${post.id}.pieces`}
          >
            {post.pieces.map((piece, index) => (
              <PieceTile key={`${piece.category}-${index}`} piece={piece} />
            ))}
          </ScrollView>
        ) : null}
        {post.hasSimilar && !teen && onSimilar ? (
          <Button
            label={t('homeFeed.similar')}
            variant="secondary"
            icon={Search}
            size="bar"
            onPress={() => onSimilar(post)}
            className="bg-paper px-2.5"
            testID={`feed.post.${post.id}.similar`}
          />
        ) : null}
        <View className="-mx-2 flex-row items-center justify-between">
          <Pressable
            onPress={() => like(post, !post.liked)}
            accessibilityRole="button"
            accessibilityLabel={t('homeFeed.like')}
            accessibilityState={{ selected: post.liked }}
            hitSlop={4}
            testID={`feed.post.${post.id}.like`}
            className="h-icon-btn w-icon-btn items-center justify-center rounded-pill active:opacity-70"
          >
            <Icon icon={Heart} size={23} tone={post.liked ? 'accent' : 'ink'} filled={post.liked} />
          </Pressable>
          <Pressable
            onPress={() => save(post, !post.saved)}
            accessibilityRole="button"
            accessibilityLabel={t('homeFeed.save')}
            accessibilityState={{ selected: post.saved }}
            hitSlop={4}
            testID={`feed.post.${post.id}.save`}
            className="h-icon-btn w-icon-btn items-center justify-center rounded-pill active:opacity-70"
          >
            <Icon icon={Bookmark} size={20} tone={post.saved ? 'accent' : 'ink'} filled={post.saved} />
          </Pressable>
        </View>
        <Text variant="bodyMedium" className="-mt-1.5 text-[13.5px] leading-[19.5px]" accessibilityLiveRegion="polite" testID={`feed.post.${post.id}.likes`}>
          {likes}
        </Text>
      </View>
    </View>
  );
}
