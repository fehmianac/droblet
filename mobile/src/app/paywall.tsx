import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Briefcase, Palette, Sparkles, X, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { onboardingStore } from '@/auth/onboarding';
import { useSession } from '@/auth/session';
import { openPrivacy, openTerms } from '@/components/LegalLinks';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Silhouette } from '@/components/ui/Silhouette';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useSelfPremium } from '@/entitlement/selfPremium';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { useStoreProducts } from '@/entitlement/useStoreProducts';
import { CanvasGlyph } from '@/features/account/rows';
import type { StoreProduct } from '@/fixtures/storeProducts';
import { syncPushRegistration } from '@/notify/push';
import { PurchaseStatus } from '@/purchases/PurchaseStatus';
import { paywallCompact, paywallHeroHeight } from '@/purchases/paywallLayout';
import { purchaseFlow, usePurchaseState } from '@/purchases/purchaseFlow';
import { placeholderTones, type PlaceholderTone } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

type Plan = 'year' | 'month';

/** The three look tiles at the top of `Paywall.dc.html`. */
const TILES: { tone: PlaceholderTone; figure: 'ink' | 'cream' }[] = [
  { tone: 'camel', figure: 'ink' },
  { tone: 'dark', figure: 'cream' },
  { tone: 'clay', figure: 'ink' },
];

