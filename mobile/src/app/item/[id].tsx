import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Ellipsis, Pencil, Plus, ShoppingBag, Sparkles, Sun, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ItemDetail, ItemPreview } from '@/api/contracts/wardrobe';
import { isNotFound } from '@/api/errors';
import { itemImageSource, itemViewerSource } from '@/api/imageSources';
import { ImageTag, PopoverMenu } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Zoomable } from '@/components/ui/viewer';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { ModeratedNote } from '@/features/moderation/ModeratedNote';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useDeleteItems, useUpdateItem } from '@/features/wardrobe/mutations';
import { DeleteConfirmSheet, SeasonSheet } from '@/features/wardrobe/parts';
import { isItemDetail, useItemDetailWithPreview } from '@/features/wardrobe/queries';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { toDisplayUpper } from '@/lib/upper';
import type { PlaceholderTone } from '@/theme/tokens';
import { useTeenRules } from '@/features/teen/store';

/** Grounds of the look tiles on board 11, in order. */
const LOOK_TONES: PlaceholderTone[] = ['taupe', 'dark', 'clay'];
/** 11′: value-line widths of the four fact cards while the detail loads (Beden, Renk, Kumaş, Giyildi). */
const FACT_SKELETON_WIDTHS = ['w-7', 'w-[52px]', 'w-[38px]', 'w-11'] as const;

/** One fact card; `value` null = still loading (11′: the label stays, a shimmering line holds the value's place). */
function InfoCard({ label, value, skeletonWidth }: { label: string; value: string | null; skeletonWidth: string }) {
  const { t } = useTranslation();
  return (
    <View
      className="min-w-[72px] flex-1 gap-0.5 rounded-image border border-line bg-paper p-2.5"
      accessible
      accessibilityLabel={value === null ? t('itemDetail.factLoadingA11y', { label }) : t('itemDetail.factA11y', { label, value })}
    >
      <Text variant="caption" tone="muted" numberOfLines={1} className="text-[11px]">
        {label}
      </Text>
      {value === null ? (
        <Skeleton sweep className={`mt-1 h-[13px] rounded-[5px] ${skeletonWidth}`} />
      ) : (
        <Text variant="bodyMedium" numberOfLines={2} className="text-[13.5px]">
          {value}
        </Text>
      )}
    </View>
  );
}

type ContentProps = {
  /** What is known: the list's preview, the detail, or nothing yet (deep link, first load). */
  item: ItemPreview | null;
  /** The whole detail once it arrived; until then season, facts, looks and the edit / ⋯ / shop buttons are skeletons. */
  detail: ItemDetail | null;
  top: number;
  onMore: () => void;
};

/**
 * The page of 11, drawn with whatever is known (canvas 11′ "liste verisiyle anında"): opened from the grid, the photo,
 * category, name and the two main buttons come at once and only the missing parts shimmer; with nothing known the
 * same layout is all skeleton. One layout for every stage, so nothing moves when the detail lands.
 */
