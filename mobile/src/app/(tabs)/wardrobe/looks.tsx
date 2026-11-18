import { router } from 'expo-router';
import { Heart, Plus, Star } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';

import type { Look } from '@/api/contracts/looks';
import { ImageTag } from '@/components/ui/Bits';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { useLookWrites } from '@/features/looks/api';
import { indexItems, LookCover, type ItemsById } from '@/features/looks/LookCover';
import { filterLooks, LOOK_FILTERS, type LookFilter } from '@/features/looks/logic';
import { useLooks } from '@/features/looks/queries';
import { useItems } from '@/features/wardrobe/queries';
import { WardrobeHeader } from '@/features/wardrobe/WardrobeHeader';
import { currentLanguage } from '@/i18n';
import { formatNumber } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useThemeColors } from '@/theme/useThemeColors';

function LooksSkeleton() {
  return (
    <View className="flex-row flex-wrap gap-x-3 gap-y-3.5 px-gutter pt-2">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className="w-[47%] grow gap-2">
          <Skeleton className="h-[210px] w-full rounded-image-lg" />
          <Skeleton className="h-3 w-3/4 rounded-field" />
        </View>
      ))}
    </View>
  );
}

function LookTile({ look, itemsById, onToggleFavorite }: { look: Look; itemsById: ItemsById; onToggleFavorite: () => void }) {
  const { t } = useTranslation();
  const occasion = t(`occasion.${look.occasion}`);
  const rating = look.rating !== null ? formatNumber(look.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : null;
  return (
    <View className="flex-1">
      <Pressable
        onPress={() => router.push({ pathname: '/look/[id]', params: { id: look.id } })}
        accessibilityRole="button"
        accessibilityLabel={rating ? t('looks.cardLabelRated', { occasion, name: look.name, rating }) : t('looks.cardLabel', { occasion, name: look.name })}
        className="gap-2 active:opacity-80"
      >
        <LookCover seed={look.id} tryOnImageUrl={look.tryOnImageUrl} slots={look.slots} itemsById={itemsById} className="h-[210px] w-full rounded-image-lg">
          <ImageTag label={toDisplayUpper(occasion, currentLanguage())} className="absolute bottom-2 left-2" />
        </LookCover>
        <View className="flex-row items-center justify-between gap-2">
          <Text variant="segment" numberOfLines={1} className="flex-1">
            {look.name}
          </Text>
          {rating ? (
            <View className="flex-row items-center gap-[3px]">
              <Icon icon={Star} size={13} />
              <Text variant="caption">{rating}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {/* 32 pt paper circle on the image (canvas); the touch target is widened to 44 with hitSlop. */}
      <Pressable
        onPress={onToggleFavorite}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityState={{ selected: look.isFavorite }}
        accessibilityLabel={t(look.isFavorite ? 'looks.favoriteRemove' : 'looks.favoriteAdd', { name: look.name })}
        className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-pill bg-paper/90 active:opacity-70"
      >
        <Icon icon={Heart} size={16} filled={look.isFavorite} />
      </Pressable>
    </View>
  );
}

/** 14 Looklar — the lookbook: filter chips, 2-column grid, heart, friends' rating. */
export default function WardrobeLooksScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const looks = useLooks();
  const items = useItems();
  const writes = useLookWrites();
  const [filter, setFilter] = useState<LookFilter>('all');
  const itemsById = indexItems(items.data);
  const createLook = () => router.push('/look/new');

  return (
    <>
      <WardrobeHeader
        current="looks"
        eyebrow={t('looks.eyebrow')}
        title={looks.data ? t('looks.count', { count: looks.data.length }) : undefined}
        actions={<IconButton icon={Plus} variant="filled" onPress={createLook} accessibilityLabel={t('looks.create')} testID="looks.create" />}
      />
      <ScreenState
        query={looks}
        skeleton={<LooksSkeleton />}
        isEmpty={(data) => data.length === 0}
        empty={{ message: t('looks.empty'), actionLabel: t('looks.create'), onAction: createLook }}
      >
        {(data) => {
          const shown = filterLooks(data, filter);
          return (
            <View className="flex-1">
              <View>
                <ChipRow>
                  {LOOK_FILTERS.map((f) => (
                    <Chip
                      key={f}
                      label={f === 'all' ? t('looks.filterAll') : f === 'favorites' ? t('looks.filterFavorites') : t(`occasion.${f}`)}
                      selected={filter === f}
                      onPress={() => setFilter(f)}
                    />
                  ))}
                </ChipRow>
              </View>
              {shown.length === 0 ? (
                <StateMessage message={t('looks.filteredEmpty')} actionLabel={t('looks.showAll')} onAction={() => setFilter('all')} />
              ) : (
                <FlatList
                  data={shown}
                  keyExtractor={(look) => look.id}
                  numColumns={2}
                  columnWrapperClassName="gap-3"
                  contentContainerClassName="gap-3.5 px-gutter pb-8 pt-2.5"
                  refreshControl={
                    <RefreshControl refreshing={looks.isRefetching} onRefresh={() => void looks.refetch()} tintColor={colors.muted} />
                  }
                  renderItem={({ item, index }) => (
                    <>
                      <LookTile look={item} itemsById={itemsById} onToggleFavorite={() => writes.toggleFavorite(item)} />
                      {/* Keep a lone last tile at half width. */}
                      {shown.length % 2 === 1 && index === shown.length - 1 ? <View className="flex-1" /> : null}
                    </>
                  )}
                />
              )}
            </View>
          );
        }}
      </ScreenState>
    </>
  );
}
