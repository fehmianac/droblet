import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import { Briefcase, Palette, Sparkles, X, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import type { AppSegment } from '@/api/contracts';
import { onboardingStore } from '@/auth/onboarding';
import { useSession } from '@/auth/session';
import { openPrivacy, openTerms } from '@/components/LegalLinks';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { useStoreProducts } from '@/entitlement/useStoreProducts';
import { CanvasGlyph } from '@/features/account/rows';
import { useSegment } from '@/features/segment/store';
import type { StoreProduct } from '@/fixtures/storeProducts';
import { PurchaseStatus } from '@/purchases/PurchaseStatus';
import { paywallCompact, paywallHeroHeight } from '@/purchases/paywallLayout';
import { purchaseFlow, usePurchaseState } from '@/purchases/purchaseFlow';
import { visualTones } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

type Plan = 'year' | 'month';

/** The editorial photo at the top of 05 by segment (canvas 22a); landscape shots with the person right of centre, so a short
    strip keeps the face (about a quarter down) and a narrow one keeps the person. No segment yet = women. */
const HERO_PHOTOS: Record<AppSegment, { source: number; left: `${number}%`; top: `${number}%` }> = {
  women: { source: require('../../assets/visuals/paywall-woman.webp'), left: '58%', top: '24%' },
  men: { source: require('../../assets/visuals/paywall-man.webp'), left: '56%', top: '20%' },
};
/** The "Önce üzerinde gör" badge: 26 high, centred on the 44 pt close button beside it. */
const BADGE_HEIGHT = 26;
/** The board's photo height (22a); the strip grows to it when the offer leaves room. */
const HERO_MAX_HEIGHT = 300;

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
  // The price is the store's; without one (the store gave no products) the card shows the plan alone.
  const price = product?.localizedPrice
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
      ) : product ? null : (
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

/**
 * Underlined 11.5 footer link with a 44 pt target. `compact` (a 4.7" screen) trims the side padding and the size
 * by half a point so restore · terms · privacy stay on one line — two lines of 44 pt targets pushed the plans
 * under the footer on an iPhone SE.
 */
function FooterLink({ label, onPress, testID, compact = false }: { label: string; onPress: () => void; testID?: string; compact?: boolean }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      className={`min-h-icon-btn justify-center active:opacity-70 ${compact ? 'px-1' : 'px-1.5'}`}
    >
      <Text variant="caption" className={`underline ${compact ? 'text-[11px]' : 'text-[11.5px]'}`}>
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
 * 05 Üyelik. The segment's editorial photo fading into cream with the "Önce üzerinde gör" badge (canvas 22a), the promise as the headline, four benefits ("Ayda 30 AI görseli",
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
  const base = paywallHeroHeight(windowHeight, screenHeight);
  // 22a: the photo takes whatever height the offer leaves free above the footer (up to the board's 300), never less than
  // the strip that keeps both plans visible — measured from the content and footer, so no price moves under the CTA.
  const [contentHeight, setContentHeight] = useState(0);
  const [footerHeight, setFooterHeight] = useState(0);
  const baseOverlap = base < 136 ? 24 : 36;
  const free = contentHeight && footerHeight ? screenHeight - footerHeight - contentHeight + baseOverlap - 16 : 0;
  const hero = Math.max(base, Math.min(HERO_MAX_HEIGHT, Math.floor(free / 4) * 4));
  const compact = paywallCompact(windowHeight);
  const { from } = useLocalSearchParams<{ from?: string }>();
  const session = useSession();
  const store = useStoreProducts();
  const entitlement = useEntitlement();
  const [plan, setPlan] = useState<Plan>('year');
  const flow = usePurchaseState();
  const segment = useSegment();
  const heroPhoto = HERO_PHOTOS[segment];
  const closeTop = Platform.OS === 'ios' ? 16 : insets.top + 4;
  // The text overlaps the fade by 36 pt (canvas -44 on a 300 strip); a short strip keeps the old 24 so nothing crowds.
  const overlap = hero < 136 ? 24 : 36;
  const badgeTop = closeTop + (44 - BADGE_HEIGHT) / 2;
  // The badge only shows where it clears the text below (not on the 76 pt compact strip).
  const showBadge = badgeTop + BADGE_HEIGHT + 6 <= hero - overlap;

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
  if (chosen?.localizedPrice) {
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
        <View style={{ height: hero }} className="overflow-hidden bg-sand">
          <Image
            source={heroPhoto.source}
            contentFit="cover"
            contentPosition={{ left: heroPhoto.left, top: heroPhoto.top }}
            style={StyleSheet.absoluteFill}
            accessible={false}
            testID={`paywall.hero.${segment}`}
          />
          <LinearGradient
            colors={[visualTones.inkTop, visualTones.inkClear, colors.creamClear, colors.cream]}
            locations={[0, 0.26, 0.58, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          {showBadge ? (
            <View
              className="absolute left-5 flex-row items-center gap-1 rounded-pill px-2.5"
              style={{ top: badgeTop, height: BADGE_HEIGHT, backgroundColor: visualTones.badge }}
              testID="paywall.heroBadge"
            >
              <Icon icon={Sparkles} size={12} tone="cream" />
              <Text variant="badge" tone="cream" numberOfLines={1}>
                {t('paywall.heroBadge')}
              </Text>
            </View>
          ) : null}
        </View>

        <View
          className={`px-6 ${overlap === 36 ? '-mt-9' : '-mt-6'} ${compact ? 'gap-2' : 'gap-3'}`}
          onLayout={(e) => setContentHeight(e.nativeEvent.layout.height)}
        >
          <Text variant="eyebrow" tone="accent">
            {t('paywall.eyebrow')}
          </Text>
          <Text variant="display" className={compact ? 'text-[26px] leading-[30px]' : 'text-[32px] leading-[34px]'}>
            {t('paywall.tagline')}
          </Text>

          <View className={compact ? 'gap-0.5' : 'gap-2'}>
            {BENEFITS.map(({ title, body, icon }) => (
              <View key={title} className="flex-row items-center gap-3">
                <View
                  className={`items-center justify-center rounded-pill border border-line bg-paper ${compact ? 'h-7 w-7' : 'h-8 w-8'}`}
                >
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
      <View className="absolute right-5" style={{ top: closeTop }}>
        <IconButton icon={X} onPress={() => void close()} variant="inverse" accessibilityLabel={t('a11y.close')} className="border border-line" testID="paywall.close" />
      </View>

      <View
        className="gap-1 px-6 pt-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
        onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
        testID="paywall.footer"
      >
        {action}
        {/* Each separator travels with the link after it, so a wrapped line never ends on a lone "·". */}
        <View className={`flex-row flex-wrap items-center justify-center ${compact ? 'gap-x-0.5' : 'gap-x-1'}`} testID="paywall.legal">
          <FooterLink label={t('paywall.restore')} onPress={restore} testID="paywall.restore" compact={compact} />
          <View className={`flex-row items-center ${compact ? 'gap-x-0.5' : 'gap-x-1'}`}>
            <Dot />
            <FooterLink label={t('paywall.termsShort')} onPress={openTerms} compact={compact} />
          </View>
          <View className={`flex-row items-center ${compact ? 'gap-x-0.5' : 'gap-x-1'}`}>
            <Dot />
            <FooterLink label={t('paywall.privacyShort')} onPress={openPrivacy} compact={compact} />
          </View>
        </View>
      </View>
    </View>
  );
}
