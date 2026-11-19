import { router } from "expo-router";
import {
  Download,
  Settings,
  Shirt,
  Sparkles,
  Star,
  Tag,
  UserCheck,
  UserPlus,
  type LucideIcon,
} from "lucide-react-native";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";

import type {
  AppNotification,
  NotificationKind,
} from "@/api/contracts/notifications";
import { Badge } from "@/components/blocks/basics";
import { MenuRow } from "@/components/blocks/rows";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Screen } from "@/components/ui/Screen";
import { ScreenHeader } from "@/components/ui/ScreenHeader";
import { ScreenState } from "@/components/ui/ScreenState";
import { Text } from "@/components/ui/Text";
import { NotificationPrefsCard } from "@/features/account/NotificationPrefsCard";
import { RowCard } from "@/features/account/rows";
import {
  groupByDay,
  nearEnd,
  targetOf,
  type NotificationGroup,
} from "@/features/notifications/logic";
import { useMarkNotificationsRead } from "@/features/notifications/mutations";
import {
  useLoadMoreNotifications,
  useNotifications,
} from "@/features/notifications/queries";
import { useIncomingRequestCount } from "@/features/social/queries";
import type { AppLanguage } from "@/i18n";
import { useAppLanguage } from "@/i18n/useAppLanguage";
import { formatDate, relativeTime } from "@/lib/format";
import { toDisplayUpper } from "@/lib/upper";
import { useThemeColors } from "@/theme/useThemeColors";

const ICONS: Record<NotificationKind, LucideIcon> = {
  morning_outfit: Shirt,
  weekly_edit: Sparkles,
  friend_ratings: Star,
  price_drop: Tag,
  follow_request: UserPlus,
  data_export_ready: Download,
};

/** The two lines of a notification, built in the app's language from the codes and ids the server sent. */
function describe(
  n: AppNotification,
  t: TFunction,
): { title: string; body: string } {
  switch (n.kind) {
    case "morning_outfit":
      return {
        title: t("notifCenter.morningOutfit.title"),
        body: t("notifCenter.morningOutfit.body"),
      };
    case "weekly_edit":
      return {
        title: t("notifCenter.weeklyEdit.title"),
        body: t("notifCenter.weeklyEdit.body"),
      };
    case "friend_ratings":
      return {
        title: t("notifCenter.friendRatings.title"),
        body: t("notifCenter.friendRatings.body"),
      };
    case "price_drop":
      return {
        title: t("notifCenter.priceDrop.title"),
        body: t("notifCenter.priceDrop.body"),
      };
    case "follow_request":
      return {
        title: n.data.handle
          ? t("notifCenter.followRequest.title", { handle: n.data.handle })
          : t("notifCenter.followRequest.titleAnonymous"),
        body: t("notifCenter.followRequest.body"),
      };
    case "data_export_ready":
      return {
        title: t("notifCenter.dataExport.title"),
        body: t("notifCenter.dataExport.body"),
      };
  }
}

/** Today: "2 saat önce"; older days: the clock time (the day is the group's heading). */
function timeLabel(
  n: AppNotification,
  group: NotificationGroup,
  t: TFunction,
): string {
  if (group.bucket !== "today")
    return formatDate(new Date(n.createdAt), {
      hour: "2-digit",
      minute: "2-digit",
    });
  const when = relativeTime(n.createdAt);
  if (when.unit === "now") return t("feed.timeNow");
  if (when.unit === "minutes")
    return t("feed.timeMinutes", { count: when.count });
  if (when.unit === "hours") return t("feed.timeHours", { count: when.count });
  return t("feed.timeDays", { count: when.count });
}

function groupLabel(
  group: NotificationGroup,
  t: TFunction,
  language: AppLanguage,
): string {
  if (group.bucket === "today") return t("notifCenter.today");
  if (group.bucket === "yesterday") return t("notifCenter.yesterday");
  return toDisplayUpper(
    formatDate(group.date, { day: "numeric", month: "long", weekday: "long" }),
    language,
  );
}

type RowProps = {
  notification: AppNotification;
  group: NotificationGroup;
  first: boolean;
  onOpen: (n: AppNotification) => void;
};

