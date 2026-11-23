import { router } from 'expo-router';
import {
  Bookmark,
  BookmarkCheck,
  Briefcase,
  Check,
  CircleAlert,
  Crown,
  Lock,
  Palette as PaletteIcon,
  Pencil,
  Settings,
  ShieldCheck,
  Tag,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { Entitlement } from '@/api/contracts';
import { useSession } from '@/auth/session';
import { Card } from '@/components/blocks/basics';
import { Logo } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { useMyPhotos, useMyProfile, usePalette, useProfileStats } from '@/features/account/queries';
import { ProfileMenuRow, RowCard } from '@/features/account/rows';
import { TestPushRow } from '@/features/account/TestPushRow';
import { creditSheetStore } from '@/features/credits/creditSheetStore';
import { ProfileCompleteCard } from '@/features/requirements/ProfileCompleteCard';
import { useSegment } from '@/features/segment/store';
import { useAvailableSegments } from '@/features/segment/useAvailableSegments';
import { useIncomingRequestCount } from '@/features/social/queries';
import { priceDropPercent } from '@/features/store/cartMath';
import { useWatchlist } from '@/features/store/queries';
import { openParentStatus } from '@/features/teen/TeenLocks';
import { useTeenRules } from '@/features/teen/store';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDayMonth, formatMonthName } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * AI credit counter, drawn as on 28: an ink card with cream text, the month's allowance bar, the photo
 * status and "Kredi yükle" (→ 05b). Every number comes from `GET v1/tenant/entitlement`; nothing is fixed in the app.
 */
function CreditCard({ entitlement, hasBodyPhoto, teen = false }: { entitlement: Entitlement; hasBodyPhoto: boolean | null; teen?: boolean }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const language = useAppLanguage();
  const { monthlyAllowance, remaining, resetsAt } = entitlement.credits;
  // The month's allowance and the extra credits (packs, grants) are shown apart.
  const allowanceLeft = Math.min(entitlement.credits.allowanceRemaining ?? remaining, monthlyAllowance);
  const extra = entitlement.credits.extraRemaining ?? Math.max(0, remaining - allowanceLeft);
  const renewal = new Date(resetsAt);
  // The allowance belongs to the month before the renewal date.
  const month = new Date(renewal.getFullYear(), renewal.getMonth() - 1, 1);
  const left = t('me.creditsLeft', { total: monthlyAllowance, remaining: suffixed(allowanceLeft, 'possessive', language) });
  const share = monthlyAllowance > 0 ? Math.min(1, Math.max(0, allowanceLeft / monthlyAllowance)) : 0;
  const soft = { color: colors.sand };

  return (
    <View className="gap-2.5 rounded-card bg-ink p-3.5" testID="credit-card">
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Text variant="eyebrow" style={soft}>
          {t('me.creditsEyebrow', { month: toDisplayUpper(formatMonthName(month), language) })}
        </Text>
        <Text variant="caption" style={soft}>
          {t('me.renews', { date: suffixed(formatDayMonth(renewal), 'locative', language) })}
        </Text>
      </View>
      <Text variant="title" tone="cream">
        {left}
      </Text>
      {extra > 0 ? (
        <Text variant="caption" style={soft} testID="credit-card-extra">
          {t('me.creditsExtra', { count: extra })}
        </Text>
      ) : null}
      <View
        className="h-1.5 overflow-hidden rounded-pill bg-cream/20"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={left}
        accessibilityValue={{ min: 0, max: monthlyAllowance, now: allowanceLeft }}
      >
        <View className="h-full rounded-pill bg-cream" style={{ width: `${Math.round(share * 100)}%` }} />
      </View>
      {/* Canvas 18 · 28 Profil · genç: the counter only — no photo line, no "Kredi yükle". */}
      {teen ? null : (
      <View className="flex-row items-center justify-between gap-2.5">
        {hasBodyPhoto === null ? (
          <View className="flex-1" />
        ) : (
          <View className="flex-1 flex-row items-center gap-1.5">
            <Icon icon={hasBodyPhoto ? Check : CircleAlert} size={15} tone="sand" />
            <Text variant="caption" style={soft} className="flex-1">
              {t(hasBodyPhoto ? 'me.photoReady' : 'me.photoOptional')}
            </Text>
          </View>
        )}
        <Pressable
          onPress={() => creditSheetStore.open('topUp')}
          accessibilityRole="button"
          accessibilityLabel={t('me.topUp')}
          hitSlop={{ top: 2, bottom: 2 }}
          className="h-10 items-center justify-center rounded-pill bg-cream px-4 active:opacity-80"
        >
          <Text variant="segment" tone="ink" numberOfLines={1}>
            {t('me.topUp')}
          </Text>
        </Pressable>
      </View>
      )}
    </View>
  );
}

