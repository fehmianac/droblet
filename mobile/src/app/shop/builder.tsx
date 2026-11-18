import { router, useLocalSearchParams } from 'expo-router';
import { Check, Plus, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { track } from '@/analytics/track';
import { BUILDER_SLOTS, type BuilderSlot } from '@/api/contracts/store';
import { useBodyProfile } from '@/api/profile';
import { BrandMark } from '@/components/blocks/BrandMark';
import { SectionState } from '@/components/blocks/SectionState';
import { AiImage } from '@/components/ui/AiBadge';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useProfileStats } from '@/features/account/queries';
import {
  EMPTY_SLOTS,
  filledCount,
  firstEmptySlot,
  MIN_LOOK_PIECES,
  storeFill,
  storeItems,
  toLookSlots,
  withProduct,
  type BuilderSlots,
  type SlotFill,
} from '@/features/store/builder';
import { useAddToCart, useCreateLook } from '@/features/store/mutations';
import { useProduct, useSlotProducts, useWardrobePieces } from '@/features/store/queries';
import { formatMoney } from '@/lib/format';

type Source = 'store' | 'wardrobe';

function SlotCard({
  slot,
  fill,
  selected,
  onSelect,
  onClear,
}: {
  slot: BuilderSlot;
  fill: SlotFill | null;
  selected: boolean;
  onSelect: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const slotLabel = t(`builder.slot.${slot}`);
  const name = fill ? (fill.source === 'store' ? fill.product.name : fill.piece.name) : t('builder.slotEmptyHint');
  const meta = !fill
    ? null
    : fill.source === 'wardrobe'
      ? t('builder.fromWardrobe')
      : fill.product.price !== null
        ? t('builder.storeMeta', { brand: fill.product.brandName, price: formatMoney(fill.product.price) })
        : fill.product.brandName;

  return (
    <View
      className={`flex-row items-center rounded-image-lg border bg-paper ${
        selected ? 'border-ink' : fill ? 'border-line' : 'border-dashed border-line'
      }`}
    >
      <Pressable
        onPress={onSelect}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={[fill ? slotLabel : t('builder.slotEmpty', { slot: slotLabel }), name, meta].filter(Boolean).join(', ')}
        className="min-h-14 flex-1 flex-row items-center gap-2.5 p-2 active:opacity-70"
      >
        {fill ? (
          <PlaceholderImage
            uri={fill.source === 'store' ? fill.product.imageUrl : fill.piece.imageUrl}
            className="h-11 w-9 rounded-image"
          />
        ) : (
          <View className="h-11 w-9 items-center justify-center rounded-image bg-sand">
            <Icon icon={Plus} size={16} tone="muted" />
          </View>
        )}
        <View className="flex-1">
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {fill ? slotLabel : t('builder.slotEmpty', { slot: slotLabel })}
          </Text>
          <Text variant="bodyMedium" numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            // Store pieces are marked in accent (they are the ones that cost money).
            <Text variant="caption" tone={fill?.source === 'store' ? 'accent' : 'muted'} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {fill ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={t('builder.clearSlot', { slot: slotLabel })}
          className="h-icon-btn w-9 items-center justify-center active:opacity-70"
        >
          <Icon icon={X} size={16} tone="muted" />
        </Pressable>
      ) : null}
    </View>
  );
}

function StripSkeleton() {
  return (
    <View className="flex-row gap-3 px-gutter">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className="w-24 gap-1.5">
          <Skeleton className="aspect-[4/5] w-full rounded-image" />
          <Skeleton className="h-3 w-16 rounded-field" />
        </View>
      ))}
    </View>
  );
}

/**
 * 23 Kombin oluşturucu — five slots (üst, alt, dış giyim, ayakkabı, çanta), each filled from the
 * store or the wardrobe. The selected slot gets suggestions below; store pieces show their price in
 * accent. "Lookbook'a kaydet" writes a look; "N ürünü satın al" adds the store pieces to the cart.
 *
 * `?productId=` starts with that product in its slot (22 "Göster"); `?lookId=` comes from
 * "Look'u tamamla" — prefilling from that look waits for the E3 look contract.
 */
