import { router } from 'expo-router';
import { Camera, ChevronRight, Hourglass, Lock, ShieldCheck, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { showToast } from '@/components/ui/toast/store';
import i18n from '@/i18n';

import { useGrantTeenTryOn, useResendParentalConsent } from './api';
import type { TeenRules } from './rules';
import { currentTeenRules, useTeenRules } from './store';

/** Where the parent status lives (02i when nothing is pending, 02j while waiting). */
export function openParentStatus(edit = false): void {
  router.push(edit ? { pathname: '/teen/parent', params: { edit: '1' } } : '/teen/parent');
}

/**
 * A locked teen action (limited mode): the calm "Velinin onayıyla açılır" toast instead of a grey button. Returns true
 * when the action was stopped. Used by entries that stay visible but open only after the parent's approval.
 */
export function stopIfTeenLimited(): boolean {
  if (!currentTeenRules().limited) return false;
  showToast({ message: i18n.t('teen.locked.toast'), action: { label: i18n.t('teen.locked.pendingAction'), onPress: () => openParentStatus() } });
  return true;
}

/**
 * Teens never see the paywall (docs/api/teen.md §4 `paywallHidden`): every "→ 05 Üyelik" goes through here and a teen
 * gets one calm sentence instead.
 */
export function openPaywall(params?: Record<string, string>): void {
  if (currentTeenRules().hide.paywall) {
    showToast({ message: i18n.t('teen.unavailable') });
    return;
  }
  router.push(params ? { pathname: '/paywall', params } : '/paywall');
}

const BANNER = {
  none: { title: 'teen.banner.noneTitle', body: 'teen.banner.noneBody' },
  pending: { title: 'teen.banner.pendingTitle', body: 'teen.banner.pendingBody' },
  approved: { title: 'teen.banner.pendingTitle', body: 'teen.banner.pendingBody' },
  declined: { title: 'teen.banner.declinedTitle', body: 'teen.banner.declinedBody' },
  withdrawn: { title: 'teen.banner.withdrawnTitle', body: 'teen.banner.withdrawnBody' },
} as const satisfies Record<TeenRules['consent'], { title: string; body: string }>;

/**
 * 06 Bugün · sınırlı mod bandı: at the top of Bugün while a teen has no approval. Not dismissible; opens 02j (or 02i
 * to send to another parent after a decline / withdrawal).
 */
export function TeenBanner() {
  const { t } = useTranslation();
  const rules = useTeenRules();
  if (!rules.limited) return null;
  const keys = BANNER[rules.consent];
  const edit = rules.consent === 'declined' || rules.consent === 'withdrawn' || rules.consent === 'none';
  return (
    <Pressable
      onPress={() => openParentStatus(edit)}
      accessibilityRole="button"
      accessibilityLabel={`${t(keys.title)}. ${t(keys.body)}`}
      className="min-h-icon-btn flex-row items-center gap-3 rounded-card border border-line bg-paper px-3.5 py-3 active:opacity-80"
      testID={`teen.banner.${rules.consent}`}
    >
      <View className="h-9 w-9 items-center justify-center rounded-pill bg-sand">
        <Icon icon={Hourglass} size={18} />
      </View>
      <View className="min-w-0 flex-1">
        <Text variant="bodyMedium">{t(keys.title)}</Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {t(keys.body)}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={16} />
    </Pressable>
  );
}

/**
 * 16 Stilist · velinin onayıyla açılır — the calm locked state of a feature that waits for the parent (the tab bar
 * stays). Pending → the status; declined / withdrawn → send to a parent again.
 */
export function TeenLockedState({
  body,
  testID = 'teen.locked',
  onLeave,
  compact = false,
}: {
  body: string;
  testID?: string;
  onLeave?: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { consent } = useTeenRules();
  const text = consent === 'declined' ? t('teen.locked.declinedBody') : consent === 'withdrawn' ? t('teen.locked.withdrawnBody') : body;
  const action =
    consent === 'declined'
      ? t('teen.locked.declinedAction')
      : consent === 'withdrawn'
        ? t('teen.locked.withdrawnAction')
        : t('teen.locked.pendingAction');
  const edit = consent === 'declined' || consent === 'withdrawn' || consent === 'none';
  return (
    <View className={compact ? 'items-center gap-[18px] px-2 py-4' : 'flex-1 items-center justify-center gap-[18px] px-8 pb-20'} testID={testID}>
      <View className="h-[72px] w-[72px] items-center justify-center rounded-pill bg-sand">
        <Icon icon={Lock} size={30} />
      </View>
      <View className="items-center gap-2.5">
        <Text variant="h2" className="text-center" accessibilityRole="header">
          {t('teen.locked.title')}
        </Text>
        <Text variant="body" tone="muted" className="text-center">
          {text}
        </Text>
      </View>
      <View className="gap-1.5 self-stretch">
        <Button
          label={action}
          onPress={() => {
            onLeave?.();
            openParentStatus(edit);
          }}
          testID={`${testID}.action`}
        />
        <Button
          variant="text"
          label={t('teen.locked.wardrobe')}
          onPress={() => {
            onLeave?.();
            router.navigate('/wardrobe');
          }}
          testID={`${testID}.wardrobe`}
        />
      </View>
    </View>
  );
}

/**
 * 14b Üzerimde gör · kilitli durumlar: in place of the try-on image / button for a teen whose try-on is closed.
 * Nothing for adults or an open teen try-on (the caller then draws the normal flow).
 */
export function TeenTryOnLock({ className, testID = 'teen.tryOnLock', onLeave }: { className?: string; testID?: string; onLeave?: () => void }) {
  const { t } = useTranslation();
  const rules = useTeenRules();
  const resend = useResendParentalConsent();
  if (!rules.isTeen || rules.tryOn === 'open') return null;
  const unavailable = rules.tryOn === 'unavailable';
  const title = unavailable ? t('teen.tryOn.unavailableTitle') : t('teen.tryOn.lockedTitle');
  const body = unavailable
    ? t('teen.tryOn.unavailableBody')
    : rules.tryOn === 'needsParent'
      ? t('teen.tryOn.needsParentBody')
      : t('teen.tryOn.pendingBody');
  return (
    <View className={`items-center justify-center gap-3.5 rounded-card bg-sand px-8 py-6 ${className ?? ''}`} testID={`${testID}.${rules.tryOn}`}>
      <View className="h-14 w-14 items-center justify-center rounded-pill bg-paper">
        <Icon icon={Lock} size={24} />
      </View>
      <Text variant="h3" className="text-center">
        {title}
      </Text>
      <Text variant="caption" className="text-center">
        {body}
      </Text>
      {rules.tryOn === 'needsParent' ? (
        <Button
          variant="secondary"
          size="md"
          label={t('teen.tryOn.needsParentAction')}
          loading={resend.isPending}
          onPress={() =>
            resend.mutate(undefined, {
              onSuccess: () => showToast({ message: t('teen.waiting.resent'), tone: 'success' }),
              onError: () => showToast({ message: t('teen.parent.failed'), tone: 'error' }),
            })
          }
          testID={`${testID}.resend`}
        />
      ) : rules.tryOn === 'limited' ? (
        <Button
          variant="secondary"
          size="md"
          label={t('teen.tryOn.pendingAction')}
          onPress={() => {
            onLeave?.();
            openParentStatus();
          }}
          testID={`${testID}.status`}
        />
      ) : null}
    </View>
  );
}

/**
 * 22t Üzerimde gör · genç açıklaması — before a teen's first try-on: what happens to the photo and the image. "Anladım,
 * dene" records the teen's own `teenTryOn` consent, then the normal flow continues (`onAccepted`).
 */
export function TeenTryOnExplainer({ visible, onClose, onAccepted }: { visible: boolean; onClose: () => void; onAccepted: () => void }) {
  const { t } = useTranslation();
  const grant = useGrantTeenTryOn();
  const rows = [
    { icon: Lock, text: t('teen.tryOn.explainerPrivate') },
    { icon: Camera, text: t('teen.tryOn.explainerPhoto') },
    { icon: Sparkles, text: t('teen.tryOn.explainerAi') },
    { icon: ShieldCheck, text: t('teen.tryOn.explainerParent') },
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View className="gap-4" testID="teen.tryOnExplainer">
        <View className="gap-1.5">
          <Text variant="eyebrow">{t('teen.tryOn.explainerEyebrow')}</Text>
          <Text variant="h3">{t('teen.tryOn.explainerTitle')}</Text>
        </View>
        <View className="gap-3">
          {rows.map((r) => (
            <View key={r.text} className="flex-row items-start gap-3">
              <View className="mt-0.5">
                <Icon icon={r.icon} size={18} />
              </View>
              <Text variant="body" className="flex-1 text-[14px] leading-[20px]">
                {r.text}
              </Text>
            </View>
          ))}
        </View>
        {grant.isError ? (
          <Text variant="caption" tone="danger" accessibilityRole="alert">
            {t('teen.tryOn.explainerFailed')}
          </Text>
        ) : null}
        <View className="gap-1">
          <Button
            label={t('teen.tryOn.explainerAccept')}
            loading={grant.isPending}
            onPress={() => grant.mutate(undefined, { onSuccess: onAccepted })}
            testID="teen.tryOnExplainer.accept"
          />
          <Button
            variant="text"
            label={t('teen.tryOn.explainerCancel')}
            onPress={onClose}
            disabled={grant.isPending}
            testID="teen.tryOnExplainer.cancel"
          />
        </View>
      </View>
    </BottomSheet>
  );
}