/** Non-members see what membership adds and a way to the paywall instead of the counter (canvas "28 Profil · ücretsiz plan"). */
function MembershipTeaser() {
  const { t } = useTranslation();
  return (
    <Card className="flex-row items-center gap-3 px-3.5 py-3">
      <View className="flex-1 gap-0.5">
        <Text variant="h3">{t('me.teaserTitle')}</Text>
        <Text variant="caption" tone="muted">
          {t('me.teaserBody')}
        </Text>
      </View>
      <Pressable
        onPress={() => router.push({ pathname: '/paywall', params: { from: 'profile' } })}
        accessibilityRole="button"
        accessibilityLabel={t('me.teaserAction')}
        testID="profile.membership"
        className="h-10 items-center justify-center rounded-pill bg-ink px-3.5 active:opacity-80"
      >
        <Text variant="segment" tone="cream" numberOfLines={1}>
          {t('me.teaserAction')}
        </Text>
      </Pressable>
    </Card>
  );
}

/** "86 parça": the number in medium weight, the word regular — as the canvas draws the stats line. */
function Stat({ label }: { label: string }) {
  const space = label.indexOf(' ');
  if (space < 0) return <Text variant="label">{label}</Text>;
  return (
    <>
      <Text variant="label">{label.slice(0, space)}</Text>
      {label.slice(space)}
    </>
  );
}

