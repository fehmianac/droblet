import { Bell, CalendarDays, CloudSun, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { track } from '@/analytics/track';
import { useSession } from '@/auth/session';
import { StepHeader } from '@/components/auth/StepHeader';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { finishOnboarding } from '@/features/onboarding/finish';
import { useTeenRules } from '@/features/teen/store';
import { askForPush, markPushAsked } from '@/notify/push';

type Row = { key: string; icon: LucideIcon; title: string; body: string };

/**
 * 04d Bildirim izni (canvas 19) — the soft ask before the system prompt, after 04b İlk 5 parça and before
 * 06 Bugün (onboarding never ends on 05 Üyelik). Only reached while the OS can still ask (`continueAfterFirstItems`).
 * "Bildirimlere izin ver" shows the system prompt and registers this installation; "Şimdi değil" shows no
 * prompt, so a notification toggle can still ask later. Either answer moves on. Teen (canvas 18): marketing
 * and social notifications are off, so only the morning outfit and the "result ready" rows are listed.
 */
export default function PushPermissionScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const teen = useTeenRules().isTeen;
  const variant = teen ? 'teen' : 'adult';
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    track('push_permission', { action: 'shown', source: 'onboarding', variant });
  }, [variant]);

  const rows: Row[] = [
    { key: 'morning', icon: CloudSun, title: t('pushAsk.morningTitle'), body: t('pushAsk.morningBody') },
    ...(teen ? [] : [{ key: 'weekly', icon: CalendarDays, title: t('pushAsk.weeklyTitle'), body: t('pushAsk.weeklyBody') }]),
    { key: 'result', icon: Sparkles, title: t('pushAsk.resultTitle'), body: t('pushAsk.resultBody') },
  ];

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    track('push_permission', { action: 'allow', source: 'onboarding', variant });
    const granted = await askForPush('onboarding');
    track('signup_step', { step: 'push_permission', granted });
    setBusy(false);
    finishOnboarding(userId);
  };

  const notNow = () => {
    if (busy) return;
    track('push_permission', { action: 'decline', source: 'onboarding', variant });
    track('signup_step', { step: 'push_permission', skipped: true });
    void markPushAsked();
    finishOnboarding(userId);
  };

  return (
    <Screen>
      <StepHeader step={4} total={4} hideCount />
      <ScrollView className="flex-1" contentContainerClassName="gap-[22px] px-6 pb-4 pt-7">
        <View className="h-14 w-14 items-center justify-center rounded-pill bg-sand" accessible={false}>
          <Icon icon={Bell} size={26} />
        </View>
        <View className="gap-2">
          <Text variant="eyebrow">{t('pushAsk.eyebrow')}</Text>
          <Text variant="display" className="text-[29px] leading-[31px]">
            {t('pushAsk.title')}
          </Text>
          <Text variant="body" tone="muted">
            {t(teen ? 'pushAsk.bodyTeen' : 'pushAsk.body')}
          </Text>
        </View>
        <View className="rounded-card border border-line bg-paper px-4 py-1" testID="pushAsk.rows">
          {rows.map((row, i) => (
            <View
              key={row.key}
              testID={`pushAsk.row.${row.key}`}
              accessible
              className={`flex-row items-start gap-3 py-3 ${i > 0 ? 'border-t border-line' : ''}`}
            >
              <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
                <Icon icon={row.icon} size={18} />
              </View>
              <View className="flex-1 gap-0.5">
                <Text variant="bodyMedium">{row.title}</Text>
                <Text variant="caption" tone="muted">
                  {row.body}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Text variant="caption" tone="muted">
          {t('pushAsk.settingsHint')}
        </Text>
      </ScrollView>
      <View className="gap-1 px-6 pt-2" style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
        <Button testID="pushAsk.allow" label={t('pushAsk.allow')} onPress={() => void allow()} loading={busy} />
        <Button testID="pushAsk.notNow" variant="text" label={t('pushAsk.notNow')} onPress={notNow} disabled={busy} />
      </View>
    </Screen>
  );
}
