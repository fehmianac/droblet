import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Ellipsis, Pencil, ShoppingBag, Sparkles, Sun, Tag, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ItemDetail } from '@/api/contracts/wardrobe';
import { Badge, ImageTag, PopoverMenu } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useDeleteItems, useUpdateItem } from '@/features/wardrobe/mutations';
import { DeleteConfirmSheet, itemImage, SeasonSheet } from '@/features/wardrobe/parts';
import { useItemDetail } from '@/features/wardrobe/queries';
import { currentLanguage } from '@/i18n';
import { toDisplayUpper } from '@/lib/upper';
import type { PlaceholderTone } from '@/theme/tokens';

/** Grounds of the look tiles on board 11, in order. */
const LOOK_TONES: PlaceholderTone[] = ['taupe', 'dark', 'clay'];

function DetailSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-[350px] w-full" />
      <View className="gap-3 px-gutter">
        <Skeleton className="h-3 w-40 rounded-field" />
        <Skeleton className="h-7 w-3/5 rounded-field" />
        <View className="flex-row gap-2">
          {[0, 1, 2, 3].map((i) => (
            <View key={i} className="flex-1">
              <Skeleton className="h-14 w-full rounded-image" />
            </View>
          ))}
        </View>
        <Skeleton className="h-32 w-full rounded-image-lg" />
      </View>
    </View>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();
  return (
    <View className="min-w-[72px] flex-1 gap-0.5 rounded-image border border-line bg-paper p-2.5" accessible accessibilityLabel={t('itemDetail.factA11y', { label, value })}>
      <Text variant="caption" tone="muted" numberOfLines={1} className="text-[11px]">
        {label}
      </Text>
      <Text variant="bodyMedium" numberOfLines={2} className="text-[13.5px]">
        {value}
      </Text>
    </View>
  );
}

/**
 * 11 Parça detayı — hero picture, edit, ⋯ menu (change season, delete), facts, the looks using the
 * piece, the phase-2 "Sat · Kiraya ver" slot, and "Bununla kombin yap" / completing products.
 */
