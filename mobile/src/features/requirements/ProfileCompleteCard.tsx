import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { useSession } from '@/auth/session';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useAccountSettings } from '@/features/account/queries';

import { completionKnown, profileCompletion, type ProfileItemKey } from './logic';
import { requirementsFlow } from './store';
import { useRequirementInput } from './useRequirements';

const collapsedKey = (userId: string) => `droblet.profileCard.${userId}`;

/** Opens what an item needs: its own short flow (consent first when needed) or the ready library. */
export function openProfileItem(key: ProfileItemKey): void {
  if (key === 'firstItems') {
    router.push('/item/library');
    return;
  }
  requirementsFlow.open({ action: key === 'city' ? 'stylist' : key === 'handle' ? 'social' : 'tryOn', start: 'steps', only: key });
}

/**
 * Canvas "Profilini tamamla" (Profil and Bugün): six things that make later steps unnecessary — full-length photo,
 * face photo, body type, city, @username, first 5 pieces — "3 / 6", the done ones on one line, each open one a row
 * that opens its step. Dismissible: it collapses to one row ("Profilini tamamla 3 / 6") and stays collapsed on this
 * device. Gone once everything is done.
 */
export function ProfileCompleteCard({ testID = 'profile-complete' }: { testID?: string }) {
  const { t } = useTranslation();
  const session = useSession();
  const input = useRequirementInput();
  const settings = useAccountSettings();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    if (!userId) return;
    void AsyncStorage.getItem(collapsedKey(userId)).then((v) => alive && setCollapsed(v === 'collapsed'));
    return () => {
      alive = false;
    };
  }, [userId]);

  const setStoredCollapsed = (value: boolean) => {
    setCollapsed(value);
    if (userId) void AsyncStorage.setItem(collapsedKey(userId), value ? 'collapsed' : 'open');
  };

  if (!completionKnown(input) || collapsed === null) return null;
  const items = profileCompletion(input);
  const done = items.filter((i) => i.done);
  const open = items.filter((i) => !i.done);
  if (open.length === 0) return null;
  const counts = { done: done.length, total: items.length };

  if (collapsed) {
    return (
      <Pressable
        onPress={() => setStoredCollapsed(false)}
        accessibilityRole="button"
        accessibilityLabel={t('req.profileCard.show', counts)}
        testID={`${testID}.collapsed`}
        className="min-h-[52px] flex-row items-center gap-3 rounded-card border border-line bg-paper px-3.5 active:opacity-70"
      >
        <View className="h-2 w-2 rounded-pill bg-accent" />
        <Text variant="bodyMedium" className="flex-1">
          {t('req.profileCard.title')}
        </Text>
        <Text variant="label" tone="muted">
          {t('common.stepOf', { current: counts.done, total: counts.total })}
        </Text>
        <Icon icon={ChevronDown} size={16} tone="muted" />
      </Pressable>
    );
  }

  const doneLabels = done.map((i) => (i.key === 'city' && settings.data?.city ? t('req.profileCard.cityDone', { city: settings.data.city.name }) : i.key === 'handle' && input.handle ? `@${input.handle}` : t(`req.profileCard.item.${i.key}`)));
  return (
    <View className="gap-3 rounded-card border border-line bg-paper p-4" testID={testID} accessibilityLabel={t('req.profileCard.title')}>
      <View className="flex-row items-start gap-3">
        <View className="flex-1 gap-0.5">
          <Text variant="eyebrow" accessibilityRole="header">
            {t('req.profileCard.eyebrow', counts)}
          </Text>
          <Text variant="caption" tone="muted">
            {t('req.profileCard.lead')}
          </Text>
        </View>
        <Pressable onPress={() => setStoredCollapsed(true)} accessibilityRole="button" accessibilityLabel={t('req.profileCard.hide')} hitSlop={10} testID={`${testID}.hide`} className="h-8 w-8 items-center justify-center">
          <Icon icon={X} size={16} tone="muted" />
        </Pressable>
      </View>
      <View className="h-1 overflow-hidden rounded-[2px] bg-line" accessible accessibilityRole="progressbar" accessibilityLabel={t('req.profileCard.progressA11y', counts)}>
        <View className="h-full bg-ink" style={{ width: `${Math.round((counts.done / counts.total) * 100)}%` }} />
      </View>
      {done.length > 0 ? (
        <View className="flex-row items-start gap-1.5">
          <Icon icon={Check} size={14} tone="muted" />
          <Text variant="caption" tone="muted" className="flex-1">
            {t('req.profileCard.doneLine', { items: doneLabels.join(' · ') })}
          </Text>
        </View>
      ) : null}
      <View>
        {open.map((item, index) => (
          <Pressable
            key={item.key}
            onPress={() => openProfileItem(item.key)}
            accessibilityRole="button"
            accessibilityLabel={`${t(`req.profileCard.item.${item.key}`)}. ${t(`req.profileCard.note.${item.key}`)}`}
            testID={`${testID}.item.${item.key}`}
            className={`min-h-[52px] flex-row items-center gap-3 py-2 active:opacity-70 ${index === 0 ? '' : 'border-t border-line'}`}
          >
            <View className="h-5 w-5 rounded-pill border-[1.5px] border-muted" />
            <View className="flex-1">
              <Text variant="bodyMedium">{t(`req.profileCard.item.${item.key}`)}</Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t(`req.profileCard.note.${item.key}`)}
              </Text>
            </View>
            <Icon icon={ChevronRight} size={16} tone="muted" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