/**
 * 28 Profil — logo header + settings, who you are (photo, name, handle · style, numbers, "Profili düzenle"),
 * the AI credit counter ("Bu ay 30 görselden N'si kaldı" + "Kredi yükle" → 05b) and the menu exactly as
 * drawn: Gardırop istatistikleri, Seyahat arşivi, Renk paletim, İzleme listem, Üyelik, Aile planı
 * ("Yakında"), Gizlilik, fotoğraflar ve ayarlar. Tab root: the bottom menu is the tab navigator's.
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
  const teen = useTeenRules();
  // Canvas 18: a teen's profile asks nothing of the store or social APIs (closed to them, docs/api/teen.md §4.1).
  const watchlist = useWatchlist(!teen.hide.commerce);
  const requestCount = useIncomingRequestCount(!teen.hide.social);
  const segment = useSegment();
  const segments = useAvailableSegments();

  const name = profile.data?.displayName ?? (session.status === 'signedIn' ? session.user.name : '');
  const tags = (profile.data?.styleTags ?? []).slice(0, 2).map((tag) => t(`style.tags.${tag}`));
  // Canvas 18: a teen has no @username (no social); "Genç hesap" takes its place.
  const identity = [teen.isTeen ? t('teen.profile.subtitle') : profile.data?.handle ? `@${profile.data.handle}` : null, ...tags].filter(Boolean).join(' · ');
  const drops = (watchlist.data?.items ?? []).filter((i) => priceDropPercent(i.price, i.previousPrice) !== null).length;
  const isMember = entitlement.data?.tier === 'member';
  const membership = !entitlement.data
    ? undefined
    : !isMember
      ? t('me.menu.membershipFree')
      : entitlement.data.plan
        ? t(`me.menu.plan.${entitlement.data.plan}`)
        : t('me.menu.membershipActive');

  const refresh = () => {
    void profile.refetch();
    void stats.refetch();
    void entitlement.refetch();
    void watchlist.refetch();
    void photos.refetch();
    void palette.refetch();
  };

  return (
    <Screen>
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Logo />
        <IconButton icon={Settings} onPress={() => router.push('/settings')} accessibilityLabel={t('me.settings')} testID="profile.settings" />
      </View>
      <ScrollView
        contentContainerClassName="gap-3 px-gutter pb-8 pt-1"
        refreshControl={<RefreshControl refreshing={profile.isRefetching} onRefresh={refresh} tintColor={colors.muted} />}
      >
        <View className="flex-row items-center gap-3.5">
          <ImageSlot
            uri={profile.data?.avatarUrl}
            className="h-16 w-16 rounded-pill"
            accessibilityLabel={profile.data?.avatarUrl ? t('me.avatar') : undefined}
            placeholder={{ kind: 'avatar', name: name || profile.data?.handle }}
          />
          <View className="flex-1">
            {name ? (
              <Text variant="h2" numberOfLines={1}>
                {name}
              </Text>
            ) : (
              <Skeleton className="h-7 w-32 rounded-field" />
            )}
            {identity ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {identity}
              </Text>
            ) : null}
            {stats.data ? (
              <Text variant="caption" className="mt-0.5" testID="profile-stats">
                <Stat label={t('me.items', { count: stats.data.itemCount })} />
                {' · '}
                <Stat label={t('me.looks', { count: stats.data.lookCount })} />
                {teen.hide.social ? null : (
                  <>
                    {' · '}
                    <Stat label={t('me.followers', { count: stats.data.followerCount })} />
                  </>
                )}
              </Text>
            ) : stats.isPending ? (
              <Skeleton className="mt-1 h-4 w-40 rounded-field" />
            ) : null}
          </View>
          <IconButton icon={Pencil} iconSize={18} onPress={() => router.push('/edit-profile')} accessibilityLabel={t('me.editProfile')} />
        </View>

        {/* "Profilini tamamla" (canvas 11) — the @username is one of its six items. */}
        <ProfileCompleteCard testID="profile.profileComplete" />

        {teen.hide.paywall ? (
          entitlement.data && entitlement.data.credits.monthlyAllowance > 0 ? (
            <CreditCard entitlement={entitlement.data} hasBodyPhoto={null} teen />
          ) : null
        ) : entitlement.data ? (
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
          <Skeleton className="h-36 w-full rounded-card" />
        )}

        <RowCard>
          {teen.isTeen ? (
            <ProfileMenuRow
              first
              icon={ShieldCheck}
              label={t('teen.profile.consentRow')}
              trailing={<Badge label={t(`teen.profile.status.${teen.consent}`)} />}
              onPress={() => openParentStatus(teen.consent !== 'pending' && teen.consent !== 'approved')}
              testID="profile.parentConsent"
            />
          ) : null}
          <ProfileMenuRow
            first={!teen.isTeen}
            icon={Tag}
            label={t('me.menu.styleProfile')}
            value={segments.choice ? t(`style.segment.${segment}`) : undefined}
            onPress={() => router.push('/style-profile')}
            testID="profile.styleProfile"
          />
          <ProfileMenuRow icon="hanger" label={t('me.menu.wardrobeStats')} onPress={() => router.navigate('/wardrobe')} />
          <ProfileMenuRow icon={Briefcase} label={t('me.menu.tripArchive')} onPress={() => router.navigate('/wardrobe/trips')} />
          {/* Teen: social is closed, but its saved Akış posts (editor content) stay reachable. */}
          {teen.hide.social ? (
            <ProfileMenuRow
              icon={BookmarkCheck}
              label={t('friends.menuSaved')}
              onPress={() => router.push({ pathname: '/friends/saved', params: { tab: 'feed' } })}
              testID="profile.savedFeed"
            />
          ) : null}
          {teen.hide.social ? null : (
            <>
              <ProfileMenuRow
                icon={UserCheck}
                label={t('friends.menuRequests')}
                trailing={requestCount > 0 ? <Badge tone="accent" label={String(requestCount)} /> : undefined}
                onPress={() => router.push('/friends/requests')}
              />
              <ProfileMenuRow icon={BookmarkCheck} label={t('friends.menuSaved')} onPress={() => router.push('/friends/saved')} />
              <ProfileMenuRow icon={Users} label={t('friends.followersTitle')} onPress={() => router.push('/friends/followers')} />
              <ProfileMenuRow icon={UserPlus} label={t('friends.followingTitle')} onPress={() => router.push('/friends/following')} />
            </>
          )}
          <ProfileMenuRow
            icon={PaletteIcon}
            label={t('me.menu.palette')}
            value={palette.data?.status === 'ready' ? t(`palette.season.${palette.data.seasonType}`) : undefined}
            onPress={() => router.push('/palette')}
          />
          {teen.hide.commerce ? null : (
            <ProfileMenuRow
              icon={Bookmark}
              label={t('me.menu.watchlist')}
              trailing={drops > 0 ? <Badge tone="accent" label={t('me.menu.priceDrops', { count: drops })} /> : undefined}
              onPress={() => router.push('/watchlist')}
            />
          )}
          {teen.hide.paywall ? null : (
            <>
              <ProfileMenuRow
                icon={Crown}
                label={t('me.menu.membership')}
                value={membership}
                onPress={() => (isMember ? router.push('/subscription') : router.push({ pathname: '/paywall', params: { from: 'profile' } }))}
              />
              <ProfileMenuRow icon={Users} label={t('me.menu.family')} disabled trailing={<Badge label={t('common.comingSoon')} />} />
            </>
          )}
          <ProfileMenuRow icon={Lock} label={t('me.menu.settings')} onPress={() => router.push('/settings')} />
          <TestPushRow />
        </RowCard>

        {__DEV__ ? <Button variant="text" label={t('profile.components')} onPress={() => router.push('/dev/components')} /> : null}
      </ScrollView>
    </Screen>
  );
}

/** A render error in this tab shows the error state with "Tekrar dene"; the tab bar and the other tabs keep working. */
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/ScreenErrorBoundary';