export default function ItemDetailScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useItemDetail(id);
  const update = useUpdateItem();
  const deletion = useDeleteItems();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'season' | 'delete'>('none');
  const [deleted, setDeleted] = useState(false);

  // The piece is gone (deleted here or on another device): one sentence + the way back.
  if (deleted || (query.data === undefined && query.status === 'error' && query.fetchStatus === 'idle' && isMissing(query.error))) {
    return (
      <Screen bottom>
        <ScreenHeader leading="back" />
        <StateMessage message={t('itemDetail.goneTitle')} actionLabel={t('itemDetail.goneAction')} onAction={() => router.dismissTo('/wardrobe')} />
      </Screen>
    );
  }

  const top = insets.top + 6;
  // `LookRef.occasion` is a wire string; unknown values are shown as sent.
  const occasionLabels: Record<string, string> = {
    office: t('occasion.office'),
    dinner: t('occasion.dinner'),
    weekend: t('occasion.weekend'),
    wedding: t('occasion.wedding'),
    travel: t('occasion.travel'),
    sport: t('occasion.sport'),
    evening: t('occasion.evening'),
  };

  return (
    <Screen top={false}>
      <ScreenState
        query={query}
        skeleton={
          <View>
            <DetailSkeleton />
          </View>
        }
      >
        {(item: ItemDetail) => {
          const meta = t('itemDetail.metaLine', {
            category: t(`itemCategory.${item.category}`),
            seasons: item.seasons.map((s) => t(`itemSeason.${s}`)).join(', '),
          });
          return (
            <>
              <ScrollView contentContainerClassName="gap-3 pb-6">
                <ItemThumb category={item.category} color={item.color} uri={itemImage(item)} className="h-[350px] w-full" glyphSize={180} accessibilityLabel={item.name} />
                <View className="gap-3 px-gutter pt-1">
                  <View className="gap-1">
                    <Text variant="brand" tone="muted">
                      {toDisplayUpper(meta, currentLanguage())}
                    </Text>
                    <Text variant="h2">{item.name}</Text>
                    {item.brand ? (
                      <Text variant="caption" tone="muted">
                        {item.brand}
                      </Text>
                    ) : null}
                  </View>

                  <View className="flex-row flex-wrap gap-2">
                    <InfoCard label={t('itemDetail.size')} value={item.size ?? t('itemDetail.unknown')} />
                    <InfoCard label={t('itemDetail.color')} value={t(`itemColor.${item.color}`)} />
                    <InfoCard label={t('itemDetail.fabric')} value={item.fabric ?? t('itemDetail.unknown')} />
                    <InfoCard label={t('itemDetail.worn')} value={t('itemDetail.wornCount', { count: item.wearCount })} />
                  </View>

                  <View className="flex-row items-center justify-between gap-3 pt-1">
                    <Text variant="h3" className="flex-1">
                      {t('itemDetail.looksTitle')}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {t('itemDetail.looksCount', { count: item.looks.length })}
                    </Text>
                  </View>
                </View>

                {item.looks.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 px-gutter">
                    {item.looks.map((look, index) => {
                      const tone = LOOK_TONES[index % LOOK_TONES.length] ?? 'taupe';
                      return (
                        <Pressable
                          key={look.id}
                          onPress={() => router.push({ pathname: '/look/new', params: { id: look.id } })}
                          accessibilityRole="button"
                          accessibilityLabel={look.name}
                          className="active:opacity-80"
                        >
                          {/* Canvas: 104 × 132 tile, radius 14 — the standing figure on a toned ground until the look has a picture — with the occasion tag. */}
                          <ImageSlot
                            uri={look.imageUrl}
                            className="h-[132px] w-[104px] rounded-image-lg"
                            placeholder={{ kind: 'figure', tone, figureHeight: 100 }}
                          >
                            <ImageTag label={toDisplayUpper(occasionLabels[look.occasion] ?? look.occasion, currentLanguage())} className="absolute bottom-2 left-2" />
                          </ImageSlot>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <Text variant="body" tone="muted" className="px-gutter">
                    {t('itemDetail.noLooks')}
                  </Text>
                )}

                {/* Phase 2 (second-hand / rental): the slot is reserved, not interactive yet. */}
                <View className="mx-gutter flex-row items-center gap-2.5 rounded-image-lg border border-dashed border-line px-3 py-2.5">
                  <Icon icon={Tag} size={18} tone="muted" />
                  <Text variant="caption" tone="muted" className="flex-1">
                    {t('itemDetail.sellRent')}
                  </Text>
                  <Badge label={t('common.comingSoon')} />
                </View>
              </ScrollView>

              <BottomActionBar>
                <View className="flex-row items-center gap-3">
                  <Button
                    className="flex-1"
                    size="lg"
                    icon={Sparkles}
                    label={t('itemDetail.styleWith')}
                    onPress={() => router.navigate({ pathname: '/stylist', params: { itemId: item.id } })}
                  />
                  <Pressable
                    onPress={() => router.push({ pathname: '/shop', params: { itemId: item.id } })}
                    accessibilityRole="button"
                    accessibilityLabel={t('itemDetail.complete')}
                    className="h-btn-primary w-btn-primary items-center justify-center rounded-pill border border-ink active:opacity-70"
                  >
                    <Icon icon={ShoppingBag} size={18} />
                  </Pressable>
                </View>
              </BottomActionBar>

              <View className="absolute left-gutter right-gutter flex-row items-center justify-between" style={{ top }}>
                <IconButton icon={ChevronLeft} variant="inverse" onPress={() => router.back()} accessibilityLabel={t('a11y.back')} />
                <View className="flex-row gap-2">
                  <IconButton
                    icon={Pencil}
                    variant="inverse"
                    onPress={() => router.push({ pathname: '/item/form', params: { itemId: item.id } })}
                    accessibilityLabel={t('itemDetail.edit')}
                  />
                  <IconButton icon={Ellipsis} variant="inverse" onPress={() => setMenu(true)} accessibilityLabel={t('itemDetail.more')} />
                </View>
              </View>

              <PopoverMenu
                visible={menu}
                onClose={() => setMenu(false)}
                top={top + 50}
                actions={[
                  { key: 'season', label: t('itemDetail.changeSeason'), icon: Sun, onPress: () => setSheet('season') },
                  { key: 'delete', label: t('itemDetail.deleteAction'), icon: Trash2, destructive: true, onPress: () => setSheet('delete') },
                ]}
              />
              <SeasonSheet
                visible={sheet === 'season'}
                onClose={() => setSheet('none')}
                initial={item.seasons}
                onSave={(seasons) => {
                  update.setSeasons([item], seasons);
                  setSheet('none');
                }}
              />
              <DeleteConfirmSheet
                visible={sheet === 'delete'}
                onClose={() => setSheet('none')}
                title={t('itemDetail.deleteTitle')}
                body={t('itemDetail.deleteBody')}
                confirmLabel={t('itemDetail.deleteAction')}
                onConfirm={() => {
                  setSheet('none');
                  setDeleted(true);
                  deletion.remove([item.id]);
                  router.dismissTo('/wardrobe');
                }}
              />
            </>
          );
        }}
      </ScreenState>
      {query.data === undefined ? (
        <View className="absolute left-gutter" style={{ top }}>
          <IconButton icon={ChevronLeft} variant="inverse" onPress={() => router.back()} accessibilityLabel={t('a11y.back')} />
        </View>
      ) : null}
    </Screen>
  );
}

function isMissing(error: unknown): boolean {
  if (error instanceof Error && error.name === 'FixtureNotFound') return true;
  return typeof error === 'object' && error !== null && 'status' in error && (error as { status: unknown }).status === 404;
}
