import { router } from 'expo-router';
import { ExternalLink, RotateCcw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Platform, Pressable, ScrollView, View } from 'react-native';

import type { Entitlement } from '@/api/contracts';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useEntitlement } from '@/entitlement/useEntitlement';
import { ProfileMenuRow, RowCard } from '@/features/account/rows';
import { usedShare } from '@/features/credits/CreditPackSheet';
import { openCreditTopUp } from '@/features/credits/useAiCredits';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate, formatDayMonth } from '@/lib/format';
import { suffixed } from '@/lib/trSuffix';
import { PurchaseStatus } from '@/purchases/PurchaseStatus';
import { purchaseFlow, usePurchaseState } from '@/purchases/purchaseFlow';
import { useThemeColors } from '@/theme/useThemeColors';

/** Where the store keeps the user's subscriptions; the app cannot cancel or change a plan itself. */
const STORE_SUBSCRIPTIONS_URL = {
  ios: 'https://apps.apple.com/account/subscriptions',
  android: 'https://play.google.com/store/account/subscriptions',
} as const;

function storeSubscriptionsUrl(): string {
  return Platform.OS === 'android' ? STORE_SUBSCRIPTIONS_URL.android : STORE_SUBSCRIPTIONS_URL.ios;
}

/** One "label — value" line of the plan card. */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3" accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="body" className="flex-1">
        {label}
      </Text>
      <Text variant="bodyMedium">{value}</Text>
    </View>
  );
}

/** The month's AI image balance, in the ink card of 28 Profil, with "Kredi yükle" (→ 05b). */
function CreditsCard({ credits }: { credits: Entitlement['credits'] }) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const language = useAppLanguage();
  const { monthlyAllowance, remaining, resetsAt } = credits;
  const used = Math.max(0, monthlyAllowance - remaining);
  const left = t('subscription.creditsLeft', { total: monthlyAllowance, remaining: suffixed(remaining, 'possessive', language) });
  const soft = { color: colors.sand };
  return (
    <View className="gap-2.5 rounded-card bg-ink p-3.5" testID="subscription-credits">
      <View className="flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Text variant="eyebrow" style={soft}>
          {t('subscription.creditsEyebrow')}
        </Text>
        <Text variant="caption" style={soft}>
          {t('credits.renewal', { date: formatDayMonth(new Date(resetsAt)) })}
        </Text>
      </View>
      <Text variant="title" tone="cream">
        {left}
      </Text>
      <View
        className="h-1.5 overflow-hidden rounded-pill bg-cream/20"
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={left}
        accessibilityValue={{ min: 0, max: monthlyAllowance, now: remaining }}
      >
        <View className="h-full rounded-pill bg-cream" style={{ width: `${Math.round((1 - usedShare(monthlyAllowance, remaining)) * 100)}%` }} />
      </View>
      <View className="flex-row items-center justify-between gap-2.5">
        <Text variant="caption" style={soft} className="flex-1">
          {t('credits.used', { used, total: monthlyAllowance })}
        </Text>
        <Pressable
          onPress={() => openCreditTopUp(true)}
          accessibilityRole="button"
          accessibilityLabel={t('subscription.topUp')}
          hitSlop={{ top: 2, bottom: 2 }}
          className="h-10 items-center justify-center rounded-pill bg-cream px-4 active:opacity-80"
          testID="subscription-top-up"
        >
          <Text variant="segment" tone="ink" numberOfLines={1}>
            {t('subscription.topUp')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * Üyelik yönetimi (no board — derived from 05 Üyelik, 28 Profil and 29 Ayarlar): the current plan and its
 * renewal date, the month's AI image balance with "Kredi yükle", and the store actions (manage in the
 * store's subscription settings, restore purchases). Tier, credits and dates come from
 * `GET v1/tenant/entitlement`; the app keeps no plan or price of its own. Detail screen: no bottom menu.
 */
export default function SubscriptionScreen() {
  const { t } = useTranslation();
  const entitlement = useEntitlement();

  const manageInStore = () => {
    void Linking.openURL(storeSubscriptionsUrl()).catch(() => Alert.alert(t('subscription.title'), t('subscription.storeLinkFailed')));
  };
  // Restore through StoreKit 2 / Play Billing; the server confirms and the entitlement refreshes.
  const flow = usePurchaseState();
  const restore = () => {
    if (flow.phase !== 'restoring') void purchaseFlow.restore();
  };

  const billing = t(Platform.OS === 'ios' ? 'subscription.billingApple' : Platform.OS === 'android' ? 'subscription.billingGoogle' : 'subscription.billingStore');

  return (
    <Screen bottom>
      <ScreenHeader title={t('subscription.title')} />
      <ScreenState query={entitlement}>
        {(data) => {
          const isMember = data.tier === 'member';
          return (
            <ScrollView className="flex-1" contentContainerClassName="gap-4 px-gutter pb-8 pt-2">
              <View className="gap-3 rounded-card border border-line bg-paper p-4" testID="subscription-plan">
                <View className="flex-row items-center justify-between gap-3">
                  <Text variant="eyebrow" tone={isMember ? 'accent' : 'muted'}>
                    {t('subscription.planEyebrow')}
                  </Text>
                  <Badge label={t(isMember ? 'subscription.statusActive' : 'subscription.statusFree')} tone={isMember ? 'accent' : 'sand'} />
                </View>
                <Text variant="h2">{t(isMember ? 'subscription.planMember' : 'subscription.planFree')}</Text>
                {isMember ? (
                  <View className="gap-2.5">
                    <View className="h-px bg-line" />
                    <DetailLine
                      label={t('subscription.renewalLabel')}
                      value={formatDate(new Date(data.credits.resetsAt), { day: 'numeric', month: 'long', year: 'numeric' })}
                    />
                    <DetailLine label={t('subscription.billingLabel')} value={billing} />
                  </View>
                ) : (
                  <>
                    <Text variant="body" tone="muted">
                      {t('subscription.freeBody')}
                    </Text>
                    <Button
                      size="bar"
                      label={t('subscription.seePlans')}
                      onPress={() => router.push({ pathname: '/paywall', params: { from: 'subscription' } })}
                    />
                  </>
                )}
              </View>

              {isMember ? <CreditsCard credits={data.credits} /> : null}

              <Text variant="eyebrow" className="mt-2">
                {t('subscription.manageEyebrow')}
              </Text>
              <RowCard>
                <ProfileMenuRow first icon={ExternalLink} label={t('subscription.manageInStore')} onPress={manageInStore} testID="subscription-manage" />
                <ProfileMenuRow icon={RotateCcw} label={t('subscription.restore')} onPress={restore} testID="subscription-restore" />
                {/* Inside the row card: the line keeps the card's bottom padding instead of touching its border. */}
                <PurchaseStatus state={flow} className="pb-3" />
              </RowCard>
              <Text variant="caption" tone="muted" className="leading-[18px]">
                {t('subscription.storeNote')}
              </Text>
            </ScrollView>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
