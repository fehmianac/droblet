import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { ChevronRight, Search } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { CreatorCard, WeeklyEditSummary } from '@/api/contracts/store';
import { CartButton, SectionState } from '@/components/blocks/SectionState';
import { Logo } from '@/components/brand/Logo';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenState } from '@/components/ui/ScreenState';
import { Silhouette } from '@/components/ui/Silhouette';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { CreatorCardView } from '@/features/store/CreatorCardView';
import { useCreators, useCurrentEdit, useSeriesOutfits } from '@/features/store/queries';
import { currentLanguage } from '@/i18n';
import { formatIsoDateRange } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { inkFade, placeholderTones } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

type DiscoverSection = 'editor' | 'influencer' | 'series';

function EditorSkeleton() {
  return (
    <View className="gap-4 pt-1.5">
      <Skeleton className="mx-gutter h-[290px] rounded-card" />
      <Skeleton className="mx-gutter h-6 w-48 rounded-field" />
      <CreatorStripSkeleton />
    </View>
  );
}

function CreatorStripSkeleton() {
  return (
    <View className="flex-row gap-2.5 px-gutter">
      {[0, 1, 2].map((i) => (
        <View key={i} className="w-[132px] gap-1.5">
          <Skeleton className="h-[170px] w-full rounded-image-lg" />
          <Skeleton className="h-4 w-24 rounded-field" />
        </View>
      ))}
    </View>
  );
}

