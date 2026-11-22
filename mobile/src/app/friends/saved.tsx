import { router, useLocalSearchParams } from "expo-router";
import { BookmarkX } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, View } from "react-native";

import type { FeedPost } from "@/api/contracts/feed";
import type { FeedLook } from "@/api/contracts/social";
import { Card } from "@/components/blocks/basics";
import { IconButton } from "@/components/ui/IconButton";
import { PlaceholderImage } from "@/components/ui/PlaceholderImage";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ScreenState } from "@/components/ui/ScreenState";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Text } from "@/components/ui/Text";
import { BuySheet } from "@/features/feed/BuySheet";
import { FeedPostCard, FeedPostSkeleton } from "@/features/feed/FeedPostCard";
import { isHiddenThisSession } from "@/features/feed/logic";
import { useSavedFeedPosts } from "@/features/feed/queries";
import { useUserPostSheets } from "@/features/feed/useUserPostSheets";
import { useSaveLook } from "@/features/social/mutations";
import { useSavedLooks } from "@/features/social/queries";
import { useTeenRules } from "@/features/teen/store";
import { useThemeColors } from "@/theme/useThemeColors";

function SavedCard({ look }: { look: FeedLook }) {
  const { t } = useTranslation();
  const save = useSaveLook();
  const handle = `@${look.author.handle}`;
  const title =
    look.name ||
    (look.occasion ? t(`occasion.${look.occasion}`) : look.author.displayName);
  return (
    <Card className="flex-1 gap-2 p-2">
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/u/[handle]",
            params: { handle: look.author.handle },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${look.author.displayName}`}
        testID={`saved.open.${look.lookId}`}
        className="gap-2 active:opacity-80"
      >
        {/* Another person's look is shown with its piece images — never a try-on image. */}
        <PlaceholderImage
          uri={look.imageUrl}
          className="aspect-[4/5] w-full rounded-image"
        />
        <View className="px-1">
          <Text variant="bodyMedium" numberOfLines={1}>
            {title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {handle}
          </Text>
        </View>
      </Pressable>
      <View className="absolute right-3 top-3">
        <IconButton
          icon={BookmarkX}
          variant="inverse"
          onPress={() => save(look.author.handle, look.lookId, false)}
          accessibilityLabel={t("friends.unsaveA11y", { name: title })}
          testID={`saved.remove.${look.lookId}`}
        />
      </View>
    </Card>
  );
}

type SavedTab = "looks" | "feed";

/**
 * Akış posts I saved (`GET v1/tenant/feed-post/saved`): the same cards as on Akış — editor posts and (Akış F2) looks
 * members shared, with their "⋯" and "Benzerlerini gör"; "Kaydet" again removes one.
 */
function SavedFeedPosts() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const teen = useTeenRules().hide.commerce;
  const saved = useSavedFeedPosts();
  const [buying, setBuying] = useState<FeedPost | null>(null);
  const userPost = useUserPostSheets({ teen });
  return (
    <>
      <ScreenState
        query={saved}
        isEmpty={(list) => list.length === 0}
        empty={{
          message: t("homeFeed.saved.empty"),
          actionLabel: t("homeFeed.saved.emptyAction"),
          onAction: () => router.dismissTo("/"),
        }}
        skeleton={
          <View className="px-gutter pt-2">
            <FeedPostSkeleton />
          </View>
        }
      >
        {(list) => (
          <FlatList
            data={list.filter((p) => !isHiddenThisSession(p.id))}
            keyExtractor={(p) => p.id}
            contentContainerClassName="gap-8 px-gutter pb-8 pt-2"
            refreshControl={
              <RefreshControl
                refreshing={saved.isRefetching}
                onRefresh={() => void saved.refetch()}
                tintColor={colors.muted}
              />
            }
            renderItem={({ item }) => (
              <FeedPostCard
                post={item}
                teen={teen}
                onBuy={setBuying}
                onMenu={userPost.openMenu}
                onSimilar={userPost.openSimilar}
              />
            )}
            testID="saved.feed"
          />
        )}
      </ScreenState>
      {teen ? null : <BuySheet post={buying} onClose={() => setBuying(null)} />}
      {userPost.sheets}
    </>
  );
}

/** Kaydettiğim look'lar (from Profil) — friends' looks I saved; looks no longer visible to me are left out by the server. */
function SavedLooks() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const saved = useSavedLooks();

  return (
    <ScreenState
      query={saved}
      isEmpty={(list) => list.length === 0}
      empty={{
        message: t("friends.savedEmpty"),
        actionLabel: t("friends.savedEmptyAction"),
        onAction: () => router.push("/friends/feed"),
      }}
    >
      {(list) => (
        <FlatList
          data={list}
          numColumns={2}
          keyExtractor={(l) => l.lookId}
          columnWrapperClassName="gap-3 px-gutter"
          contentContainerClassName="gap-3 pb-8 pt-2"
          refreshControl={
            <RefreshControl
              refreshing={saved.isRefetching}
              onRefresh={() => void saved.refetch()}
              tintColor={colors.muted}
            />
          }
          renderItem={({ item }) => <SavedCard look={item} />}
        />
      )}
    </ScreenState>
  );
}

/**
 * Kaydedilenler (from Profil): two tabs — friends' looks I saved ("Looklar") and the Akış posts I saved ("Akış").
 * `?tab=feed` opens the second (the toast after "Kaydet" on Akış). A teen account (social closed) sees only its saved
 * Akış posts, without the tabs: Akış is editor content, not social (owner decision 2026-11-22).
 */
export default function SavedLooksScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ tab?: string }>();
  const socialClosed = useTeenRules().hide.social;
  const [chosen, setTab] = useState<SavedTab>(
    params.tab === "feed" ? "feed" : "looks",
  );
  const tab: SavedTab = socialClosed ? "feed" : chosen;

  return (
    <Screen bottom>
      <ScreenHeader title={t("friends.savedTitle")} leading="back" />
      {socialClosed ? null : (
        <View className="px-gutter pb-2">
          <SegmentedControl
            segments={[
              { value: "looks", label: t("homeFeed.saved.tabLooks") },
              { value: "feed", label: t("homeFeed.saved.tabFeed") },
            ]}
            value={tab}
            onChange={setTab}
            accessibilityLabel={t("homeFeed.saved.tabsA11y")}
            testID="saved.tab"
          />
        </View>
      )}
      {tab === "feed" ? <SavedFeedPosts /> : <SavedLooks />}
    </Screen>
  );
}
