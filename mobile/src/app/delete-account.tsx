import { router } from 'expo-router';
import { Camera, CalendarDays, Shirt, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { extractApiError } from '@/api/errors';
import { Card, DangerButton, InfoNote } from '@/components/blocks/basics';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { TextField } from '@/components/ui/TextField';
import { confirmationMatches } from '@/features/account/logic';
import { useDeleteAccount } from '@/features/account/mutations';
import { useProfileStats } from '@/features/account/queries';
import { currentLocaleTag } from '@/i18n';
import { useIsOnline } from '@/sync/network';

function Row({ icon, label, first = false }: { icon: LucideIcon; label: string; first?: boolean }) {
  return (
    <View className={`min-h-btn-primary flex-row items-center gap-3 px-4 py-2 ${first ? '' : 'border-t border-line'}`}>
      <Icon icon={icon} size={20} tone="muted" />
      <Text variant="body" className="flex-1">
        {label}
      </Text>
    </View>
  );
}

/**
 * 29c Hesabımı sil — lists what is deleted, reminds that the store subscription is cancelled
 * separately, and asks the user to type the confirmation word before `DELETE v1/auth/me`.
 * Online only: the deletion is never queued.
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
      <OfflineBanner />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView contentContainerClassName="gap-5 px-gutter pb-8" keyboardShouldPersistTaps="handled">
          <View className="gap-2">
            <Text variant="eyebrow" tone="danger">
              {t('deleteAccount.eyebrow')}
            </Text>
            <Text variant="display">{t('deleteAccount.title')}</Text>
            <Text variant="body" tone="muted">
              {t('deleteAccount.body')}
            </Text>
          </View>

          <Card>
            <Row
              first
              icon={Shirt}
              label={
                stats.data
                  ? t('deleteAccount.rowItems', {
                      items: t('me.items', { count: stats.data.itemCount }),
                      looks: t('me.looks', { count: stats.data.lookCount }),
                    })
                  : t('deleteAccount.rowItemsUnknown')
              }
            />
            <Row icon={Camera} label={t('deleteAccount.rowPhotos')} />
            <Row icon={CalendarDays} label={t('deleteAccount.rowSocial')} />
          </Card>

          <InfoNote>{t('deleteAccount.storeNote')}</InfoNote>

          <TextField
            label={t('deleteAccount.confirmLabel', { word })}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            error={error}
          />
        </ScrollView>
        <View className="gap-2 border-t border-line bg-paper px-gutter pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          <DangerButton
            label={t('deleteAccount.submit')}
            onPress={() => remove.mutate()}
            disabled={!confirmed || !online}
            loading={remove.isPending}
          />
          <Button variant="secondary" label={t('common.cancel')} onPress={() => router.back()} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
