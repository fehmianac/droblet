import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { TodayResponse } from '@/api/contracts';
import type { EditorStory } from '@/api/contracts/feed';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

type Props = {
  /** Today's card (null while loading or unavailable: the circle shows the placeholder). */
  today: TodayResponse | null | undefined;
  stories: EditorStory[] | undefined;
  storiesLoading: boolean;
  seen: ReadonlySet<string>;
  onOpenToday: () => void;
  onOpenStory: (story: EditorStory) => void;
};

/** One 66 circle: 2 pt ring, 2.5 inset, the picture inside. */
function Ring({ ring, children }: { ring: 'ink' | 'new' | 'seen'; children: ReactNode }) {
  const border = ring === 'ink' ? 'border-ink' : ring === 'new' ? 'border-accent' : 'border-line';
  return <View className={`h-[66px] w-[66px] rounded-pill border-2 p-[2.5px] ${border}`}>{children}</View>;
}

/**
 * The story row of Akış (canvas 06″): first "Bugün" — today's look (or its placeholder) with the "Plan" badge,
 * opening 06 Bugün — then the editor stories, newest first. An unopened story has the accent ring; one opened on
 * this phone the line ring (and "izlendi" in its label: colour is never the only signal).
 */
export function StoriesRow({ today, stories, storiesLoading, seen, onOpenToday, onOpenStory }: Props) {
  const { t } = useTranslation();
  const look = today?.look ?? null;
  const todayImage = look ? (look.tryOnImageUrl ?? look.pieces.find((p) => p.imageUrl)?.imageUrl ?? null) : null;
  const todayLabel = look
    ? t('homeFeed.todayStoryA11y', { name: look.name, occasion: t(`occasion.${today?.occasion ?? look.occasion}`) })
    : t('homeFeed.todayStoryEmptyA11y');

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-3 px-gutter"
      accessibilityLabel={t('homeFeed.storiesA11y')}
      accessibilityRole="list"
      testID="feed.stories"
    >
      <Pressable
        onPress={onOpenToday}
        accessibilityRole="link"
        accessibilityLabel={todayLabel}
        testID="feed.story.today"
        className="w-[66px] items-center gap-1.5 active:opacity-80"
      >
        <View>
          <Ring ring="ink">
            <ImageSlot
              uri={todayImage}
              className="h-full w-full rounded-pill"
              placeholder={{ kind: 'look', pieces: look?.pieces.map((p) => ({ imageUrl: p.imageUrl })) ?? [], seed: look?.id ?? 'today', figureHeight: 44 }}
            />
          </Ring>
          <View className="absolute -bottom-1 -right-1 h-5 justify-center rounded-pill border-2 border-cream bg-ink px-1.5" pointerEvents="none">
            <Text variant="badge" tone="cream" className="text-[10px] leading-[12px]">
              {t('homeFeed.todayBadge')}
            </Text>
          </View>
        </View>
        <Text variant="label" className="text-[11.5px] leading-[14px]" numberOfLines={1}>
          {t('homeFeed.todayStory')}
        </Text>
      </Pressable>

      {storiesLoading && !stories
        ? [0, 1, 2].map((i) => (
            <View key={i} className="w-[66px] items-center gap-1.5" accessible={false}>
              <Skeleton className="h-[66px] w-[66px] rounded-pill" />
              <Skeleton className="h-2.5 w-12 rounded-[5px]" />
            </View>
          ))
        : (stories ?? []).map((story) => {
            const wasSeen = seen.has(story.id);
            return (
              <Pressable
                key={story.id}
                onPress={() => onOpenStory(story)}
                accessibilityRole="button"
                accessibilityLabel={t(wasSeen ? 'homeFeed.storySeenA11y' : 'homeFeed.storyA11y', { name: story.author.name })}
                testID={`feed.story.${story.id}`}
                className="w-[66px] items-center gap-1.5 active:opacity-80"
              >
                <Ring ring={wasSeen ? 'seen' : 'new'}>
                  <ImageSlot
                    uri={story.imageUrl ?? story.author.imageUrl}
                    className="h-full w-full rounded-pill"
                    placeholder={{ kind: 'avatar', name: story.author.name.replace(/^@/, '') }}
                  />
                </Ring>
                <Text variant="caption" className="text-center text-[11.5px] leading-[13px]" numberOfLines={2}>
                  {story.author.name}
                </Text>
              </Pressable>
            );
          })}
    </ScrollView>
  );
}