function CreatorGrid({ creators }: { creators: CreatorCard[] }) {
  const rows: CreatorCard[][] = [];
  for (let i = 0; i < creators.length; i += 2) rows.push(creators.slice(i, i + 2));
  return (
    <View className="gap-5 px-gutter">
      {rows.map((row) => (
        <View key={row[0]?.id} className="flex-row gap-3">
          {row.map((c) => (
            <CreatorCardView key={c.id} creator={c} className="flex-1" />
          ))}
          {row.length === 1 ? <View className="flex-1" /> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * The weekly edit cover of 20: a 290-high photograph (radius 20) with the eyebrow, the serif title and
 * the meta line set on an ink fade at its foot. Opens the edit (20b).
 */
function EditCover({ edit }: { edit: WeeklyEditSummary }) {
  const { t } = useTranslation();
  const eyebrow = t('explore.editEyebrow', {
    range: toDisplayUpper(formatIsoDateRange(edit.startDate, edit.endDate), currentLanguage()),
  });
  const meta = t('explore.editMeta', { count: edit.lookCount });
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/edit/[id]', params: { id: edit.id } })}
      accessibilityRole="button"
      accessibilityLabel={[eyebrow, edit.title, meta].join(', ')}
      className="mx-gutter h-[290px] items-center justify-center overflow-hidden rounded-card active:opacity-90"
      style={{ backgroundColor: placeholderTones.dark }}
    >
      {edit.imageUrl ? (
        <PlaceholderImage uri={edit.imageUrl} className="absolute inset-0" />
      ) : (
        <Silhouette height={180} tone="cream" />
      )}
      <LinearGradient colors={[inkFade.clear, inkFade.deep]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 18 }}>
        <Text variant="eyebrow" tone="cream">
          {eyebrow}
        </Text>
        <Text variant="h2" tone="cream" className="mt-1.5 text-[28px] leading-[30px]" numberOfLines={2}>
          {edit.title}
        </Text>
        <Text variant="chip" tone="cream" className="mt-1.5">
          {meta}
        </Text>
      </LinearGradient>
    </Pressable>
  );
}

/**
 * 20 Keşfet — the logo header with search and the cart (count dot), the chips (Editör · Mağaza ·
 * Influencer · Arkadaşlar · Dizi outfitleri), the weekly edit cover and the creator looks strip (with
 * the "SPONSORLU" tag). Mağaza and Arkadaşlar open their own screens (21, 25); "Tümü" opens the feed (25).
 */
export default function DiscoverTab() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [section, setSection] = useState<DiscoverSection>('editor');
  const edit = useCurrentEdit();
  const creators = useCreators();
  const series = useSeriesOutfits(section === 'series');

  const refresh = () => {
    void edit.refetch();
    void creators.refetch();
  };

  return (
    <Screen>
      <View className="h-12 flex-row items-center justify-between px-gutter">
        <Logo />
        <View className="flex-row gap-2">
          <IconButton icon={Search} onPress={() => router.push('/shop')} accessibilityLabel={t('explore.search')} />
          <CartButton />
        </View>
      </View>
      <View className="pt-0.5">
        <ChipRow>
          <Chip label={t('discover.chipEditor')} selected={section === 'editor'} onPress={() => setSection('editor')} />
          <Chip label={t('discover.chipShop')} onPress={() => router.push('/shop')} />
          <Chip label={t('discover.chipInfluencer')} selected={section === 'influencer'} onPress={() => setSection('influencer')} />
          <Chip label={t('discover.chipFriends')} onPress={() => router.push('/friends/feed')} />
          <Chip label={t('discover.chipSeries')} selected={section === 'series'} onPress={() => setSection('series')} />
        </ChipRow>
      </View>

      {section === 'editor' ? (
        <ScreenState
          query={edit}
          skeleton={<EditorSkeleton />}
          isEmpty={(data) => data === null}
          empty={{ message: t('explore.editEmpty'), actionLabel: t('explore.editEmptyAction'), onAction: () => router.push('/shop') }}
        >
          {(data) =>
            data ? (
              <ScrollView
                contentContainerClassName="gap-4 pb-8 pt-2.5"
                refreshControl={<RefreshControl refreshing={edit.isRefetching} onRefresh={refresh} tintColor={colors.muted} />}
              >
                <EditCover edit={data} />

                <View className="gap-4">
                  <View className="flex-row items-center justify-between px-gutter">
                    <Text variant="h3">{t('explore.creatorLooks')}</Text>
                    <Pressable
                      onPress={() => router.push('/friends/feed')}
                      accessibilityRole="link"
                      accessibilityLabel={t('explore.creatorLooksAll')}
                      hitSlop={8}
                      className="min-h-icon-btn flex-row items-center gap-0.5 active:opacity-70"
                    >
                      <Text variant="label">{t('common.seeAll')}</Text>
                      <Icon icon={ChevronRight} size={14} />
                    </Pressable>
                  </View>
                  <SectionState
                    query={creators}
                    skeleton={<CreatorStripSkeleton />}
                    isEmpty={(list) => list.length === 0}
                    emptyText={t('explore.creatorsEmpty')}
                  >
                    {(list) => (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 px-gutter">
                        {list.map((c) => (
                          <CreatorCardView key={c.id} creator={c} />
                        ))}
                      </ScrollView>
                    )}
                  </SectionState>
                </View>
              </ScrollView>
            ) : null
          }
        </ScreenState>
      ) : null}

      {section === 'influencer' ? (
        <ScreenState
          query={creators}
          skeleton={
            <View className="pt-3">
              <CreatorStripSkeleton />
            </View>
          }
          isEmpty={(list) => list.length === 0}
          empty={{
            message: t('explore.creatorsEmpty'),
            actionLabel: t('explore.creatorsEmptyAction'),
            onAction: () => router.push('/friends/find'),
          }}
        >
          {(list) => (
            <ScrollView
              contentContainerClassName="pb-8 pt-3"
              refreshControl={
                <RefreshControl refreshing={creators.isRefetching} onRefresh={() => void creators.refetch()} tintColor={colors.muted} />
              }
            >
              <CreatorGrid creators={list} />
            </ScrollView>
          )}
        </ScreenState>
      ) : null}

      {section === 'series' ? (
        <ScreenState
          query={series}
          skeleton={
            <View className="pt-3">
              <CreatorStripSkeleton />
            </View>
          }
          isEmpty={(list) => list.length === 0}
          empty={{ message: t('explore.seriesEmpty'), actionLabel: t('explore.seriesEmptyAction'), onAction: () => setSection('editor') }}
        >
          {(list) => (
            <ScrollView contentContainerClassName="gap-5 px-gutter pb-8 pt-3">
              {list.map((outfit) => (
                <View key={outfit.id} className="gap-2">
                  <PlaceholderImage uri={outfit.imageUrl} className="aspect-[4/5] w-full rounded-image-lg" />
                  <Text variant="caption" tone="muted">
                    {outfit.seriesName}
                  </Text>
                  <Text variant="bodyMedium">{outfit.title}</Text>
                </View>
              ))}
            </ScrollView>
          )}
        </ScreenState>
      ) : null}
    </Screen>
  );
}
