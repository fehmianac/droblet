import { router } from 'expo-router';
import {
  Bookmark,
  ChartNoAxesColumn,
  CircleCheck,
  CircleAlert,
  Crown,
  Luggage,
  Palette as PaletteIcon,
  Pencil,
  Settings,
  ShieldCheck,
  Users,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';

import type { Entitlement } from '@/api/contracts';
import { useSession } from '@/auth/session';
import { Avatar, Badge, Card } from '@/components/blocks/basics';
import { MenuRow } from '@/components/blocks/rows';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { useMyPhotos, useMyProfile, usePalette, useProfileStats } from '@/features/account/queries';
import { creditSheetStore } from '@/features/credits/creditSheetStore';
import { priceDropPercent } from '@/features/store/cartMath';
import { useWatchlist } from '@/features/store/queries';
import { currentLanguage } from '@/i18n';
import { formatDayMonth, formatMonthName } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/** AI credit counter — every number comes from `GET v1/tenant/entitlement`; nothing is fixed in the app. */
function CreditCard({ entitlement, hasBodyPhoto }: { entitlement: Entitlement; hasBodyPhoto: boolean | null }) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const { monthlyAllowance, remaining, resetsAt } = entitlement.credits;
  const reset = new Date(resetsAt);
  // The allowance belongs to the month before the reset date.
  const month = new Date(reset.getFullYear(), reset.getMonth() - 1, 1);
  const left = t('me.creditsLeft', { total: monthlyAllowance, remaining: suffixed(remaining, 'possessive', language) });
  const share = monthlyAllowance > 0 ? Math.min(1, Math.max(0, remaining / monthlyAllowance)) : 0;

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Text variant="eyebrow">{t('me.creditsEyebrow', { month: toDisplayUpper(formatMonthName(month), language) })}</Text>
        <Text variant="caption" tone="muted">
          {t('me.renews', { date: suffixed(formatDayMonth(reset), 'locative', language) })}
        </Text>
      </View>
      <Text variant="h3">{left}</Text>
      <View
        className="h-1.5 overflow-hidden rounded-pill bg-sand"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={left}
        accessibilityValue={{ min: 0, max: monthlyAllowance, now: remaining }}
      >
        <View className="h-full rounded-pill bg-accent" style={{ width: `${Math.round(share * 100)}%` }} />
      </View>
      <View className="flex-row items-center justify-between gap-3">
        {hasBodyPhoto === null ? (
          <View className="flex-1" />
        ) : (
          <View className="flex-1 flex-row items-center gap-1.5">
            <Icon icon={hasBodyPhoto ? CircleCheck : CircleAlert} size={16} tone={hasBodyPhoto ? 'accent' : 'muted'} />
            <Text variant="caption" tone="muted" className="flex-1">
              {t(hasBodyPhoto ? 'me.photoReady' : 'me.photoMissing')}
            </Text>
          </View>
        )}
        <Button label={t('me.topUp')} onPress={() => creditSheetStore.open('topUp')} className="h-btn-secondary px-5" />
      </View>
    </Card>
  );
}

/** Non-members see what membership adds and a way to the paywall instead of the counter. */
function MembershipTeaser() {
  const { t } = useTranslation();
  return (
    <Card className="gap-3 p-4">
      <Text variant="h3">{t('me.teaserTitle')}</Text>
      <Text variant="body" tone="muted">
        {t('me.teaserBody')}
      </Text>
      <Button label={t('me.teaserAction')} onPress={() => router.push({ pathname: '/paywall', params: { from: 'profile' } })} testID="profile.membership" />
    </Card>
  );
}

/**
 * 28 Profil — who you are, your numbers, the AI credit counter ("Bu ay 30 görselden N'si kaldı" +
 * "Kredi yükle" → 05b) and the menu (İzleme listem, Renk paletim, Üyelik, Aile planı "Yakında", ayarlar).
 */
