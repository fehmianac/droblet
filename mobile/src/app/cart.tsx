import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Bookmark, CircleAlert, ExternalLink, ShoppingBag, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { ONE_SIZE, type Cart, type CartGroup } from '@/api/contracts/store';
import { Card } from '@/components/blocks/basics';
import { BrandMark } from '@/components/blocks/BrandMark';
import { InfoNote } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { useBrandCheckout, useRemoveCartLine } from '@/features/store/mutations';
import { useCart } from '@/features/store/queries';
import { currentLanguage } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { useIsOnline } from '@/sync/network';
import { useThemeColors } from '@/theme/useThemeColors';

/** `SepetBos` — the 96 sand circle with the bag, "Sepetin boş", one sentence and "Ürünleri keşfet". */
function EmptyCart() {
  const { t } = useTranslation();
  return (
    <StateMessage
      icon={ShoppingBag}
      title={t('cart.emptyTitle')}
      message={t('cart.emptyBody')}
      actionLabel={t('cart.emptyAction')}
      actionVariant="primary"
      onAction={() => router.push('/shop')}
      role="status"
    />
  );
}

type CheckoutError = { brandId: string; message: string };

function BrandGroup({
  group,
  onPay,
  paying,
  error,
}: {
  group: CartGroup;
  onPay: () => void;
  paying: boolean;
  error: string | null;
}) {
  const { t } = useTranslation();
  const language = currentLanguage();
  const remove = useRemoveCartLine();
  return (
    <Card className="px-3.5 pb-3.5 pt-1">
      <View className="flex-row items-center justify-between gap-3 border-b border-line py-2.5">
        <BrandMark name={group.brandName} logoUrl={group.brandLogoUrl} tone="ink" className="flex-1" />
        {group.subtotal ? (
          <Text variant="caption" tone="muted">
            {formatMoney(group.subtotal)}
          </Text>
        ) : null}
      </View>
      {group.lines.map((line) => (
        <View key={line.lineId} className="flex-row items-center gap-3 py-2">
          <ImageSlot
            uri={line.imageUrl}
            className="h-[68px] w-14 rounded-thumb"
            accessibilityLabel={line.name}
            placeholder={{ kind: 'garment', category: line.category, color: line.color, glyphSize: 24 }}
          />
          <View className="flex-1">
            <Text variant="body" numberOfLines={2}>
              {line.name}
            </Text>
            <Text variant="caption" tone="muted">
              {t('cart.size', { size: line.size === ONE_SIZE ? t('shop.oneSize') : line.size })}
            </Text>
            {line.price !== null ? (
              <Text variant="price" className="mt-[3px]">
                {formatMoney(line.price)}
              </Text>
            ) : null}
          </View>
          <IconButton
            icon={Trash2}
            variant="plain"
            onPress={() => remove(line.lineId)}
            accessibilityLabel={t('cart.remove', { name: line.name })}
          />
        </View>
      ))}
      <Button
        label={t('cart.payAt', { brand: suffixed(group.brandName, 'locative', language) })}
        onPress={onPay}
        loading={paying}
        size="md"
        icon={ExternalLink}
        iconPosition="trailing"
        accessibilityHint={t('cart.browserNote')}
      />
      {error ? (
        <View className="mt-2 flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
          <Icon icon={CircleAlert} size={14} tone="danger" />
          <Text variant="caption" tone="danger" className="flex-1">
            {error}
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * 24 Sepetim — lines grouped by brand; each brand has its own "[Marka]'da öde", which asks the
 * server for that brand's checkout link and opens it in the in-app browser. Droblet never takes a
 * payment; the info note says so. Empty state: `SepetBos`. Checkout screen: no bottom menu.
 */
export default function CartScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const cart = useCart();
  const checkout = useBrandCheckout();
  const [checkoutError, setCheckoutError] = useState<CheckoutError | null>(null);

  const pay = async (group: CartGroup) => {
    setCheckoutError(null);
    if (!online) {
      setCheckoutError({ brandId: group.brandId, message: t('cart.checkoutOffline') });
      return;
    }
    try {
      const { checkoutUrl, clickId } = await checkout.mutateAsync(group.brandId);
      // Only ever hand a web link to the browser.
      if (!/^https:\/\//i.test(checkoutUrl)) throw new Error('unexpected checkout url');
      track('brand_checkout_opened', { brandId: group.brandId, clickId, lineCount: group.lines.length });
      await WebBrowser.openBrowserAsync(checkoutUrl, { controlsColor: colors.ink, toolbarColor: colors.paper });
    } catch {
      setCheckoutError({ brandId: group.brandId, message: t('cart.checkoutFailed') });
    }
  };

  const hasLines = (cart.data?.lineCount ?? 0) > 0;

  const summary = (data: Cart) =>
    t('cart.summary', {
      items: t('cart.itemCount', { count: data.lineCount }),
      brands: t('cart.brandCount', { count: data.groups.length }),
    });

  return (
    <Screen>
      <ScreenHeader
        title={t('screens.cart')}
        leading="back"
        // `SepetBos` has no watchlist button: it appears with the first line.
        right={
          hasLines ? <IconButton icon={Bookmark} onPress={() => router.push('/watchlist')} accessibilityLabel={t('cart.watchlist')} /> : undefined
        }
      />
      <ScreenState query={cart}>
        {(data) =>
          data.lineCount === 0 ? (
            <EmptyCart />
          ) : (
            <>
              <ScrollView
                contentContainerClassName="gap-3 px-gutter pb-6 pt-1"
                refreshControl={
                  <RefreshControl refreshing={cart.isRefetching} onRefresh={() => void cart.refetch()} tintColor={colors.muted} />
                }
              >
                <InfoNote text={t('cart.infoNote')} />
                {data.groups.map((group) => (
                  <BrandGroup
                    key={group.brandId}
                    group={group}
                    onPay={() => void pay(group)}
                    paying={checkout.isPending && checkout.variables === group.brandId}
                    error={checkoutError?.brandId === group.brandId ? checkoutError.message : null}
                  />
                ))}
                <Text variant="caption" tone="muted" className="text-center">
                  {t('cart.browserNote')}
                </Text>
              </ScrollView>
              {/* Canvas `.bar` without an action: every brand has its own pay button above. */}
              <View
                className="border-t border-line bg-paper px-gutter pt-3"
                style={{ paddingBottom: Math.max(insets.bottom, 16) }}
                accessible
                accessibilityLabel={[summary(data), data.total ? `${t('product.total')} ${formatMoney(data.total)}` : null].filter(Boolean).join(', ')}
              >
                <Text variant="caption" tone="muted">
                  {summary(data)}
                </Text>
                {data.total ? (
                  <Text variant="total" className="mt-0.5 text-[18px]">
                    {formatMoney(data.total)}
                  </Text>
                ) : null}
              </View>
            </>
          )
        }
      </ScreenState>
    </Screen>
  );
}
