import { router } from 'expo-router';
import { Bookmark, Ellipsis, Heart, Search } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { FeedPost } from '@/api/contracts/feed';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { formatNumber } from '@/lib/format';

import { AuthorAvatar, FeedToggle } from './FeedBits';
import { feedImageSource, feedLookPieces } from './FeedCarousel';
import { FeedPieceStrip } from './FeedPieceStrip';
import { postMeta } from './logic';
import { useLikeFeedPost, useOpenFeedPost, useSaveFeedPost } from './mutations';

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

/**
 * A member's look on Akış (canvas 06‴ Akış F2, decision 21): avatar and @handle (they open the profile — "Takip et"
 * lives there), "Topluluk · Hafta sonu · 1 sa", the "⋯" menu, the look's cover, its name, the piece strip (picture +
 * kind), "Benzerlerini gör" when the catalogue has something close, ♡ with the count and Kaydet. No "Üzerimde dene",
 * no buying, no buyable chip, no verified mark, no comments. A tap on the cover or on the name opens the post's detail
 * (`feed/[id]`), where the pieces are shown large.
 */
export function FeedUserPostCard({ post, teen, onMenu, onSimilar }: Props) {
  const { t } = useTranslation();
  const like = useLikeFeedPost();
  const save = useSaveFeedPost();
  const author = post.author.name;
  const handle = post.author.handle;
  const openPost = useOpenFeedPost();
  const open = () => openPost(post);
  const openLabel = t('homeFeed.openPostA11y', { title: post.title });
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

      <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={openLabel} style={{ height: COVER }} className="bg-sand" testID={`feed.post.${post.id}.photo.0`}>
        <ImageSlot
          {...feedImageSource(post, post.images[0] ?? null)}
          className="h-full w-full"
          accessibilityLabel={t('homeFeed.coverA11y', { title: post.title })}
          placeholder={{ kind: 'look', pieces: feedLookPieces(post), seed: post.id, figureHeight: Math.round(COVER * 0.6) }}
        />
      </Pressable>

      <View className="gap-3 px-4 pb-4 pt-3.5">
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={openLabel} testID={`feed.post.${post.id}.title`} className="active:opacity-70">
          <Text variant="h2" accessibilityRole="none" className="text-[24px] leading-[25px]">
            {post.title}
          </Text>
        </Pressable>
        {post.pieces.length > 0 ? (
          <FeedPieceStrip postId={post.id} pieces={post.pieces} />
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
          <FeedToggle icon={Heart} size={23} on={post.liked} label={t('homeFeed.like')} onPress={() => like(post, !post.liked)} testID={`feed.post.${post.id}.like`} />
          <FeedToggle icon={Bookmark} size={20} on={post.saved} label={t('homeFeed.save')} onPress={() => save(post, !post.saved)} testID={`feed.post.${post.id}.save`} />
        </View>
        <Text variant="bodyMedium" className="-mt-1.5 text-[13.5px] leading-[19.5px]" accessibilityLiveRegion="polite" testID={`feed.post.${post.id}.likes`}>
          {likes}
        </Text>
      </View>
    </View>
  );
}