export default function ProfileTab() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const session = useSession();
  const profile = useMyProfile();
  const stats = useProfileStats();
  const entitlement = useEntitlement();
  const photos = useMyPhotos();
  const palette = usePalette();
  const watchlist = useWatchlist();

  const name = profile.data?.displayName ?? (session.status === 'signedIn' ? session.user.name : '');
  const tags = (profile.data?.styleTags ?? []).slice(0, 2).map((tag) => t(`style.tags.${tag}`));
  const identity = [profile.data?.handle ? `@${profile.data.handle}` : null, ...tags].filter(Boolean).join(' · ');
  const drops = (watchlist.data?.items ?? []).filter((i) => priceDropPercent(i.price, i.previousPrice) !== null).length;
  const isMember = entitlement.data?.tier === 'member';

  const refresh = () => {
    void profile.refetch();
    void stats.refetch();
    void entitlement.refetch();
    void watchlist.refetch();
  };

  return (
    <Screen>
      <OfflineBanner />
      <View className="flex-row items-center justify-between px-gutter pb-2 pt-2">
        <Text variant="brand" tone="ink">
          {t('brand.wordmark')}
        </Text>
        <IconButton icon={Settings} onPress={() => router.push('/settings')} accessibilityLabel={t('me.settings')} testID="profile.settings" />
      </View>
      <ScrollView
        contentContainerClassName="gap-5 px-gutter pb-8"
        refreshControl={<RefreshControl refreshing={profile.isRefetching} onRefresh={refresh} tintColor={colors.muted} />}
      >
        <View className="flex-row items-center gap-4">
          <Avatar name={name || t('me.avatar')} uri={profile.data?.avatarUrl} size={72} />
          <View className="flex-1 gap-1">
            {name ? <Text variant="h2">{name}</Text> : <Skeleton className="h-7 w-32 rounded-field" />}
            {identity ? (
              <Text variant="caption" tone="muted">
                {identity}
              </Text>
            ) : null}
            {stats.data ? (
              <Text variant="caption" tone="muted">
                {[
                  t('me.items', { count: stats.data.itemCount }),
                  t('me.looks', { count: stats.data.lookCount }),
                  t('me.followers', { count: stats.data.followerCount }),
                ].join(' · ')}
              </Text>
            ) : stats.isPending ? (
              <Skeleton className="h-4 w-40 rounded-field" />
            ) : null}
          </View>
          <IconButton icon={Pencil} onPress={() => router.push('/settings')} accessibilityLabel={t('me.editProfile')} />
        </View>

        {entitlement.data ? (
          isMember ? (
            <CreditCard entitlement={entitlement.data} hasBodyPhoto={photos.data ? photos.data.body.length > 0 : null} />
          ) : (
            <MembershipTeaser />
          )
        ) : entitlement.isError ? (
          <Card className="items-start gap-1 p-4">
            <Text variant="body" tone="muted">
              {t('me.creditsError')}
            </Text>
            <Button variant="text" label={t('common.retry')} onPress={() => void entitlement.refetch()} className="-ml-2" />
          </Card>
        ) : (
          <Skeleton className="h-40 w-full rounded-card" />
        )}

        <Card>
          <MenuRow first icon={ChartNoAxesColumn} label={t('me.menu.wardrobeStats')} onPress={() => router.navigate('/wardrobe')} />
          <MenuRow icon={Luggage} label={t('me.menu.tripArchive')} onPress={() => router.navigate('/wardrobe/trips')} />
          <MenuRow
            icon={PaletteIcon}
            label={t('me.menu.palette')}
            value={palette.data?.status === 'ready' ? t(`palette.season.${palette.data.seasonType}`) : undefined}
            onPress={() => router.push('/palette')}
          />
          <MenuRow
            icon={Bookmark}
            label={t('me.menu.watchlist')}
            trailing={drops > 0 ? <Badge tone="accent" label={t('me.menu.priceDrops', { count: drops })} /> : undefined}
            onPress={() => router.push('/watchlist')}
          />
          <MenuRow
            icon={Crown}
            label={t('me.menu.membership')}
            value={entitlement.data ? t(isMember ? 'me.menu.membershipActive' : 'me.menu.membershipFree') : undefined}
            onPress={() => router.push({ pathname: '/paywall', params: { from: 'profile' } })}
          />
          <MenuRow icon={Users} label={t('me.menu.family')} disabled trailing={<Badge label={t('common.comingSoon')} />} />
          <MenuRow icon={ShieldCheck} label={t('me.menu.settings')} onPress={() => router.push('/settings')} />
        </Card>

        {__DEV__ ? <Button variant="text" label={t('profile.components')} onPress={() => router.push('/dev/components')} /> : null}
      </ScrollView>
    </Screen>
  );
}
