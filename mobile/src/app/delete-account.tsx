import { router } from 'expo-router';
import { Calendar } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAvoider } from '@/components/ui/KeyboardAvoider';
import { extractApiError } from '@/api/errors';
import { InfoNote } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { confirmationMatches } from '@/features/account/logic';
import { useDeleteAccount } from '@/features/account/mutations';
import { useProfileStats } from '@/features/account/queries';
import { InfoRow, RowCard } from '@/features/account/rows';
import { currentLocaleTag } from '@/i18n';
import { useIsOnline } from '@/sync/network';

/**
 * 29c Silme onayı · hesap — lists what is deleted, reminds that the store subscription is cancelled
 * separately, and asks the user to type the confirmation word before `DELETE v1/auth/me`.
 * Online only: the deletion is never queued. Drawn with 24 pt side insets and no bottom menu.
 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const stats = useProfileStats();
  const remove = useDeleteAccount();
  const [typed, setTyped] = useState('');

  const word = t('deleteAccount.confirmWord');
  const confirmed = confirmationMatches(typed, word, currentLocaleTag());
  const error = !online ? t('deleteAccount.offline') : remove.isError ? t(`errors.${extractApiError(remove.error)}`) : null;

  return (
    <Screen>
      <ScreenHeader leading="back" />
      <KeyboardAvoider>
        <ScrollView contentContainerClassName="gap-[18px] px-6 pb-6 pt-2" keyboardShouldPersistTaps="handled">
          <View className="gap-2.5">
            <Text variant="eyebrow" tone="danger">
              {t('deleteAccount.eyebrow')}
            </Text>
            <Text variant="display" accessibilityRole="header">
              {t('deleteAccount.title')}
            </Text>
            <Text variant="body" tone="muted">
              {t('deleteAccount.body')}
            </Text>
          </View>

          <RowCard className="px-4 py-1">
            <InfoRow
              first
              icon="hanger"
              label={
                stats.data
                  ? t('deleteAccount.rowItems', {
                      items: t('me.items', { count: stats.data.itemCount }),
                      looks: t('me.looks', { count: stats.data.lookCount }),
                    })
                  : t('deleteAccount.rowItemsUnknown')
              }
            />
            <InfoRow icon="mirror" label={t('deleteAccount.rowPhotos')} />
            <InfoRow icon={Calendar} label={t('deleteAccount.rowSocial')} />
          </RowCard>

          <InfoNote text={t('deleteAccount.storeNote')} />

          <TextField
            label={t('deleteAccount.confirmLabel', { word })}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            error={error}
            testID="deleteAccount.confirm"
          />
        </ScrollView>
        <View className="gap-1.5 px-6" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <Button
            variant="danger"
            label={t('deleteAccount.submit')}
            onPress={() => remove.mutate()}
            disabled={!confirmed || !online}
            loading={remove.isPending}
          />
          <Button variant="text" label={t('common.cancel')} onPress={() => router.back()} />
        </View>
      </KeyboardAvoider>
    </Screen>
  );
}
