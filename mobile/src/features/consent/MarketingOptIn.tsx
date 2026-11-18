import AsyncStorage from '@react-native-async-storage/async-storage';
import { Mail, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { CONSENTS_FOR } from '@/api/contracts/consents';
import { useSession } from '@/auth/session';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useSaveNotificationSettings } from '@/features/account/mutations';
import { useNotificationSettings } from '@/features/account/queries';
import { syncPushRegistration } from '@/notify/push';

import { recordOf, useConsents } from './api';
import { ensureConsents } from './store';

const dismissKey = (userId: string) => `droblet.marketingOptIn.${userId}`;

/**
 * The ONE opt-in card for marketing notifications (explicit consent 5), on Bugün after onboarding:
 * the weekly edit is off until the user says yes here or in Bildirimler. "Evet, gönder" shows the
 * consent text (its own sheet), records it, then switches the weekly edit on. Either answer hides the
 * card for good on this device; it never shows while the consent is already given.
 */
export function MarketingOptInCard({ className }: { className?: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const consents = useConsents();
  const settings = useNotificationSettings();
  const save = useSaveNotificationSettings();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void AsyncStorage.getItem(dismissKey(userId))
      .then((v) => alive && setDismissed(v === 'done'))
      .catch(() => alive && setDismissed(false));
    return () => {
      alive = false;
    };
  }, [userId]);

  const given = recordOf(consents.data, 'marketingNotifications')?.valid;
  if (dismissed !== false || given !== false || !settings.data || settings.data.weeklyEdit) return null;

  const close = () => {
    setDismissed(true);
    if (userId) void AsyncStorage.setItem(dismissKey(userId), 'done').catch(() => undefined);
  };
  const yes = () => {
    void ensureConsents(CONSENTS_FOR.marketing, 'marketing_card').then((ok) => {
      if (!ok) return;
      const current = settings.data;
      if (current) save({ ...current, weeklyEdit: true });
      void syncPushRegistration({ ask: true });
      close();
    });
  };

  return (
    <View className={`gap-3 rounded-card border border-line bg-paper px-4 py-4 ${className ?? ''}`} testID="marketing-opt-in">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand" accessible={false}>
          <Icon icon={Mail} size={18} />
        </View>
        <View className="flex-1 gap-1">
          <Text variant="bodyMedium">{t('consent.marketingTitle')}</Text>
          <Text variant="caption" tone="muted">
            {t('consent.marketingBody')}
          </Text>
        </View>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t('a11y.close')} hitSlop={12} className="active:opacity-70">
          <Icon icon={X} size={16} />
        </Pressable>
      </View>
      <View className="flex-row gap-2">
        <Button size="md" label={t('consent.marketingYes')} onPress={yes} className="flex-1" testID="marketing-opt-in.yes" />
        <Button variant="secondary" size="md" label={t('consent.marketingNo')} onPress={close} className="flex-1" testID="marketing-opt-in.no" />
      </View>
    </View>
  );
}
