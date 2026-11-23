import { BellRing } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppConfig } from '@/api/appConfig';
import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';
import { Badge } from '@/components/ui/Bits';
import { toast } from '@/components/ui/toast/store';

import { ProfileMenuRow } from './rows';

type TestPushResult = { devices: number; sent: number; results: { platform: string | null; result: string }[] };

/**
 * "Deneme bildirimi gönder" — a test tool of the non-prod stages (owner decision 2026-11-23, canvas 28 note): one
 * notification to this account's own devices, so push can be checked on a real phone. Shown only when the server says
 * so (`GET v1/config` testPush; never on prod, where the endpoint is 404 as well). The answer is told in a toast.
 */
export function TestPushRow() {
  const { t } = useTranslation();
  const config = useAppConfig();
  const [sending, setSending] = useState(false);
  if (!config.data?.testPush) return null;

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const result = await apiRequest<TestPushResult>('v1/tenant/notification/test-push', { method: 'POST' });
      if (result.sent > 0) toast.success(t('profile.testPushSent', { count: result.sent }));
      else if (result.devices === 0) toast.info(t('profile.testPushNoDevice'));
      else toast.error(t('profile.testPushNotDelivered', { result: result.results.map((r) => r.result).join(', ') }));
    } catch (error) {
      toast.error(t(error instanceof ApiError && error.status === 429 ? 'profile.testPushTooMany' : 'profile.testPushFailed'));
    } finally {
      setSending(false);
    }
  };

  return (
    <ProfileMenuRow
      icon={BellRing}
      label={t('profile.testPush')}
      trailing={<Badge label={t('profile.testPushValue')} />}
      onPress={() => void send()}
      disabled={sending}
      testID="profile.testPush"
    />
  );
}
