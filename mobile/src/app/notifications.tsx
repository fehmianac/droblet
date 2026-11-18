import { router } from 'expo-router';
import { UserCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import { Badge, Card } from '@/components/blocks/basics';
import { MenuRow } from '@/components/blocks/rows';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { NotificationPrefsCard } from '@/features/account/NotificationPrefsCard';
import { useIncomingRequestCount } from '@/features/social/queries';

/**
 * Bildirimler (the bell on Bugün) — what is waiting for the user (follow requests) and every
 * notification preference, including price drops and follow requests (both off by default).
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const requestCount = useIncomingRequestCount();

  return (
    <Screen bottom>
      <ScreenHeader title={t('friends.notificationsTitle')} leading="back" />
      <OfflineBanner />
      <ScrollView contentContainerClassName="gap-3 px-gutter pb-10">
        <Text variant="eyebrow" className="pt-2">
          {t('friends.notificationsActivity')}
        </Text>
        <Card>
          <MenuRow
            first
            icon={UserCheck}
            label={t('friends.menuRequests')}
            trailing={requestCount > 0 ? <Badge tone="accent" label={String(requestCount)} /> : undefined}
            onPress={() => router.push('/friends/requests')}
          />
        </Card>
        <Text variant="eyebrow" className="pt-4">
          {t('friends.notificationsPrefs')}
        </Text>
        <NotificationPrefsCard />
      </ScrollView>
    </Screen>
  );
}
