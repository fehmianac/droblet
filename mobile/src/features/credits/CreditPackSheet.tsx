import { Sparkle, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { useStoreProducts } from '@/entitlement/useStoreProducts';
import { formatDayMonth } from '@/lib/format';

import { creditSheetStore, useCreditSheetReason, type CreditSheetReason } from './creditSheetStore';

/** Share of the monthly allowance already used, 0–1. Pure. */
export function usedShare(monthlyAllowance: number, remaining: number): number {
  if (monthlyAllowance <= 0) return 1;
  return Math.min(1, Math.max(0, (monthlyAllowance - remaining) / monthlyAllowance));
}

/**
 * 05b Ek kredi paketi. Opens when the month's AI image credits are used up (not the paywall) and
 * from Profil / Üyelik "Kredi yükle". Numbers come from the server (`GET v1/tenant/entitlement`), the
 * pack's price and size from the store products. Buying stays disabled until the billing bridge (E10).
 */
export function CreditPackSheet({ reason }: { reason: CreditSheetReason }) {
  const { t } = useTranslation();
  const entitlement = useEntitlement();
  const store = useStoreProducts();

  const close = () => creditSheetStore.close();
  const pack = store.data?.products.find((p) => p.kind === 'consumable' && p.credits !== null);
  const credits = entitlement.data?.credits;
  const used = credits ? Math.max(0, credits.monthlyAllowance - credits.remaining) : null;

  const buy = () => {
    if (!store.data?.purchasesAvailable) Alert.alert(t('credits.titleTopUp'), t('paywall.storeUnavailable'));
  };

  return (
    <BottomSheet visible onClose={close}>
      {/* The sheet insets 20; the board draws this one at 24. */}
      <View className="gap-[18px] px-1 pb-1">
        <View className="flex-row items-start justify-between gap-2">
          <View className="flex-1 gap-2">
            <Text variant="eyebrow" tone="accent">
              {t('credits.eyebrow')}
            </Text>
            <Text variant="h2">
              {reason === 'exhausted' && credits
                ? t('credits.titleExhausted', { total: credits.monthlyAllowance })
                : t('credits.titleTopUp')}
            </Text>
          </View>
          <IconButton icon={X} variant="plain" onPress={close} accessibilityLabel={t('a11y.close')} className="-mr-2.5 -mt-1.5" testID="credit-pack-close" />
        </View>

        {credits && used !== null ? (
          <View className="gap-1.5">
            <View
              className="h-1.5 overflow-hidden rounded-pill bg-sand"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel={t('credits.used', { used, total: credits.monthlyAllowance })}
              accessibilityValue={{ min: 0, max: credits.monthlyAllowance, now: used }}
            >
              <View
                className="h-full rounded-pill bg-accent"
                style={{ width: `${Math.round(usedShare(credits.monthlyAllowance, credits.remaining) * 100)}%` }}
              />
            </View>
            <View className="flex-row justify-between gap-3">
              <Text variant="caption" tone="muted">
                {t('credits.used', { used, total: credits.monthlyAllowance })}
              </Text>
              <Text variant="caption" tone="muted">
                {t('credits.renewal', { date: formatDayMonth(new Date(credits.resetsAt)) })}
              </Text>
            </View>
          </View>
        ) : null}

        {pack && pack.credits !== null ? (
          // One pack, shown as the chosen option: 2 pt ink ring.
          <View className="flex-row items-center gap-3.5 rounded-card border-2 border-ink bg-paper p-4" accessible>
            <View className="h-icon-btn w-icon-btn items-center justify-center rounded-pill bg-sand">
              <Icon icon={Sparkle} size={20} />
            </View>
            <View className="flex-1">
              <Text variant="button">{t('credits.pack', { count: pack.credits })}</Text>
              <Text variant="caption" tone="muted">
                {t('credits.packMeta')}
              </Text>
            </View>
            <Text variant="total" className="text-[16px]">
              {pack.localizedPrice}
            </Text>
          </View>
        ) : (
          <Skeleton className="h-20 w-full rounded-card" />
        )}

        <Text variant="caption" tone="muted" className="leading-[18px]">
          {t('credits.note')}
        </Text>

        <View className="gap-1.5">
          <Button
            label={pack ? t('credits.buy', { price: pack.localizedPrice }) : t('me.topUp')}
            onPress={buy}
            disabled={!pack}
            loading={store.isPending}
            testID="credit-pack-buy"
          />
          <Button variant="text" label={t('credits.notNow')} onPress={close} />
        </View>
      </View>
    </BottomSheet>
  );
}

/** Mounts the sheet (and its entitlement / store queries) only while it is open. */
export function CreditSheetHost() {
  const reason = useCreditSheetReason();
  return reason ? <CreditPackSheet reason={reason} /> : null;
}
