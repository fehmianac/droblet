import { router } from 'expo-router';
import { Search } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';

import type { CreatorCard } from '@/api/contracts/store';
import { CartButton, SectionState } from '@/components/blocks/SectionState';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { CreatorCardView } from '@/features/store/CreatorCardView';
import { useCreators, useCurrentEdit, useSeriesOutfits } from '@/features/store/queries';
import { currentLanguage } from '@/i18n';
import { formatDateRange } from '@/lib/dates';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

type DiscoverSection = 'editor' | 'influencer' | 'series';

function EditorSkeleton() {
  return (
    <View className="gap-5 px-gutter pt-3">
      <Skeleton className="aspect-[4/5] w-full rounded-card" />
      <Skeleton className="h-6 w-48 rounded-field" />
      <CreatorStripSkeleton />
    </View>
  );
}

function CreatorStripSkeleton() {
  return (
    <View className="flex-row gap-3 px-gutter">
      {[0, 1, 2].map((i) => (
        <View key={i} className="w-36 gap-2">
          <Skeleton className="aspect-[3/4] w-full rounded-image-lg" />
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
 * 20 Keşfet — chips (Editör · Mağaza · Influencer · Arkadaşlar · Dizi outfitleri), the weekly edit
 * cover, the creator looks strip (with the "Sponsorlu" label) and the cart icon with its badge.
 * Mağaza and Arkadaşlar open their own screens (21, 25).
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
      <View className="flex-row items-center justify-between px-gutter pb-2 pt-2">
        <View className="gap-1">
          <Text variant="eyebrow">{t('brand.wordmark')}</Text>
          <Text variant="display">{t('discover.title')}</Text>
        </View>
        <View className="flex-row gap-2">
          <IconButton icon={Search} onPress={() => router.push('/shop')} accessibilityLabel={t('explore.search')} />
          <CartButton />
        </View>
      </View>
      <View>
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
                contentContainerClassName="gap-6 pb-8 pt-3"
                refreshControl={<RefreshControl refreshing={edit.isRefetching} onRefresh={refresh} tintColor={colors.muted} />}
              >
                <Pressable
                  onPress={() => router.push({ pathname: '/edit/[id]', params: { id: data.id } })}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('screens.edit')}, ${data.title}`}
                  className="mx-gutter overflow-hidden rounded-card border border-line bg-paper active:opacity-90"
                >
                  <PlaceholderImage uri={data.imageUrl} className="aspect-[4/5] w-full" />
                  <View className="gap-1 p-4">
                    <Text variant="eyebrow">
                      {t('explore.editEyebrow', {
                        range: toDisplayUpper(formatDateRange(data.startDate, data.endDate), currentLanguage()),
                      })}
                    </Text>
                    <Text variant="h2">{data.title}</Text>
                    <Text variant="body" tone="muted">
                      {t('explore.editMeta', { count: data.lookCount })}
                    </Text>
                  </View>
                </Pressable>

                <View className="gap-3">
                  <View className="flex-row items-center justify-between px-gutter">
                    <Text variant="h3">{t('explore.creatorLooks')}</Text>
                    <Button variant="text" label={t('common.seeAll')} onPress={() => setSection('influencer')} />
                  </View>
                  <SectionState
                    query={creators}
                    skeleton={<CreatorStripSkeleton />}
                    isEmpty={(list) => list.length === 0}
                    emptyText={t('explore.creatorsEmpty')}
                  >
                    {(list) => (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-gutter">
                        {list.map((c) => (
                          <CreatorCardView key={c.id} creator={c} className="w-36" />
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
