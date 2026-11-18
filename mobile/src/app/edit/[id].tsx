import { router, useLocalSearchParams } from 'expo-router';
import { BellPlus, BellRing, Camera, Heart, Share2, ShoppingBag } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  Share,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';

import { PRICE_BANDS, type EditLook, type PriceBand, type WeeklyEdit } from '@/api/contracts/today';
import { AiImage } from '@/components/ui/AiBadge';
import { Badge } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ProductRow } from '@/components/ui/ProductRow';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useAddToWatchlist, useSaveEditLook, useWeeklyEdit } from '@/features/today/api';
import { editSummary } from '@/features/today/logic';
import { currentLanguage } from '@/i18n';
import { formatDate, formatDateRange, formatMoney, parseLocalDate, toIsoDate } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';

function EditSkeleton() {
  return (
    <View className="gap-4 px-gutter pt-2">
      <Skeleton className="aspect-[4/5] w-full rounded-image-lg" />
      <Skeleton className="h-3 w-2/3 rounded-field" />
      <Skeleton className="h-7 w-3/4 rounded-field" />
      <Skeleton className="h-16 w-full rounded-field" />
      <Skeleton className="h-[70px] w-full rounded-field" />
    </View>
  );
}

/**
 * Explicit back: `ScreenHeader`'s default reads `router.canGoBack()` during render, which throws when
 * this screen is the first one rendered (deep link / cold start). Without history, go to Bugün.
 */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

function initialIndex(edit: WeeklyEdit, lookId: string | undefined): number {
  const byId = lookId ? edit.looks.findIndex((l) => l.id === lookId) : -1;
  if (byId >= 0) return byId;
  const today = edit.looks.findIndex((l) => l.date === toIsoDate(new Date()));
  return today >= 0 ? today : 0;
}

/**
 * 08 Haftanın edit'i — the week's looks (swipe + dots) on the user, the style note, a price-band
 * switch, and only the pieces the user does not own yet (owned ones are hidden, with a "Göster"
 * toggle), each with "İzleme listeme ekle". Without a body photo the image gives way to the
 * "Profil fotoğrafını tamamla" card.
 */
