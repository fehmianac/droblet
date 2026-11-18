import { router, useLocalSearchParams } from 'expo-router';
import { BookmarkCheck, BookmarkPlus, Camera, ChevronLeft, Heart, Share, ShoppingBag } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Pressable,
  ScrollView,
  Share as NativeShare,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PRICE_BANDS, type EditLook, type PriceBand, type WeeklyEdit } from '@/api/contracts/today';
import { SponsoredTag } from '@/components/blocks/basics';
import { Badge } from '@/components/ui/Bits';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';
import { useAddToWatchlist, useSaveEditLook, useWeeklyEdit } from '@/features/today/api';
import { EditProductRow } from '@/features/today/EditProductRow';
import { editSummary } from '@/features/today/logic';
import { OnYouImage } from '@/features/today/OnYouImage';
import { OnYouCta } from '@/features/tryon/OnYouCta';
import { currentLanguage } from '@/i18n';
import { formatDate, formatIsoDateRange, formatMoney, parseLocalDate, toIsoDate } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';

/** The image on 08 is 350 high and starts at the very top of the screen, under the status bar. */
const HERO_HEIGHT = 350;

/** Without history (deep link / cold start), back goes to Bugün. */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

function initialIndex(edit: WeeklyEdit, lookId: string | undefined): number {
  const byId = lookId ? edit.looks.findIndex((l) => l.id === lookId) : -1;
  if (byId >= 0) return byId;
  const today = edit.looks.findIndex((l) => l.date === toIsoDate(new Date()));
  return today >= 0 ? today : 0;
}

/**
 * 08 Haftanın edit'i — the week's looks on the user as a full-bleed image (swipe + dots) with back, share
 * and heart laid over it; then the style note, the price-band switch and only the pieces the user does not
 * own yet (owned ones are hidden behind "Göster"), each with "İzleme listeme ekle"; the bar totals the
 * missing pieces next to "Look'u tamamla".
 *
 * 08 · fotoğraf yok — no body photo: a plain header with back and the "Profil fotoğrafını tamamla" card
 * in place of the image.
 */
