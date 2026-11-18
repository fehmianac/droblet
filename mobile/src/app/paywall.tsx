import { router, useLocalSearchParams } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { track } from '@/analytics/track';
import { onboardingStore } from '@/auth/onboarding';
import { useSession } from '@/auth/session';
import { openPrivacy, openTerms } from '@/components/LegalLinks';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { useStoreProducts } from '@/entitlement/useStoreProducts';
import type { StoreProduct } from '@/fixtures/storeProducts';
import { syncPushRegistration } from '@/notify/push';
import { PurchaseStatus } from '@/purchases/PurchaseStatus';
import { purchaseFlow, usePurchaseState } from '@/purchases/purchaseFlow';

type Plan = 'year' | 'month';

const BENEFITS = [
  ['paywall.benefitAiTitle', 'paywall.benefitAiBody'],
  ['paywall.benefitStylistTitle', 'paywall.benefitStylistBody'],
  ['paywall.benefitPackingTitle', 'paywall.benefitPackingBody'],
  ['paywall.benefitPaletteTitle', 'paywall.benefitPaletteBody'],
] as const;

function PlanOption({
  plan,
  product,
  selected,
  onSelect,
  loading,
}: {
  plan: Plan;
  product: StoreProduct | undefined;
  selected: boolean;
  onSelect: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const tag = t(plan === 'year' ? 'paywall.bestValue' : 'paywall.flexible');
  const name = t(plan === 'year' ? 'paywall.yearly' : 'paywall.monthly');
  const price = product
    ? t(plan === 'year' ? 'paywall.perYear' : 'paywall.perMonth', { price: product.localizedPrice })
    : null;
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, busy: loading }}
      accessibilityLabel={[tag, name, price].filter(Boolean).join(', ')}
      className={`flex-1 gap-1 rounded-card border bg-paper p-4 ${selected ? 'border-ink' : 'border-line'}`}
    >
      <Text variant="caption" tone="accent">
        {tag}
      </Text>
      <Text variant="h3">{name}</Text>
      {price ? <Text variant="bodyMedium">{price}</Text> : <Skeleton className="mt-1 h-5 w-24 rounded-field" />}
    </Pressable>
  );
}

/**
 * 05 Üyelik. Copy per README §9: "Ayda 30 AI görseli" (not unlimited). Price, period and trial length
 * always come from the store products (useStoreProducts); the close (×) is always visible; restore,
 * terms and privacy links are always present. Buying goes through StoreKit 2 / Play Billing and is
 * confirmed by the server before the store transaction is finished (purchases/purchaseFlow.ts);
 * pending / cancelled / error states are shown under the button. A second tap while busy is ignored.
 */
export default function PaywallScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const session = useSession();
  const store = useStoreProducts();
  const entitlement = useEntitlement();
  const [plan, setPlan] = useState<Plan>('year');
  const flow = usePurchaseState();

  useEffect(() => {
    track('paywall_viewed', { from: from ?? 'unknown' });
    purchaseFlow.reset();
    return () => purchaseFlow.reset();
  }, [from]);

  const subscribedProduct = flow.phase === 'success' ? flow.productId : null;
  useEffect(() => {
    if (subscribedProduct) track('subscribed', { productId: subscribedProduct });
  }, [subscribedProduct]);

  const products = store.data?.products ?? [];
  const yearly = products.find((p) => p.kind === 'subscription' && p.period === 'year');
  const monthly = products.find((p) => p.kind === 'subscription' && p.period === 'month');
  const chosen = plan === 'year' ? yearly : monthly;
  const isMember = entitlement.data?.tier === 'member';

  const close = async () => {
    if (from === 'onboarding' && session.status === 'signedIn') {
      await onboardingStore.markDone(session.user.id);
      track('signup_step', { step: 'done' });
      // Onboarding is over: the sensible moment to ask for push (morning outfit, weekly edit).
      void syncPushRegistration({ ask: true });
      router.replace('/');
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const busy = flow.phase === 'purchasing' || flow.phase === 'verifying' || flow.phase === 'restoring';
  const purchase = () => {
    if (!chosen) return;
    void purchaseFlow.buy(chosen, entitlement.data?.storeAccountToken ?? null, store.data?.purchasesAvailable ?? false);
  };
  const restore = () => void purchaseFlow.restore();

  const pricePerPeriod = chosen
    ? t(plan === 'year' ? 'paywall.perYear' : 'paywall.perMonth', { price: chosen.localizedPrice })
    : null;
  const trialDays = chosen?.trialDays ?? null;

  return (
    <Screen bottom>
      <View className="flex-row justify-end px-gutter pt-2">
        <IconButton icon={X} variant="plain" onPress={() => void close()} accessibilityLabel={t('a11y.close')} testID="paywall.close" />
      </View>
      <ScrollView contentContainerClassName="gap-7 px-gutter pb-6">
        <View className="gap-2">
          <Text variant="eyebrow">{t('paywall.eyebrow')}</Text>
          <Text variant="display">{t('paywall.title')}</Text>
          <Text variant="body" tone="muted">
            {t('paywall.tagline')}
          </Text>
        </View>

        <View className="gap-4">
          {BENEFITS.map(([title, body]) => (
            <View key={title} className="flex-row gap-3">
              <View className="h-7 w-7 items-center justify-center rounded-pill bg-sand">
                <Icon icon={Check} tone="accent" size={16} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text variant="bodyMedium">{t(title)}</Text>
                <Text variant="body" tone="muted">
                  {t(body)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {isMember ? (
          <View className="gap-2 rounded-card bg-sand p-4">
            <Text variant="bodyMedium">{t('paywall.active')}</Text>
            {entitlement.data?.inGracePeriod ? (
              <Text variant="caption" tone="danger">
                {t('purchase.gracePeriod')}
              </Text>
            ) : null}
            <PurchaseStatus state={flow} />
          </View>
        ) : (
          <View className="gap-4">
            <View accessibilityRole="radiogroup" className="flex-row gap-3">
              <PlanOption plan="year" product={yearly} selected={plan === 'year'} onSelect={() => setPlan('year')} loading={store.isPending} />
              <PlanOption plan="month" product={monthly} selected={plan === 'month'} onSelect={() => setPlan('month')} loading={store.isPending} />
            </View>

            <Button
              label={trialDays ? t('paywall.startTrial', { count: trialDays }) : t('paywall.subscribe')}
              onPress={purchase}
              disabled={!chosen || busy}
              loading={store.isPending || flow.phase === 'purchasing' || flow.phase === 'verifying'}
              testID="paywall.buy"
            />
            <PurchaseStatus state={flow} />
            {pricePerPeriod ? (
              <Text variant="caption" tone="muted" className="text-center">
                {t(trialDays ? 'paywall.renewalTrial' : 'paywall.renewal', { price: pricePerPeriod })}
              </Text>
            ) : (
              <Skeleton className="h-4 w-full rounded-field" />
            )}
            <Text variant="caption" tone="muted" className="text-center">
              {t('paywall.cancelAnytime')}
            </Text>
          </View>
        )}

        <View className="items-center gap-1">
          <Button variant="text" label={t('paywall.restore')} onPress={restore} disabled={busy} loading={flow.phase === 'restoring'} testID="paywall.restore" />
          <View className="flex-row items-center gap-1">
            <Button variant="text" label={t('paywall.terms')} onPress={openTerms} />
            <Text variant="caption" tone="muted">
              ·
            </Text>
            <Button variant="text" label={t('paywall.privacy')} onPress={openPrivacy} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
