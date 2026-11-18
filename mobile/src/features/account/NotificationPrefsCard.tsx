import { ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { NotificationSettings } from '@/api/contracts/account';
import { SectionState } from '@/components/blocks/SectionState';
import { Badge } from '@/components/ui/Bits';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip } from '@/components/ui/Chip';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { syncPushRegistration } from '@/notify/push';
import { REMINDER_TIMES } from '@/notify/time';

import { useSaveNotificationSettings } from './mutations';
import { useNotificationSettings } from './queries';
import { ChoiceRow, RowCard } from './rows';

/**
 * BİLDİRİMLER (29 and the Bildirimler screen) — one check box per notification type, as drawn on the
 * canvas: morning outfit (+ its local time while on), weekly edit, friend ratings, price drops on the
 * watch list and follow requests. Defaults (owner decision 9): only the morning reminder and the weekly
 * edit start on. Saved through the versioned `PUT v1/tenant/user/me/notifications`; turning one on is
 * the moment to ask for push permission (and register the token).
 */
export function NotificationPrefsCard() {
  const { t } = useTranslation();
  const settings = useNotificationSettings();
  const save = useSaveNotificationSettings();
  const [timeOpen, setTimeOpen] = useState(false);
  const [pushOff, setPushOff] = useState(false);

  return (
    <RowCard>
      <SectionState
        query={settings}
        inset={false}
        errorText={t('settings.notificationsError')}
        skeleton={<Skeleton className="my-3.5 h-28 rounded-image" />}
      >
        {(data) => {
          const change = (patch: Partial<NotificationSettings>) => {
            if (Object.values(patch).includes(true)) void syncPushRegistration({ ask: true }).then((on) => setPushOff(!on));
            save({ ...data, ...patch });
          };
          const localTime = data.morningTimeLocal;
          const box = (key: 'morningReminder' | 'weeklyEdit' | 'friendRatings' | 'priceDrop' | 'followRequests', label: string, first = false) => (
            <ChoiceRow first={first} kind="checkbox" label={label} checked={data[key]} onPress={() => change({ [key]: !data[key] })} />
          );
          return (
            <>
              {box('morningReminder', t('settings.morning'), true)}
              {data.morningReminder ? (
                <Pressable
                  onPress={() => setTimeOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.morningTimeA11y', { time: localTime })}
                  className="min-h-icon-btn flex-row items-center gap-3 border-t border-line py-1.5 active:opacity-70"
                >
                  <Text variant="body" tone="muted" className="flex-1 text-[14.5px]">
                    {t('settings.morningTime')}
                  </Text>
                  <Badge label={localTime} />
                  <Icon icon={ChevronRight} size={16} />
                </Pressable>
              ) : null}
              {box('weeklyEdit', t('settings.weeklyEdit'))}
              {box('friendRatings', t('settings.friendRatings'))}
              {box('priceDrop', t('friends.priceDrop'))}
              {data.priceDrop ? (
                <Text variant="caption" tone="muted" className="pb-2">
                  {t('friends.priceDropNote')}
                </Text>
              ) : null}
              {box('followRequests', t('friends.followRequests'))}
              {pushOff ? (
                <Text variant="caption" tone="muted" className="pb-3">
                  {t('push.denied')}
                </Text>
              ) : null}
              <BottomSheet visible={timeOpen} onClose={() => setTimeOpen(false)} title={t('settings.timeTitle')}>
                <View className="gap-4">
                  <Text variant="body" tone="muted">
                    {t('settings.timeBody')}
                  </Text>
                  <View className="flex-row flex-wrap gap-2">
                    {REMINDER_TIMES.map((time) => (
                      <Chip
                        key={time}
                        label={time}
                        selected={time === localTime}
                        onPress={() => {
                          // Local wall-clock time; the device time zone travels with the PUT.
                          change({ morningTimeLocal: time });
                          setTimeOpen(false);
                        }}
                      />
                    ))}
                  </View>
                </View>
              </BottomSheet>
            </>
          );
        }}
      </SectionState>
    </RowCard>
  );
}
