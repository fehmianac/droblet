import { LinearGradient } from 'expo-linear-gradient';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ShoppingBag, Sparkles, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import type { EditorStory } from '@/api/contracts/feed';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { monogram } from '@/features/feed/FeedBits';
import { shortAge } from '@/features/feed/logic';
import { useEditorStories } from '@/features/feed/queries';
import { storySeenStore } from '@/features/feed/storySeen';
import { useOpenOnBrandSite } from '@/features/feed/useOpenOnBrandSite';
import { useTeenRules } from '@/features/teen/store';
import { useTryOnAction } from '@/features/tryon/useTryOnAction';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatMoney } from '@/lib/format';
import { feedTones } from '@/theme/tokens';

/** How long one story stays before the next one (auto-advance is off with reduce-motion). */
export const STORY_DURATION_MS = 6000;

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

/** The thin bars at the top: done = cream, current = filling, next = cream at 40 %. */
function Progress({ count, index, progress }: { count: number; index: number; progress: Animated.Value }) {
  const { t } = useTranslation();
  return (
    <View className="flex-row gap-1 px-3" accessible accessibilityLabel={t('homeFeed.story.progressA11y', { index: index + 1, count })}>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className="h-[2.5px] flex-1 overflow-hidden rounded-[2px] bg-feed-story-track">
          {i < index ? <View className="h-full w-full bg-cream" /> : null}
          {i === index ? (
            <Animated.View
              className="h-full bg-cream"
              style={{ width: progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

function StoryBody({ stories, startIndex }: { stories: EditorStory[]; startIndex: number }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const insets = useSafeAreaInsets();
  const teen = useTeenRules().hide.commerce;
  const reduceMotion = useReduceMotion();
  const focused = useIsFocused();
  const brandSite = useOpenOnBrandSite();
  const [index, setIndex] = useState(startIndex);
  // Any tap on the product or the try-on holds the story where it is.
  const [held, setHeld] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));
  const story = stories[index] ?? stories[0];
  const product = story?.product ?? null;

  const tryOn = useTryOnAction({
    target: { kind: 'product', id: product?.id ?? '' },
    title: product?.name ?? story?.headline ?? '',
    feature: 'feed_story_try_on',
    cachedJobId: null,
  });

  const go = (next: number) => {
    if (next < 0) return;
    if (next >= stories.length) {
      close();
      return;
    }
    setHeld(false);
    setIndex(next);
  };

  // Each story shown counts once as viewed and turns its ring to "seen".
  const storyId = story?.id;
  useEffect(() => {
    if (!storyId) return;
    void storySeenStore.markSeen(storyId);
    track('feed_story_view', { storyId });
  }, [storyId]);

  // Reduce-motion: the current bar is simply full and the story waits for a tap.
  useEffect(() => {
    progress.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion || held || !focused) return;
    const run = Animated.timing(progress, { toValue: 1, duration: STORY_DURATION_MS, useNativeDriver: false });
    run.start(({ finished }) => {
      if (finished) go(index + 1);
    });
    return () => run.stop();
    // `go` reads the latest index through the closure created with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, held, focused, reduceMotion, progress]);

  if (!story) return null;

  const openProduct = () => {
    if (!product || teen) return;
    setHeld(true);
    router.back();
    router.push({ pathname: '/shop/product/[id]', params: { id: product.id } });
  };

  return (
    <View className="flex-1" accessibilityViewIsModal accessibilityLabel={t('homeFeed.storyA11y', { name: story.author.name })} testID="feed.storyViewer">
      <ImageSlot uri={story.imageUrl} className="absolute inset-0" placeholder={{ kind: 'figure', seed: story.id, tone: 'dark', figureHeight: 420 }} />
      <LinearGradient
        colors={[feedTones.storyTop, feedTones.storyClear, feedTones.storyClear, feedTones.storyBottom]}
        locations={[0, 0.22, 0.5, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Tap zones: the left third goes back, the rest forward (under the controls). */}
      <View className="absolute inset-0 flex-row">
        <Pressable className="flex-1" onPress={() => go(index - 1)} accessibilityRole="button" accessibilityLabel={t('homeFeed.story.prev')} testID="feed.story.prev" />
        <Pressable className="flex-[2]" onPress={() => go(index + 1)} accessibilityRole="button" accessibilityLabel={t('homeFeed.story.next')} testID="feed.story.next" />
      </View>

      <View style={{ paddingTop: insets.top + 8 }} pointerEvents="box-none">
        <Progress count={stories.length} index={index} progress={progress} />
        <View className="flex-row items-center gap-2.5 pl-4 pr-2 pt-3" pointerEvents="box-none">
          <View className="h-8 w-8 items-center justify-center rounded-pill bg-cream" accessible={false}>
            <Text variant="badge" className="text-[10px]">
              {monogram(story.author.name, language)}
            </Text>
          </View>
          <View className="flex-1" pointerEvents="none">
            <Text variant="bodyMedium" tone="cream" className="text-[13.5px]" numberOfLines={1}>
              {story.author.name}
            </Text>
            <Text variant="caption" tone="onPhoto" className="text-[11.5px]" numberOfLines={1}>
              {shortAge(t, story.publishedAt)}
            </Text>
          </View>
          <View>
            <IconButton icon={X} variant="plain" iconSize={22} onPress={close} accessibilityLabel={t('homeFeed.story.close')} testID="feed.story.close" />
          </View>
        </View>
      </View>

      <View className="flex-1" pointerEvents="none" />

      <View className="gap-2.5 px-4" style={{ paddingBottom: Math.max(insets.bottom, 16) + 18 }} pointerEvents="box-none">
        <Text variant="display" tone="cream" className="text-[32px] leading-[33px]" accessibilityRole="header">
          {story.headline}
        </Text>
        {product ? (
          <View className="flex-row items-center gap-2.5 rounded-[16px] bg-feed-story-card p-2">
            <Pressable
              onPress={openProduct}
              disabled={teen}
              accessibilityRole={teen ? undefined : 'link'}
              accessibilityLabel={teen ? product.name : t('homeFeed.story.openProductA11y', { name: product.name })}
              testID="feed.story.product"
              className="flex-1 flex-row items-center gap-2.5 active:opacity-80"
            >
              <ImageSlot
                uri={product.imageUrl}
                className="h-12 w-12 rounded-thumb"
                placeholder={{ kind: 'garment', category: product.category, color: product.colors[0], glyphSize: 22 }}
              />
              <View className="flex-1">
                <Text variant="bodyMedium" className="text-[13.5px]" numberOfLines={1}>
                  {product.name}
                </Text>
                {!teen && product.price ? (
                  <Text variant="caption" tone="muted">
                    {formatMoney(product.price)}
                  </Text>
                ) : (
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {product.brandName}
                  </Text>
                )}
              </View>
            </Pressable>
            {teen ? null : (
              <Button
                label={t('homeFeed.buy')}
                icon={ShoppingBag}
                size="md"
                loading={brandSite.pendingId === product.id}
                onPress={() => {
                  setHeld(true);
                  brandSite.open(product, { source: 'story' });
                }}
                accessibilityHint={t('homeFeed.story.buyA11y')}
                className="px-3.5"
                testID="feed.story.buy"
              />
            )}
          </View>
        ) : null}
        {brandSite.error ? (
          <Text variant="caption" tone="cream" accessibilityLiveRegion="polite">
            {brandSite.error.message}
          </Text>
        ) : null}
        {product ? (
          <Button
            label={t('homeFeed.tryOn')}
            detail={t('homeFeed.tryOnCost')}
            icon={Sparkles}
            variant="inverse"
            onPress={() => {
              setHeld(true);
              track('feed_tryon_start', { source: 'story', productId: product.id });
              tryOn.invite.onPress();
            }}
            testID="feed.story.tryOn"
          />
        ) : null}
        {tryOn.note ? (
          <Text variant="caption" tone="cream" accessibilityLiveRegion="polite">
            {tryOn.note}
          </Text>
        ) : null}
      </View>
      {product ? tryOn.sheet : null}
    </View>
  );
}

/**
 * Akış F1 story viewer (canvas 06″): the editor story full screen — progress bars, the author and the age, ×, the serif
 * headline, the product card ("Satın al" opens the brand site; the card opens the product screen) and
 * "Üzerimde dene · 1 kredi" (the product on the user). Teen accounts: no price, no "Satın al".
 */
export default function FeedStoryScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const stories = useEditorStories();
  const list = stories.data ?? [];
  const start = Math.max(0, list.findIndex((s) => s.id === id));

  useEffect(() => {
    // Gone since the row was drawn (or a stale link): nothing to show.
    if (stories.isSuccess && list.length === 0) close();
  }, [stories.isSuccess, list.length]);

  return (
    <View className="flex-1 bg-ink">
      {list.length > 0 ? <StoryBody key={list[start]?.id ?? 'story'} stories={list} startIndex={start} /> : null}
    </View>
  );
}