export default function BuilderScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ productId?: string; lookId?: string }>();
  const profileSize = useBodyProfile().data?.size ?? null;
  const stats = useProfileStats();
  const seedProduct = useProduct(params.productId ?? '', Boolean(params.productId));
  const addToCart = useAddToCart();
  const createLook = useCreateLook();

  const [slots, setSlots] = useState<BuilderSlots>(EMPTY_SLOTS);
  const [selected, setSelected] = useState<BuilderSlot>('top');
  const [source, setSource] = useState<Source>('store');
  const [saved, setSaved] = useState(false);

  // Seed once from `?productId=` when the product arrives (render-time state adjustment, no effect).
  const [seededWith, setSeededWith] = useState<string | null>(null);
  if (params.productId && seedProduct.data && seededWith !== seedProduct.data.id) {
    setSeededWith(seedProduct.data.id);
    const next = withProduct(slots, seedProduct.data, profileSize);
    setSlots(next);
    setSelected(firstEmptySlot(next) ?? 'top');
  }

  useEffect(() => {
    if (params.lookId) track('complete_look_clicked', { source: 'look' });
  }, [params.lookId]);

  const storeSuggestions = useSlotProducts(source === 'store' ? selected : null);
  const wardrobe = useWardrobePieces(source === 'wardrobe');

  const fillSlot = (fill: SlotFill | null, slot: BuilderSlot = selected) => {
    const next = { ...slots, [slot]: fill };
    setSlots(next);
    setSaved(false);
    if (fill) setSelected(firstEmptySlot(next) ?? slot);
  };

  const toBuy = storeItems(slots);
  const canSave = filledCount(slots) >= MIN_LOOK_PIECES;
  const slotLabel = t(`builder.slot.${selected}`);

  const save = () => {
    createLook({ name: t('builder.defaultLookName'), occasion: null, slots: toLookSlots(slots) });
    if (stats.data?.lookCount === 0) track('first_look_created', { source: 'builder' });
    setSaved(true);
  };

  return (
    <Screen>
      <ScreenHeader title={t('screens.builder')} leading="back" />
      <OfflineBanner />
      <ScrollView contentContainerClassName="gap-5 pb-8">
        <Text variant="body" tone="muted" className="px-gutter">
          {t('builder.intro')}
        </Text>

        <View className="flex-row gap-3 px-gutter">
          <AiImage kind="preview" uri={null} className="w-2/5 self-stretch" />
          <View className="flex-1 gap-2">
            {BUILDER_SLOTS.map((slot) => (
              <SlotCard
                key={slot}
                slot={slot}
                fill={slots[slot]}
                selected={selected === slot}
                onSelect={() => setSelected(slot)}
                onClear={() => {
                  fillSlot(null, slot);
                  setSelected(slot);
                }}
              />
            ))}
          </View>
        </View>

        <View className="gap-3">
          <View className="flex-row flex-wrap items-center gap-2 px-gutter" accessibilityRole="tablist" accessibilityLabel={t('builder.sourceLabel')}>
            <Chip label={t('builder.sourceStore')} selected={source === 'store'} onPress={() => setSource('store')} />
            <Chip label={t('builder.sourceWardrobe')} selected={source === 'wardrobe'} onPress={() => setSource('wardrobe')} />
            <Text variant="caption" tone="muted" className="flex-1 text-right" accessibilityLiveRegion="polite">
              {t('builder.suggestionsFor', { slot: slotLabel })}
            </Text>
          </View>

          {source === 'store' ? (
            <SectionState
              query={storeSuggestions}
              skeleton={<StripSkeleton />}
              isEmpty={(list) => list.length === 0}
              emptyText={t('builder.suggestionsEmptyStore')}
              errorText={t('builder.suggestionsError')}
            >
              {(list) => (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-gutter">
                  {list.map((product) => (
                    <Pressable
                      key={product.id}
                      onPress={() => fillSlot(storeFill(product, profileSize))}
                      accessibilityRole="button"
                      accessibilityLabel={[product.brandName, product.name, product.price !== null ? formatMoney(product.price) : null]
                        .filter(Boolean)
                        .join(', ')}
                      className="w-24 gap-1 active:opacity-80"
                    >
                      <PlaceholderImage uri={product.imageUrl} className="aspect-[4/5] w-full rounded-image" />
                      <BrandMark name={product.brandName} logoUrl={product.brandLogoUrl} />
                      {product.price !== null ? (
                        <Text variant="caption" tone="accent">
                          {formatMoney(product.price)}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </SectionState>
          ) : (
            <SectionState
              query={{
                data: wardrobe.data?.filter((piece) => piece.slot === selected),
                status: wardrobe.status,
                fetchStatus: wardrobe.fetchStatus,
                error: wardrobe.error,
                refetch: wardrobe.refetch,
              }}
              skeleton={<StripSkeleton />}
              isEmpty={(list) => list.length === 0}
              emptyText={t('builder.suggestionsEmptyWardrobe')}
              errorText={t('builder.suggestionsError')}
            >
              {(list) => (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-3 px-gutter">
                  {list.map((piece) => (
                    <Pressable
                      key={piece.id}
                      onPress={() => fillSlot({ source: 'wardrobe', piece })}
                      accessibilityRole="button"
                      accessibilityLabel={piece.name}
                      className="w-24 gap-1 active:opacity-80"
                    >
                      <PlaceholderImage uri={piece.imageUrl} className="aspect-[4/5] w-full rounded-image" />
                      <Text variant="caption" numberOfLines={2}>
                        {piece.name}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </SectionState>
          )}
        </View>
      </ScrollView>

      <BottomActionBar>
        <View className="flex-row items-center gap-3">
          {saved ? (
            <View
              className="h-btn-secondary flex-1 flex-row items-center justify-center gap-2 rounded-pill bg-sand px-3"
              accessible
              accessibilityLiveRegion="polite"
              accessibilityLabel={t('builder.savedLook')}
            >
              <Icon icon={Check} tone="accent" size={18} />
              <Text variant="caption" numberOfLines={2} className="flex-shrink">
                {t('builder.savedLook')}
              </Text>
            </View>
          ) : (
            <Button
              variant="secondary"
              className="flex-1"
              label={t('builder.saveLook')}
              onPress={save}
              disabled={!canSave}
              accessibilityHint={canSave ? undefined : t('builder.saveHint')}
            />
          )}
          <Button
            className="flex-1"
            label={toBuy.length > 0 ? t('builder.buy', { count: toBuy.length }) : t('builder.buyNone')}
            disabled={toBuy.length === 0}
            onPress={() => {
              addToCart(toBuy, 'builder');
              router.push('/cart');
            }}
          />
        </View>
      </BottomActionBar>
    </Screen>
  );
}