function ItemContent({ item, detail, top, onMore }: ContentProps) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const hideCommerce = useTeenRules().hide.commerce;
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
  const category = item ? t(`itemCategory.${item.category}`) : '';
  const meta = detail
    ? t('itemDetail.metaLine', { category, seasons: detail.seasons.map((s) => t(`itemSeason.${s}`)).join(', ') })
    : t('itemDetail.metaCategory', { category });
  // 13a: the full image in the viewer (the cached medium hero stays the tile).
  const viewerImage = item ? itemViewerSource(item, 'medium') : null;
  const facts = [
    { key: 'size', label: t('itemDetail.size'), value: detail ? (detail.size ?? t('itemDetail.unknown')) : null },
    { key: 'color', label: t('itemDetail.color'), value: detail ? t(`itemColor.${detail.color}`) : null },
    { key: 'fabric', label: t('itemDetail.fabric'), value: detail ? (detail.fabric ?? t('itemDetail.unknown')) : null },
    { key: 'worn', label: t('itemDetail.worn'), value: detail ? t('itemDetail.wornCount', { count: detail.wearCount }) : null },
  ];

  return (
    <>
      <ScrollView contentContainerClassName="gap-3 pb-6" accessibilityState={{ busy: !detail }}>
        {item ? (
          // 13a: the item photo opens full screen (a glyph placeholder does not).
          <Zoomable images={viewerImage ? [{ ...viewerImage, label: item.name }] : []} disabled={!viewerImage} accessibilityLabel={item.name} testID="item-image-zoom">
            <ItemThumb
              category={item.category}
              subcategory={item.subcategory}
              color={item.color}
              {...itemImageSource(item, 'medium')}
              className="h-[350px] w-full"
              glyphSize={180}
              accessibilityLabel={item.name}
            />
          </Zoomable>
        ) : (
          <Skeleton sweep className="h-[350px] w-full" />
        )}
        <View className="gap-3 px-gutter pt-1">
          <View className="gap-1">
            {item ? (
              <View className="flex-row items-center gap-1.5">
                <Text variant="brand" tone="muted">
                  {toDisplayUpper(meta, language)}
                </Text>
                {detail ? null : <Skeleton sweep className="h-[11px] w-[92px] rounded-[5px]" />}
              </View>
            ) : (
              <Skeleton sweep className="h-[11px] w-40 rounded-[5px]" />
            )}
            {item ? <Text variant="h2">{item.name}</Text> : <Skeleton sweep className="mt-1 h-7 w-3/5 rounded-[6px]" />}
            {item?.brand ? (
              <Text variant="caption" tone="muted">
                {item.brand}
              </Text>
            ) : null}
          </View>

          {detail ? <ModeratedNote moderation={detail.moderation} kind="item" /> : null}

          <View className="flex-row flex-wrap gap-2" testID={detail ? 'item-facts' : 'item-facts-pending'}>
            {facts.map((fact, index) => (
              <InfoCard key={fact.key} label={fact.label} value={fact.value} skeletonWidth={FACT_SKELETON_WIDTHS[index] ?? 'w-10'} />
            ))}
          </View>

          <View className="flex-row items-center justify-between gap-3 pt-1">
            <Text variant="h3" className="flex-1">
              {t('itemDetail.looksTitle')}
            </Text>
            {detail ? (
              <Text variant="caption" tone="muted">
                {t('itemDetail.looksCount', { count: detail.looks.length })}
              </Text>
            ) : (
              <Skeleton sweep className="h-3 w-10 rounded-[5px]" />
            )}
          </View>
        </View>

        {!detail ? (
          <View className="flex-row gap-2.5 px-gutter" testID="item-looks-pending">
            {LOOK_TONES.map((tone) => (
              <Skeleton key={tone} sweep className="h-[132px] w-[104px] rounded-image-lg" />
            ))}
          </View>
        ) : detail.looks.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2.5 px-gutter">
            {detail.looks.map((look, index) => {
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
                  <ImageSlot uri={look.imageUrl} className="h-[132px] w-[104px] rounded-image-lg" placeholder={{ kind: 'figure', tone, figureHeight: 100 }}>
                    <ImageTag label={toDisplayUpper(occasionLabels[look.occasion] ?? look.occasion, language)} className="absolute bottom-2 left-2" />
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
      </ScrollView>

      <BottomActionBar>
        <View className="flex-row items-center gap-3">
          {item ? (
            <>
              {/* UX turu 1 · D: building a look with the piece is the main action; the AI stylist is the outlined one. */}
              <Button
                className="flex-1 px-3.5"
                size="lg"
                icon={Plus}
                label={t('itemDetail.makeLook')}
                testID="item-make-look"
                onPress={() => router.push({ pathname: '/look/new', params: { itemIds: item.id } })}
              />
              <Button
                variant="secondary"
                className="px-3.5"
                size="lg"
                icon={Sparkles}
                label={t('itemDetail.styleIt')}
                testID="item-style"
                onPress={() => router.navigate({ pathname: '/stylist', params: { itemId: item.id } })}
              />
            </>
          ) : (
            <>
              <Skeleton sweep className="h-btn-primary flex-1 rounded-pill" />
              <Skeleton sweep className="h-btn-primary w-[104px] rounded-pill" />
            </>
          )}
          {/* "Mağazada bul" — a store link, not drawn for a teen (canvas 18). */}
          {hideCommerce ? null : detail ? (
            <Pressable
              onPress={() => router.push({ pathname: '/shop', params: { itemId: detail.id } })}
              accessibilityRole="button"
              accessibilityLabel={t('itemDetail.complete')}
              className="h-btn-primary w-btn-primary items-center justify-center rounded-pill border border-ink active:opacity-70"
            >
              <Icon icon={ShoppingBag} size={18} />
            </Pressable>
          ) : (
            <Skeleton sweep className="h-btn-primary w-btn-primary rounded-pill" />
          )}
        </View>
      </BottomActionBar>

      <View className="absolute left-gutter right-gutter flex-row items-center justify-between" style={{ top }}>
        {/* With nothing known the screen's own back button (outside the states) sits here. */}
        {item ? <IconButton icon={ChevronLeft} variant="inverse" onPress={() => router.back()} accessibilityLabel={t('a11y.back')} /> : <View className="w-11" />}
        {detail ? (
          <View className="flex-row gap-2">
            <IconButton
              icon={Pencil}
              variant="inverse"
              onPress={() => router.push({ pathname: '/item/form', params: { itemId: detail.id } })}
              accessibilityLabel={t('itemDetail.edit')}
            />
            <IconButton icon={Ellipsis} variant="inverse" onPress={onMore} accessibilityLabel={t('itemDetail.more')} />
          </View>
        ) : (
          <View className="flex-row gap-2">
            <Skeleton sweep tone="veil" className="h-11 w-11 rounded-pill" />
            <Skeleton sweep tone="veil" className="h-11 w-11 rounded-pill" />
          </View>
        )}
      </View>
    </>
  );
}

/**
 * 11 Parça detayı — hero picture, edit, ⋯ menu (change season, delete), facts, the looks using the
 * piece, and the bar: "Bununla look yap" (15 opens with this piece), "Stille" (the AI stylist), completing products.
 * Opened from the grid it draws at once with what the list knows (11′); the edit / ⋯ / shop buttons wait for the
 * detail, so a write never starts from the list's copy.
 */
export default function ItemDetailScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useItemDetailWithPreview(id);
  const update = useUpdateItem();
  const deletion = useDeleteItems();
  const [menu, setMenu] = useState(false);
  const [sheet, setSheet] = useState<'none' | 'season' | 'delete'>('none');
  const [deleted, setDeleted] = useState(false);

  // The piece is gone (deleted here or on another device): one sentence + the way back.
  if (deleted || (query.data === undefined && query.status === 'error' && query.fetchStatus === 'idle' && isNotFound(query.error))) {
    return (
      <Screen bottom>
        <ScreenHeader leading="back" />
        <StateMessage message={t('itemDetail.goneTitle')} actionLabel={t('itemDetail.goneAction')} onAction={() => router.dismissTo('/wardrobe')} />
      </Screen>
    );
  }

  const top = insets.top + 6;
  const detail = query.data && isItemDetail(query.data) ? query.data : null;
  const openMenu = () => setMenu(true);

  return (
    <Screen top={false}>
      <ScreenState
        query={query}
        loadingLabel={t('itemDetail.loadingA11y')}
        skeleton={<ItemContent item={null} detail={null} top={top} onMore={openMenu} />}
      >
        {(data) => <ItemContent item={data} detail={isItemDetail(data) ? data : null} top={top} onMore={openMenu} />}
      </ScreenState>
      {query.data === undefined ? (
        <View className="absolute left-gutter" style={{ top }}>
          <IconButton icon={ChevronLeft} variant="inverse" onPress={() => router.back()} accessibilityLabel={t('a11y.back')} />
        </View>
      ) : null}
      {detail ? (
        <>
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
            initial={detail.seasons}
            onSave={(seasons) => {
              update.setSeasons([detail], seasons);
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
              deletion.remove([detail.id]);
              router.dismissTo('/wardrobe');
            }}
          />
        </>
      ) : null}
    </Screen>
  );
}