export default function WeeklyEditScreen() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ id: string; look?: string }>();
  const query = useWeeklyEdit(params.id || 'current');
  const watchlist = useAddToWatchlist();
  const saveLook = useSaveEditLook();
  const pager = useRef<ScrollViewInstance>(null);

  const [picked, setPicked] = useState<number | null>(null);
  const [band, setBand] = useState<PriceBand>('high_street');
  const [showOwned, setShowOwned] = useState(false);
  const [justWatched, setJustWatched] = useState(false);

  const edit = query.data;
  const index = edit ? Math.min(picked ?? initialIndex(edit, params.look), Math.max(0, edit.looks.length - 1)) : 0;
  const look: EditLook | undefined = edit?.looks[index];

  const goTo = (next: number) => {
    setPicked(next);
    setJustWatched(false);
    pager.current?.scrollTo({ x: next * width, animated: true });
  };
  const onPagerEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (next !== index) {
      setPicked(next);
      setJustWatched(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader
        leading="back"
        onLeadingPress={goBack}
        right={
          look ? (
            <View className="flex-row gap-2">
              <IconButton
                icon={Share2}
                accessibilityLabel={t('weekEdit.share')}
                onPress={() => void Share.share({ message: t('weekEdit.shareMessage', { name: look.name }) }).catch(() => undefined)}
              />
              <IconButton
                icon={Heart}
                active={look.isSaved}
                accessibilityLabel={t(look.isSaved ? 'weekEdit.saved' : 'weekEdit.save')}
                onPress={() => {
                  if (!look.isSaved) saveLook.save(look.id, band, edit?.id);
                }}
              />
            </View>
          ) : undefined
        }
      />
      <ScreenState
        query={query}
        skeleton={<EditSkeleton />}
        isEmpty={(data) => data.looks.length === 0}
        empty={{ message: t('weekEdit.emptyMessage'), actionLabel: t('weekEdit.emptyAction'), onAction: () => router.dismissTo('/') }}
      >
        {(data) => {
          const current = data.looks[index];
          if (!current) return null;
          const summary = editSummary(current.products[band], showOwned);
          const day = parseLocalDate(current.date);
          const eyebrow = toDisplayUpper(
            t('weekEdit.eyebrow', {
              range: formatDateRange(parseLocalDate(data.weekStart), parseLocalDate(data.weekEnd), { day: 'numeric', month: 'long' }),
              weekday: formatDate(day, { weekday: 'long' }),
              occasion: t(`occasion.${current.occasion}`),
            }),
            currentLanguage(),
          );
          return (
            <>
              <ScrollView contentContainerClassName="gap-4 pb-6">
                {data.hasBodyPhoto ? (
                  <ScrollView
                    ref={pager}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    contentOffset={{ x: index * width, y: 0 }}
                    onMomentumScrollEnd={onPagerEnd}
                  >
                    {data.looks.map((l) => (
                      <View key={l.id} style={{ width }} className="px-gutter">
                        <AiImage
                          kind="onYou"
                          uri={l.tryOnImageUrl}
                          className="aspect-[4/5] w-full"
                          accessibilityLabel={t('weekEdit.imageA11y', { name: l.name })}
                        />
                      </View>
                    ))}
                  </ScrollView>
                ) : (
                  <View className="mx-gutter items-center gap-3 rounded-card border border-line bg-paper px-6 py-8">
                    <Icon icon={Camera} size={28} tone="accent" />
                    <Text variant="h3" className="text-center">
                      {t('weekEdit.photoTitle')}
                    </Text>
                    <Text variant="caption" tone="muted" className="text-center">
                      {t('weekEdit.photoBody', { count: data.looks.length })}
                    </Text>
                    <Button label={t('weekEdit.photoAction')} onPress={() => router.push('/settings')} className="self-stretch" />
                  </View>
                )}

                <View
                  className="flex-row items-center justify-center"
                  accessibilityRole="adjustable"
                  accessibilityLabel={t('weekEdit.pageA11y', { current: index + 1, total: data.looks.length })}
                >
                  {data.looks.map((l, i) => (
                    <Pressable
                      key={l.id}
                      onPress={() => goTo(i)}
                      accessibilityRole="button"
                      accessibilityLabel={t('weekEdit.goToLook', { current: i + 1 })}
                      accessibilityState={{ selected: i === index }}
                      hitSlop={{ top: 14, bottom: 14 }}
                      className="h-6 w-6 items-center justify-center"
                    >
                      <View className={`h-1.5 rounded-pill ${i === index ? 'w-4 bg-ink' : 'w-1.5 bg-line'}`} />
                    </Pressable>
                  ))}
                </View>

                <View className="gap-2 px-gutter">
                  <Text variant="eyebrow">{eyebrow}</Text>
                  <Text variant="h2">{current.name}</Text>
                  <Text variant="body" tone="muted">
                    {current.styleNote}
                  </Text>
                </View>

                <View className="flex-row flex-wrap gap-2 px-gutter" accessibilityRole="radiogroup" accessibilityLabel={t('weekEdit.bandLabel')}>
                  {PRICE_BANDS.map((b) => (
                    <Chip
                      key={b}
                      label={t(`weekEdit.band.${b}`)}
                      selected={band === b}
                      onPress={() => {
                        setBand(b);
                        setJustWatched(false);
                      }}
                    />
                  ))}
                </View>

                <View className="px-gutter">
                  {summary.ownedCount > 0 ? (
                    <View className="flex-row items-center justify-between gap-3">
                      <Text variant="caption" tone="muted" className="flex-1">
                        {t(showOwned ? 'weekEdit.ownedShown' : 'weekEdit.ownedHidden', { count: summary.ownedCount })}
                      </Text>
                      <Button variant="text" label={t(showOwned ? 'weekEdit.hide' : 'weekEdit.show')} onPress={() => setShowOwned(!showOwned)} />
                    </View>
                  ) : null}
                  {summary.visible.map((p) => (
                    <ProductRow
                      key={p.id}
                      brand={p.brand}
                      name={p.name}
                      price={p.price}
                      imageUri={p.imageUrl}
                      onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: p.id } })}
                      trailing={
                        p.ownedItemId ? (
                          <Badge label={t('weekEdit.ownedBadge')} />
                        ) : (
                          <IconButton
                            icon={p.inWatchlist ? BellRing : BellPlus}
                            active={p.inWatchlist}
                            accessibilityLabel={t(p.inWatchlist ? 'weekEdit.watching' : 'weekEdit.watch', { name: p.name })}
                            onPress={() => {
                              if (p.inWatchlist) return;
                              watchlist.add(p.id, current.id);
                              setJustWatched(true);
                            }}
                          />
                        )
                      }
                    />
                  ))}
                  {justWatched ? (
                    <Text variant="caption" tone="accent" accessibilityLiveRegion="polite" className="pt-1">
                      {t('weekEdit.watchAdded')}
                    </Text>
                  ) : null}
                </View>
              </ScrollView>
              <BottomActionBar
                totalLabel={summary.missing.length > 0 ? t('weekEdit.missing', { count: summary.missing.length }) : t('weekEdit.nothingMissing')}
                totalValue={summary.missingTotal ? formatMoney(summary.missingTotal) : undefined}
              >
                <Button
                  label={t('weekEdit.completeLook')}
                  icon={ShoppingBag}
                  disabled={summary.missing.length === 0}
                  onPress={() => router.push({ pathname: '/cart', params: { editLookId: current.id, band } })}
                />
              </BottomActionBar>
            </>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
