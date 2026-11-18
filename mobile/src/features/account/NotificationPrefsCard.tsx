import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { NotificationSettings } from '@/api/contracts/account';
import { Card } from '@/components/blocks/basics';
import { MenuRow, ToggleRow } from '@/components/blocks/rows';
import { SectionState } from '@/components/blocks/SectionState';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Chip, ChipWrap } from '@/components/ui/Chip';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { syncPushRegistration } from '@/notify/push';
import { REMINDER_TIMES } from '@/notify/time';

import { useSaveNotificationSettings } from './mutations';
import { useNotificationSettings } from './queries';

/**
 * The notification switches (29 and the Bildirimler screen): morning outfit + time, weekly edit,
 * friend ratings, price drops on the watch list and follow requests. Defaults (owner decision 9):
 * only the morning reminder and the weekly edit start on.
 */
export function NotificationPrefsCard() {
  const { t } = useTranslation();
  const settings = useNotificationSettings();
  const save = useSaveNotificationSettings();
  const [timeOpen, setTimeOpen] = useState(false);
  const [pushOff, setPushOff] = useState(false);

  return (
    <Card>
      <SectionState
        query={settings}
        inset={false}
        errorText={t('settings.notificationsError')}
        skeleton={<Skeleton className="m-4 h-28 rounded-image" />}
      >
        {(data) => {
          const change = (patch: Partial<NotificationSettings>) => {
            // Switching a notification on is the moment to ask for push permission (and register the token).
            if (Object.values(patch).includes(true)) void syncPushRegistration({ ask: true }).then((on) => setPushOff(!on));
            save({ ...data, ...patch });
          };
          const localTime = data.morningTimeLocal;
          return (
            <>
              <ToggleRow first label={t('settings.morning')} value={data.morningReminder} onChange={(v) => change({ morningReminder: v })} />
              {data.morningReminder ? (
                <MenuRow label={t('settings.morningTime')} value={localTime} onPress={() => setTimeOpen(true)} />
              ) : null}
              <ToggleRow label={t('settings.weeklyEdit')} value={data.weeklyEdit} onChange={(v) => change({ weeklyEdit: v })} />
              <ToggleRow label={t('settings.friendRatings')} value={data.friendRatings} onChange={(v) => change({ friendRatings: v })} />
              <ToggleRow label={t('friends.priceDrop')} value={data.priceDrop} onChange={(v) => change({ priceDrop: v })} />
              {data.priceDrop ? (
                <Text variant="caption" tone="muted" className="px-4 pb-2">
                  {t('friends.priceDropNote')}
                </Text>
              ) : null}
              <ToggleRow label={t('friends.followRequests')} value={data.followRequests} onChange={(v) => change({ followRequests: v })} />
              {pushOff ? (
                <Text variant="caption" tone="muted" className="px-4 pb-3">
                  {t('push.denied')}
                </Text>
              ) : null}
              <BottomSheet visible={timeOpen} onClose={() => setTimeOpen(false)} title={t('settings.timeTitle')}>
                <ChipWrap>
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
                </ChipWrap>
              </BottomSheet>
            </>
          );
        }}
      </SectionState>
    </Card>
  );
}