export default function WeeklyEditScreen() {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
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
  const noPhoto = edit !== undefined && !edit.hasBodyPhoto;
  // The actions sit on the image. Offline, the cached-data band takes the top of the screen, so the
  // screen falls back to a plain header above it (as it does when there is no image at all).
  const overlay = !noPhoto && online;

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

  const actions = (variant: 'inverse' | 'outline') =>
    look && !noPhoto ? (
      <View className="flex-row gap-2">
        <IconButton
          icon={Share}
          iconSize={19}
          variant={variant}
          accessibilityLabel={t('weekEdit.share')}
          onPress={() => void NativeShare.share({ message: t('weekEdit.shareMessage', { name: look.name }) }).catch(() => undefined)}
        />
        <IconButton
          icon={Heart}
          iconSize={19}
          variant={variant}
          active={look.isSaved}
          accessibilityLabel={t(look.isSaved ? 'weekEdit.saved' : 'weekEdit.save')}
          onPress={() => {
            if (!look.isSaved) saveLook.save(look.id, band, edit?.id);
          }}
        />
      </View>
    ) : null;

  const dots = (data: WeeklyEdit, onImage: boolean) => (
    <View
      className="flex-row items-center justify-center gap-1.5"
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
          hitSlop={{ top: 16, bottom: 16, left: 3, right: 3 }}
          className="h-3 justify-center"
        >
          <View className={`h-1.5 rounded-pill ${i === index ? 'w-[18px] bg-ink' : `w-1.5 ${onImage ? 'bg-ink/30' : 'bg-line'}`}`} />
        </Pressable>
      ))}
    </View>
  );

  return (
    <Screen top={!overlay}>
      {overlay ? null : <ScreenHeader leading="back" onLeadingPress={goBack} right={actions('outline')} />}
      <ScreenState
        query={query}
        isEmpty={(data) => data.looks.length === 0}
        empty={{ message: t('weekEdit.emptyMessage'), actionLabel: t('weekEdit.emptyAction'), onAction: () => router.dismissTo('/') }}
      >
        {(data) => {
          const current = data.looks[index];
          if (!current) return null;
          const summary = editSummary(current.products[band], showOwned);
          const eyebrow = toDisplayUpper(
            t('weekEdit.eyebrow', {
              range: formatIsoDateRange(data.weekStart, data.weekEnd),
              weekday: formatDate(parseLocalDate(current.date), { weekday: 'long' }),
              occasion: t(`occasion.${current.occasion}`),
            }),
            currentLanguage(),
          );
          return (
            <>
              <ScrollView contentContainerClassName="pb-6">
                {data.hasBodyPhoto ? (
                  <View style={{ height: HERO_HEIGHT }}>
                    <ScrollView
                      ref={pager}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      contentOffset={{ x: index * width, y: 0 }}
                      onMomentumScrollEnd={onPagerEnd}
                    >
                      {data.looks.map((l) => (
                        <View key={l.id} style={{ width, height: HERO_HEIGHT }}>
                          <OnYouImage
                            uri={l.tryOnImageUrl}
                            className="h-full w-full"
                            pieces={l.products[band].map((p) => ({ category: p.category, color: p.color, imageUrl: p.imageUrl, missing: !p.ownedItemId }))}
                            seed={l.id}
                            silhouetteHeight={217}
                            accessibilityLabel={t('weekEdit.imageA11y', { name: l.name })}
                            collageLabel={t('aiBadge.collageA11y', { name: l.name })}
                            badgeClassName="bottom-11 left-3.5"
                            ctaClassName="bottom-11 left-[140px] right-3.5"
                          >
                            <OnYouCta target={{ kind: 'edit-look', id: l.id }} title={l.name} feature="edit_try_on" hasBodyPhoto />
                          </OnYouImage>
                        </View>
                      ))}
                    </ScrollView>
                    <View className="absolute bottom-3.5 left-0 right-0" pointerEvents="box-none">
                      {dots(data, true)}
                    </View>
                    {data.sponsoredBy ? (
                      <View className="absolute bottom-2 right-2" pointerEvents="none">
                        <SponsoredTag />
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View className="gap-3 px-gutter pt-1">
                    <View className="h-[280px] items-center justify-center gap-3 rounded-card bg-sand p-6">
                      <View className="h-16 w-16 items-center justify-center rounded-pill bg-paper">
                        <Icon icon={Camera} size={28} />
                      </View>
                      <Text variant="h3" className="text-center">
                        {t('weekEdit.photoTitle')}
                      </Text>
                      <Text variant="caption" className="max-w-[260px] text-center">
                        {t('weekEdit.photoBody', { count: data.looks.length })}
                      </Text>
                      <Button size="md" label={t('weekEdit.photoAction')} onPress={() => router.push('/settings')} />
                    </View>
                    {/* Not on the board: without the image there is nothing to swipe, so the dots stay as the way to the other looks. */}
                    {data.looks.length > 1 ? dots(data, false) : null}
                  </View>
                )}

                <View className={`gap-2.5 px-gutter ${data.hasBodyPhoto ? 'pt-3.5' : 'pt-3'}`}>
                  <Text variant="eyebrow">{eyebrow}</Text>
                  <Text variant="h2" className="text-[28px] leading-[31px]">
                    {current.name}
                  </Text>
                  {data.sponsoredBy ? (
                    <Text variant="caption" tone="muted">
                      {t('weekEdit.sponsoredBy', { brand: data.sponsoredBy })}
                    </Text>
                  ) : null}
                  {data.hasBodyPhoto ? (
                    <Text variant="body" tone="muted" className="text-[13.5px] leading-[20px]">
                      {current.styleNote}
                    </Text>
                  ) : null}

                  <SegmentedControl
                    accessibilityLabel={t('weekEdit.bandLabel')}
                    segments={PRICE_BANDS.map((b) => ({ value: b, label: t(`weekEdit.band.${b}`) }))}
                    value={band}
                    onChange={(b) => {
                      setBand(b);
                      setJustWatched(false);
                    }}
                  />

                  <View>
                    {summary.ownedCount > 0 ? (
                      <View className="flex-row items-center justify-between gap-2">
                        <Text variant="caption" tone="muted" className="flex-1">
                          <Text variant="label">{t('weekEdit.ownedCount', { count: summary.ownedCount })}</Text>
                          {showOwned ? null : t('weekEdit.hiddenSuffix')}
                        </Text>
                        <Pressable
                          onPress={() => setShowOwned(!showOwned)}
                          accessibilityRole="button"
                          accessibilityLabel={t(showOwned ? 'weekEdit.hide' : 'weekEdit.show')}
                          hitSlop={8}
                          className="min-h-icon-btn justify-center active:opacity-70"
                        >
                          <Text variant="caption" className="underline">
                            {t(showOwned ? 'weekEdit.hide' : 'weekEdit.show')}
                          </Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {summary.visible.map((p) => (
                      <EditProductRow
                        key={p.id}
                        product={p}
                        onPress={() => router.push({ pathname: '/shop/product/[id]', params: { id: p.id } })}
                        trailing={
                          p.ownedItemId ? (
                            <Badge label={t('weekEdit.ownedBadge')} />
                          ) : (
                            <IconButton
                              icon={p.inWatchlist ? BookmarkCheck : BookmarkPlus}
                              iconSize={18}
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
                      <Text variant="caption" tone="accent" accessibilityLiveRegion="polite" className="pt-2">
                        {t('weekEdit.watchAdded')}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </ScrollView>
              <BottomActionBar
                actionFill
                totalLabel={summary.missing.length > 0 ? t('weekEdit.missing', { count: summary.missing.length }) : t('weekEdit.nothingMissing')}
                totalValue={summary.missingTotal ? formatMoney(summary.missingTotal) : undefined}
              >
                <Button
                  size="bar"
                  label={t('weekEdit.completeLook')}
                  icon={data.hasBodyPhoto ? ShoppingBag : undefined}
                  disabled={summary.missing.length === 0}
                  onPress={() => router.push({ pathname: '/cart', params: { editLookId: current.id, band } })}
                />
              </BottomActionBar>
            </>
          );
        }}
      </ScreenState>

      {overlay ? (
        <View
          className="absolute left-gutter right-gutter flex-row items-center justify-between"
          style={{ top: insets.top + 4 }}
          pointerEvents="box-none"
        >
          <IconButton icon={ChevronLeft} variant="inverse" onPress={goBack} accessibilityLabel={t('a11y.back')} />
          {actions('inverse')}
        </View>
      ) : null}
    </Screen>
  );
}
