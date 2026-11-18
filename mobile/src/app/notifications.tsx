import { router } from 'expo-router';
import { CalendarCheck, ChevronRight, Crown, Settings, Sparkles, Star, Tag, type LucideIcon } from 'lucide-react-native';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { AppNotification, NotificationKind } from '@/api/contracts/notifications';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { RowCard } from '@/features/account/rows';
import { groupByDay, targetOf, unreadCount, type NotificationGroup } from '@/features/notifications/logic';
import { useMarkNotificationsRead } from '@/features/notifications/mutations';
import { useNotifications } from '@/features/notifications/queries';
import { currentLanguage, type AppLanguage } from '@/i18n';
import { formatDate, formatDayMonth, formatMoney, relativeTime } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

const ICONS: Record<NotificationKind, LucideIcon> = {
  price_drop: Tag,
  friend_rating: Star,
  weekly_plan: CalendarCheck,
  credits_low: Sparkles,
  renewal: Crown,
};

/** The two lines of a notification, built in the app's language from the data the server sent. */
function describe(n: AppNotification, t: TFunction, language: AppLanguage): { title: string; body: string } {
  switch (n.kind) {
    case 'price_drop':
      return {
        title: t('notifCenter.priceDrop.title', { name: n.productName }),
        body: t('notifCenter.priceDrop.body', { brand: n.brandName, price: formatMoney(n.price), previous: formatMoney(n.previousPrice) }),
      };
    case 'friend_rating':
      return { title: t('notifCenter.friendRating.title', { name: n.person.displayName, count: n.score }), body: t('notifCenter.friendRating.body') };
    case 'weekly_plan':
      return { title: t('notifCenter.weeklyPlan.title'), body: t('notifCenter.weeklyPlan.body') };
    case 'credits_low':
      return { title: t('notifCenter.creditsLow.title', { count: n.remaining }), body: t('notifCenter.creditsLow.body') };
    case 'renewal':
      return {
        title: t('notifCenter.renewal.title', { date: suffixed(formatDayMonth(new Date(n.renewsAt)), 'locative', language) }),
        body: t('notifCenter.renewal.body'),
      };
  }
}

/** Today: "2 saat önce"; older days: the clock time (the day is the group's heading). */
function timeLabel(n: AppNotification, group: NotificationGroup, t: TFunction): string {
  if (group.bucket !== 'today') return formatDate(new Date(n.createdAt), { hour: '2-digit', minute: '2-digit' });
  const when = relativeTime(n.createdAt);
  if (when.unit === 'now') return t('feed.timeNow');
  if (when.unit === 'minutes') return t('feed.timeMinutes', { count: when.count });
  if (when.unit === 'hours') return t('feed.timeHours', { count: when.count });
  return t('feed.timeDays', { count: when.count });
}

function groupLabel(group: NotificationGroup, t: TFunction, language: AppLanguage): string {
  if (group.bucket === 'today') return t('notifCenter.today');
  if (group.bucket === 'yesterday') return t('notifCenter.yesterday');
  return toDisplayUpper(formatDate(group.date, { day: 'numeric', month: 'long', weekday: 'long' }), language);
}

type RowProps = { notification: AppNotification; group: NotificationGroup; first: boolean; onOpen: (n: AppNotification) => void };

/** One notification: 36 pt sand glyph · title (medium while unread) + muted line · time and the unread dot. */
function NotificationRow({ notification, group, first, onOpen }: RowProps) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const unread = notification.readAt === null;
  const { title, body } = describe(notification, t, language);
  const time = timeLabel(notification, group, t);
  return (
    <Pressable
      onPress={() => onOpen(notification)}
      accessibilityRole="button"
      accessibilityLabel={t(unread ? 'notifCenter.rowUnreadA11y' : 'notifCenter.rowA11y', { title, body, time })}
      testID={`notification-${notification.id}`}
      className={`min-h-[64px] flex-row items-center gap-3 py-3 active:opacity-70 ${first ? '' : 'border-t border-line'}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
        <Icon icon={ICONS[notification.kind]} size={18} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant={unread ? 'bodyMedium' : 'body'} tone={unread ? 'ink' : 'muted'}>
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
        {unread ? <View className="h-2 w-2 rounded-pill bg-accent" testID={`unread-${notification.id}`} /> : <View className="h-2 w-2" />}
      </View>
    </Pressable>
  );
}

/**
 * Bildirim merkezi — the bell on 06 Bugün. No board exists; derived from the canvas vocabulary of
 * 24b İzleme listem, 25 Arkadaş akışı and 29 Ayarlar (centred header, eyebrow group labels, paper row
 * cards with inset hairlines, accent dot for "new"). Grouped by day; a row marks itself read and opens
 * its subject (product / friend feed / weekly plan / membership). Detail screen: no bottom menu.
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const language = currentLanguage();
  const notifications = useNotifications();
  const markRead = useMarkNotificationsRead();

  const open = (n: AppNotification) => {
    if (n.readAt === null) markRead([n.id]);
    router.push(targetOf(n));
  };
  const openSettings = () => router.push('/settings');

  return (
    <Screen bottom>
      <ScreenHeader
        title={t('screens.notifications')}
        leading="back"
        right={<IconButton icon={Settings} variant="plain" onPress={openSettings} accessibilityLabel={t('notifCenter.settings')} className="-mr-2.5" />}
      />
      <ScreenState
        query={notifications}
        isEmpty={(data) => data.items.length === 0}
        empty={{ message: t('notifCenter.empty'), actionLabel: t('notifCenter.settings'), onAction: openSettings }}
      >
        {(data) => {
          const unread = unreadCount(data.items);
          const groups = groupByDay(data.items);
          return (
            <ScrollView
              contentContainerClassName="gap-2.5 px-gutter pb-10 pt-0.5"
              refreshControl={
                <RefreshControl refreshing={notifications.isRefetching} onRefresh={() => void notifications.refetch()} tintColor={colors.muted} />
              }
            >
              <View className="min-h-icon-btn flex-row items-center justify-between gap-3">
                <Text variant="caption" tone="muted" className="flex-1" accessibilityLiveRegion="polite">
                  {unread > 0 ? t('notifCenter.unread', { count: unread }) : t('notifCenter.allRead')}
                </Text>
                {unread > 0 ? <Button variant="text" label={t('notifCenter.markAll')} onPress={() => markRead(null)} className="-mr-2" /> : null}
              </View>

              {groups.map((group) => (
                <View key={group.day} className="gap-2.5">
                  <Text variant="eyebrow" accessibilityRole="header">
                    {groupLabel(group, t, language)}
                  </Text>
                  <RowCard>
                    {group.items.map((n, index) => (
                      <NotificationRow key={n.id} notification={n} group={group} first={index === 0} onOpen={open} />
                    ))}
                  </RowCard>
                </View>
              ))}

              <Pressable
                onPress={openSettings}
                accessibilityRole="button"
                accessibilityLabel={t('notifCenter.settings')}
                className="min-h-icon-btn flex-row items-center justify-between gap-3 active:opacity-70"
              >
                <Text variant="body" className="flex-1">
                  {t('notifCenter.settings')}
                </Text>
                <Icon icon={ChevronRight} size={16} />
              </Pressable>
            </ScrollView>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
