import { router, useLocalSearchParams } from 'expo-router';
import { Cake, CameraOff, Check, Lock, Mail, Trash2, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { Card } from '@/components/blocks/basics';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useTeenRules } from '@/features/teen/store';

export type TeenNoticeKind = 'approved' | 'declined' | 'withdrawn' | 'adult';

function Row({ icon, text, muted }: { icon: LucideIcon; text: string; muted?: boolean }) {
  return (
    <View className="min-h-[30px] flex-row items-center gap-2.5">
      <Icon icon={icon} size={16} tone={muted ? 'muted' : 'ink'} />
      <Text variant="body" tone={muted ? 'muted' : 'ink'} className="flex-1 text-[14px]">
        {text}
      </Text>
    </View>
  );
}

function Hero({ icon, dark }: { icon: LucideIcon; dark?: boolean }) {
  return (
    <View className={`h-[88px] w-[88px] items-center justify-center rounded-pill ${dark ? 'bg-ink' : 'bg-sand'}`}>
      <Icon icon={icon} size={36} tone={dark ? 'cream' : 'ink'} />
    </View>
  );
}

/**
 * One-time full-screen notices of canvas 18: the parent approved / declined / withdrew, and "18 yaşına girdin".
 * `TeenHost` opens it once per change (remembered per user on this phone).
 */
export default function TeenNoticeScreen() {
  const { t } = useTranslation();
  const { kind } = useLocalSearchParams<{ kind?: TeenNoticeKind }>();
  const rules = useTeenRules();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const toParent = () => router.replace({ pathname: '/teen/parent', params: { edit: '1' } });

  let hero: { icon: LucideIcon; dark?: boolean };
  let eyebrow = t('teen.notice.eyebrow');
  let title: string;
  let body: string;
  let rows: { icon: LucideIcon; text: string; muted?: boolean }[] = [];
  let rowsTitle: string | null = null;
  let note: string | null = null;
  let primary: { label: string; onPress: () => void };
  let secondary: { label: string; onPress: () => void } | null = null;

  if (kind === 'approved') {
    const tryOn = rules.tryOn === 'open';
    const tryOnLabel = tryOn
      ? t('teen.notice.approvedTryOn')
      : rules.tryOn === 'unavailable'
        ? t('teen.notice.approvedTryOnOff')
        : t('teen.notice.approvedTryOnNo');
    hero = { icon: Check, dark: true };
    title = t('teen.notice.approvedTitle');
    body = t('teen.notice.approvedBody');
    rows = [
      { icon: Check, text: t('teen.notice.approvedStylist') },
      { icon: Check, text: t('teen.notice.approvedPhotos') },
      { icon: tryOn ? Check : Lock, text: tryOnLabel, muted: !tryOn },
    ];
    primary = { label: t('teen.notice.approvedAction'), onPress: close };
  } else if (kind === 'declined') {
    hero = { icon: Mail };
    title = t('teen.notice.declinedTitle');
    body = t('teen.notice.declinedBody');
    primary = { label: t('teen.notice.declinedAction'), onPress: toParent };
    secondary = { label: t('teen.notice.ok'), onPress: close };
  } else if (kind === 'withdrawn') {
    hero = { icon: CameraOff };
    title = t('teen.notice.withdrawnTitle');
    body = t('teen.notice.withdrawnBody');
    rows = [
      { icon: Trash2, text: t('teen.notice.withdrawnPhotos') },
      { icon: Trash2, text: t('teen.notice.withdrawnTryOn') },
      { icon: Lock, text: t('teen.notice.withdrawnLocked') },
    ];
    primary = { label: t('teen.notice.ok'), onPress: close };
    secondary = { label: t('teen.notice.withdrawnAction'), onPress: toParent };
  } else {
    hero = { icon: Cake, dark: true };
    eyebrow = t('teen.notice.adultEyebrow');
    title = t('teen.notice.adultTitle');
    body = t('teen.notice.adultBody');
    rowsTitle = t('teen.notice.adultOpen');
    rows = [
      { icon: Check, text: t('teen.notice.adultSocial') },
      { icon: Check, text: t('teen.notice.adultStore') },
      { icon: Check, text: t('teen.notice.adultMembership') },
    ];
    note = t('teen.notice.adultNote');
    primary = { label: t('teen.notice.adultAction'), onPress: close };
    secondary = { label: t('teen.notice.adultSettings'), onPress: () => router.replace('/settings') };
  }

  return (
    <Screen bottom>
      <ScrollView contentContainerClassName="flex-grow items-center gap-5 px-7 pb-6 pt-14" testID={`teen.notice.${kind ?? 'adult'}`}>
        <Hero {...hero} />
        <View className="items-center gap-3">
          <Text variant="eyebrow">{eyebrow}</Text>
          <Text variant="display" className="text-center" accessibilityRole="header">
            {title}
          </Text>
          <Text variant="body" tone="muted" className="text-center">
            {body}
          </Text>
        </View>
        {rows.length > 0 ? (
          <Card className="gap-0.5 self-stretch px-4 py-3">
            {rowsTitle ? (
              <Text variant="eyebrow" className="mb-1">
                {rowsTitle}
              </Text>
            ) : null}
            {rows.map((r) => (
              <Row key={r.text} {...r} />
            ))}
          </Card>
        ) : null}
        {note ? (
          <Text variant="caption" tone="muted" className="text-center">
            {note}
          </Text>
        ) : null}
      </ScrollView>
      <View className="gap-1.5 px-6 pb-10">
        <Button label={primary.label} onPress={primary.onPress} testID="teen.notice.primary" />
        {secondary ? <Button variant="text" label={secondary.label} onPress={secondary.onPress} testID="teen.notice.secondary" /> : null}
      </View>
    </Screen>
  );
}