/** One notification: 36 pt sand glyph · title (medium while unread) + muted line · time and the unread dot. */
function NotificationRow({ notification, group, first, onOpen }: RowProps) {
  const { t } = useTranslation();
  const unread = notification.readAt === null;
  const { title, body } = describe(notification, t);
  const time = timeLabel(notification, group, t);
  return (
    <Pressable
      onPress={() => onOpen(notification)}
      accessibilityRole="button"
      accessibilityLabel={t(
        unread ? "notifCenter.rowUnreadA11y" : "notifCenter.rowA11y",
        { title, body, time },
      )}
      testID={`notification-${notification.id}`}
      className={`min-h-[64px] flex-row items-center gap-3 py-3 active:opacity-70 ${first ? "" : "border-t border-line"}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
        <Icon icon={ICONS[notification.kind]} size={18} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text
          variant={unread ? "bodyMedium" : "body"}
          tone={unread ? "ink" : "muted"}
        >
          {title}
        </Text>
        <Text variant="caption" tone="muted">
          {body}
        </Text>
      </View>
      <View className="items-end gap-1.5">
        <Text variant="caption" tone="muted">
          {time}
        </Text>
        {unread ? (
          <View
            className="h-2 w-2 rounded-pill bg-accent"
            testID={`unread-${notification.id}`}
          />
        ) : (
          <View className="h-2 w-2" />
        )}
      </View>
    </Pressable>
  );
}

/**
 * Bildirim merkezi — the bell on 06 Bugün. No board exists; derived from the canvas vocabulary of
 * 24b İzleme listem, 25 Arkadaş akışı and 29 Ayarlar (centred header, eyebrow group labels, paper row
 * cards with inset hairlines, accent dot for "new"). The inbox of `GET v1/tenant/notification` (the
 * events the Notifier sends, 90 days), grouped by day; a row marks itself read and opens its subject
 * — the same place its push opens. Detail screen: no bottom menu.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const language = useAppLanguage();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();
  const more = useLoadMoreNotifications();
  // What is waiting for the user: follow requests (followers-only accounts approve each one).
  const requestCount = useIncomingRequestCount();

  const open = (n: AppNotification) => {
    if (n.readAt === null) markRead([n.id]);
    router.push(targetOf(n));
  };
  const openSettings = () => router.push("/settings");

  return (
    <Screen bottom>
      <ScreenHeader
        title={t("screens.notifications")}
        leading="back"
        right={
          <IconButton
            icon={Settings}
            variant="plain"
            onPress={openSettings}
            accessibilityLabel={t("notifCenter.settings")}
            className="-mr-2.5"
          />
        }
      />
      <ScreenState query={notifications}>
        {(data) => {
          // The server's count: it covers every page, not only the loaded one.
          const unread = data.unreadCount;
          const groups = groupByDay(data.items);
          return (
            <ScrollView
              testID="notifications-list"
              contentContainerClassName="gap-2.5 px-gutter pb-10 pt-0.5"
              scrollEventThrottle={200}
              onScroll={(e) => {
                // Infinite scroll: the next page (cursor from the server) once the end is near.
                if (more.hasMore && !more.failed && nearEnd(e.nativeEvent))
                  void more.loadMore();
              }}
              refreshControl={
                <RefreshControl
                  refreshing={notifications.isRefetching}
                  onRefresh={() => void notifications.refetch()}
                  tintColor={colors.muted}
                />
              }
            >
              {data.items.length > 0 ? (
                <View className="min-h-icon-btn flex-row items-center justify-between gap-3">
                  <Text
                    variant="caption"
                    tone="muted"
                    className="flex-1"
                    accessibilityLiveRegion="polite"
                  >
                    {unread > 0
                      ? t("notifCenter.unread", { count: unread })
                      : t("notifCenter.allRead")}
                  </Text>
                  {unread > 0 ? (
                    <Button
                      variant="text"
                      label={t("notifCenter.markAll")}
                      onPress={() => markRead(null)}
                      className="-mr-2"
                    />
                  ) : null}
                </View>
              ) : null}

              <RowCard>
                <MenuRow
                  first
                  icon={UserCheck}
                  label={t("friends.menuRequests")}
                  trailing={
                    requestCount > 0 ? (
                      <Badge tone="accent" label={String(requestCount)} />
                    ) : undefined
                  }
                  onPress={() => router.push("/friends/requests")}
                />
              </RowCard>

              {groups.length === 0 ? (
                <Text
                  variant="body"
                  tone="muted"
                  className="py-6 text-center"
                  testID="notifications-empty"
                >
                  {t("notifCenter.empty")}
                </Text>
              ) : null}

              {groups.map((group) => (
                <View key={group.day} className="gap-2.5">
                  <Text variant="eyebrow" accessibilityRole="header">
                    {groupLabel(group, t, language)}
                  </Text>
                  <RowCard>
                    {group.items.map((n, index) => (
                      <NotificationRow
                        key={n.id}
                        notification={n}
                        group={group}
                        first={index === 0}
                        onOpen={open}
                      />
                    ))}
                  </RowCard>
                </View>
              ))}

              {more.hasMore ? (
                <View
                  className="min-h-icon-btn items-center justify-center"
                  testID="notifications-more"
                >
                  {more.failed ? (
                    <Button
                      variant="text"
                      label={t("notifCenter.loadMoreRetry")}
                      onPress={() => void more.loadMore()}
                      testID="notifications-more-retry"
                    />
                  ) : (
                    <ActivityIndicator
                      color={colors.muted}
                      accessibilityLabel={t("notifCenter.loadingMore")}
                    />
                  )}
                </View>
              ) : null}

              <Text
                variant="eyebrow"
                accessibilityRole="header"
                className="pt-2"
              >
                {t("friends.notificationsPrefs")}
              </Text>
              <NotificationPrefsCard />
            </ScrollView>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