const BENEFITS: { title: 'paywall.benefitAiTitle' | 'paywall.benefitStylistTitle' | 'paywall.benefitPackingTitle' | 'paywall.benefitPaletteTitle'; body: 'paywall.benefitAiBody' | 'paywall.benefitStylistBody' | 'paywall.benefitPackingBody' | 'paywall.benefitPaletteBody'; icon: LucideIcon | 'mirror' }[] = [
  { title: 'paywall.benefitAiTitle', body: 'paywall.benefitAiBody', icon: 'mirror' },
  { title: 'paywall.benefitStylistTitle', body: 'paywall.benefitStylistBody', icon: Sparkles },
  { title: 'paywall.benefitPackingTitle', body: 'paywall.benefitPackingBody', icon: Briefcase },
  { title: 'paywall.benefitPaletteTitle', body: 'paywall.benefitPaletteBody', icon: Palette },
];

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
  const trial = product?.trialDays ? t('paywall.trialDays', { count: product.trialDays }) : null;
  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, busy: loading }}
      accessibilityLabel={[tag, name, price, trial].filter(Boolean).join(', ')}
      // The 2 pt ink ring of the chosen plan replaces the 1 pt line; the padding keeps both cards the same size.
      className={`flex-1 rounded-card bg-paper ${selected ? 'border-2 border-ink p-[11px]' : 'border border-line p-3'}`}
      testID={`plan-${plan}`}
    >
      <Badge label={tag} tone={plan === 'year' ? 'ink' : 'sand'} />
      <Text variant="bodyMedium" className="mb-0.5 mt-2">
        {name}
      </Text>
      {price ? (
        <Text variant="button" numberOfLines={1} adjustsFontSizeToFit>
          {price}
        </Text>
      ) : (
        <Skeleton className="h-5 w-24 rounded-tag" />
      )}
      {trial ? (
        <Text variant="caption" tone="muted">
          {trial}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Underlined 11.5 footer link with a 44 pt target. */
function FooterLink({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      className="min-h-icon-btn justify-center px-1.5 active:opacity-70"
    >
      <Text variant="caption" className="text-[11.5px] underline">
        {label}
      </Text>
    </Pressable>
  );
}

function Dot() {
  return (
    <Text variant="caption" tone="muted" accessible={false}>
      ·
    </Text>
  );
}

/**
 * 05 Üyelik. Look tiles fading into cream, the promise as the headline, four benefits ("Ayda 30 AI görseli",
 * not unlimited — README §9), two plan cards and the fixed footer. Price, period and trial length always come
 * from the store products (useStoreProducts) — the canvas prices are representative and nothing is stored in
 * the app. The close (×) is always visible; restore, terms and privacy are always present. Buying goes
 * through StoreKit 2 / Play Billing; a second tap while busy is ignored.
 */
export default function PaywallScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [screenHeight, setScreenHeight] = useState(windowHeight);
  const hero = paywallHeroHeight(windowHeight, screenHeight);
  const compact = paywallCompact(windowHeight);
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
  // Until store purchases are live (server switch): the account can turn premium on itself, for free.
  const selfPremium = useSelfPremium();
  const offerSelfPremium = !isMember && entitlement.data?.selfServePremium?.enabled === true;

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

  // StoreKit 2 / Play Billing, confirmed by the server before the store transaction is finished
  // (purchases/purchaseFlow.ts); pending / cancelled / error states show under the button.
  const busy = flow.phase === 'purchasing' || flow.phase === 'verifying' || flow.phase === 'restoring';
  const purchase = () => {
    if (!chosen) return;
    void purchaseFlow.buy(chosen, entitlement.data?.storeAccountToken ?? null, store.data?.purchasesAvailable ?? false);
  };
  const restore = () => {
    if (!busy) void purchaseFlow.restore();
  };

  const trialDays = chosen?.trialDays ?? null;
  let finePrint: string | null = null;
  if (chosen) {
    const price = chosen.localizedPrice;
    const storeName = Platform.OS === 'ios' ? 'App Store' : 'Google Play';
    if (plan === 'year') finePrint = t(trialDays ? 'paywall.finePrintTrialYear' : 'paywall.finePrintYear', { price, store: storeName });
    else finePrint = t(trialDays ? 'paywall.finePrintTrialMonth' : 'paywall.finePrintMonth', { price, store: storeName });
  }

  let action: ReactNode;
  if (isMember) {
    action = (
      <>
        <Button variant="secondary" size="lg" label={t('paywall.manage')} onPress={() => router.replace('/subscription')} />
        <PurchaseStatus state={flow} />
      </>
    );
  } else {
    action = (
      <>
        <Button
          label={trialDays ? t('paywall.startTrial', { count: trialDays }) : t('paywall.subscribe')}
          onPress={purchase}
          disabled={!chosen || busy}
          loading={store.isPending || flow.phase === 'purchasing' || flow.phase === 'verifying'}
          testID="paywall.buy"
        />
        <PurchaseStatus state={flow} />
        {offerSelfPremium ? (
          <View className="items-center">
            <FooterLink
              label={t('selfPremium.paywallLink')}
              onPress={() => {
                if (!selfPremium.isPending) selfPremium.mutate(true);
              }}
              testID="paywall.selfPremium"
            />
            {selfPremium.isError ? (
              <Text variant="caption" tone="danger" className="text-center">
                {t('selfPremium.error')}
              </Text>
            ) : null}
          </View>
        ) : null}
        {finePrint ? (
          <Text variant="caption" tone="muted" className="text-center text-[11px] leading-[15px]">
            {finePrint}
          </Text>
        ) : (
          <Skeleton className="h-4 w-full rounded-tag" />
        )}
      </>
    );
  }

  return (
    <View className="flex-1 bg-cream" onLayout={(e) => setScreenHeight(e.nativeEvent.layout.height)}>
      {/* The footer below is laid out after the scroll view (not over it): the scroll area ends where the footer
          starts, so the bottom padding of the content is exactly the footer's height and nothing hides under it. */}
      <ScrollView className="flex-1" contentContainerClassName="pb-4" testID="paywall.scroll">
        <View style={{ height: hero }} accessible={false} importantForAccessibility="no-hide-descendants">
          <View style={StyleSheet.absoluteFill} className="flex-row gap-1.5 p-1.5">
            {TILES.map((tile) => (
              <View
                key={tile.tone}
                className="flex-1 items-center justify-center overflow-hidden rounded-[16px]"
                style={{ backgroundColor: placeholderTones[tile.tone] }}
              >
                <Silhouette height={Math.round(hero * 0.64)} tone={tile.figure} opacity={0.16} />
              </View>
            ))}
          </View>
          <LinearGradient
            colors={[colors.creamClear, colors.cream]}
            locations={[0.45, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        <View className={`-mt-6 px-6 ${compact ? 'gap-2' : 'gap-3'}`}>
          <Text variant="eyebrow" tone="accent">
            {t('paywall.eyebrow')}
          </Text>
          <Text variant="display" className={compact ? 'text-[26px] leading-[30px]' : 'text-[32px] leading-[34px]'}>
            {t('paywall.tagline')}
          </Text>

          <View className={compact ? 'gap-1' : 'gap-2'}>
            {BENEFITS.map(({ title, body, icon }) => (
              <View key={title} className="flex-row items-center gap-3">
                <View className="h-8 w-8 items-center justify-center rounded-pill border border-line bg-paper">
                  {icon === 'mirror' ? <CanvasGlyph name="mirror" size={16} /> : <Icon icon={icon} size={16} />}
                </View>
                <View className="flex-1">
                  <Text variant="bodyMedium">{t(title)}</Text>
                  {compact ? null : (
                    <Text variant="caption" tone="muted">
                      {t(body)}
                    </Text>
                  )}
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
            </View>
          ) : (
            <View accessibilityRole="radiogroup" className="mt-1 flex-row gap-2">
              <PlanOption plan="year" product={yearly} selected={plan === 'year'} onSelect={() => setPlan('year')} loading={store.isPending} />
              <PlanOption plan="month" product={monthly} selected={plan === 'month'} onSelect={() => setPlan('month')} loading={store.isPending} />
            </View>
          )}
        </View>
      </ScrollView>

      {/* iOS presents 05 as a page sheet (below the status bar), so the × sits in the strip's top corner; elsewhere it is full screen. */}
      <View className="absolute right-5" style={{ top: Platform.OS === 'ios' ? 16 : insets.top + 4 }}>
        <IconButton icon={X} onPress={() => void close()} variant="inverse" accessibilityLabel={t('a11y.close')} className="border border-line" testID="paywall.close" />
      </View>

      <View className="gap-1 px-6 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }} testID="paywall.footer">
        {action}
        <View className="flex-row flex-wrap items-center justify-center gap-x-1">
          <FooterLink label={t('paywall.restore')} onPress={restore} testID="paywall.restore" />
          <Dot />
          <FooterLink label={t('paywall.termsShort')} onPress={openTerms} />
          <Dot />
          <FooterLink label={t('paywall.privacyShort')} onPress={openPrivacy} />
        </View>
      </View>
    </View>
  );
}
