import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Download, FileArchive, Mail, Timer } from 'lucide-react-native';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, ScrollView, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { SectionState } from '@/components/blocks/SectionState';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatBytes, isPreparing, useDataExport, useStartDataExport, type DataExportState } from '@/features/account/dataExport';
import { RowCard } from '@/features/account/rows';
import { LANGUAGES } from '@/i18n';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { formatDate } from '@/lib/format';
import { useThemeColors } from '@/theme/useThemeColors';

function Fact({ icon, text }: { icon: typeof Download; text: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <Icon icon={icon} size={18} tone="muted" />
      <Text variant="body" className="flex-1">
        {text}
      </Text>
    </View>
  );
}

/**
 * Ayarlar › Gizlilik › "Verilerimi indir" (KVKK m.11 / GDPR art. 15 and 20): what the copy holds, how long it takes,
 * and its state — prepare, preparing (polled), ready (download + until when), failed, expired. The ready link also
 * arrives by e-mail and in Bildirimler. One copy at a time, one per day.
 */
export default function DataExportScreen() {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const language = useAppLanguage();
  const locale = LANGUAGES[language].localeTag;
  const state = useDataExport();
  const start = useStartDataExport();

  // Back from the e-mail / another screen: read the state again (the download URL is short-lived).
  useFocusEffect(
    useCallback(() => {
      void state.refetch();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- once per focus
    }, []),
  );

  const download = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      await Linking.openURL(url).catch(() => undefined);
    }
  };

  const day = (iso: string) => formatDate(new Date(iso), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const startError =
    start.error instanceof ApiError && start.error.status === 429
      ? t('dataExport.errorTooSoon')
      : start.error instanceof ApiError && start.error.status === 409
        ? null
        : start.error
          ? t('dataExport.errorStart')
          : null;

  const renderState = (data: DataExportState) => {
    const current = data.export;
    const requestButton = (label: string) => (
      <Button label={label} onPress={() => start.mutate()} loading={start.isPending} disabled={!data.canRequest} testID="dataExport.request" />
    );
    const nextLine = !data.canRequest && data.nextRequestAt && !isPreparing(data) ? (
      <Text variant="caption" tone="muted" testID="dataExport.next">
        {t('dataExport.nextAt', { when: day(data.nextRequestAt) })}
      </Text>
    ) : null;

    if (!current) {
      return <View className="gap-2">{requestButton(t('dataExport.request'))}</View>;
    }
    if (current.status === 'queued' || current.status === 'processing') {
      return (
        <View className="flex-row items-center gap-3" testID="dataExport.preparing" accessibilityLiveRegion="polite">
          <ActivityIndicator color={colors.muted} />
          <View className="flex-1">
            <Text variant="bodyMedium">{t('dataExport.preparingTitle')}</Text>
            <Text variant="caption" tone="muted">
              {t('dataExport.preparingBody')}
            </Text>
          </View>
        </View>
      );
    }
    if (current.status === 'ready' && current.downloadUrl) {
      const url = current.downloadUrl;
      return (
        <View className="gap-3" testID="dataExport.ready">
          <View className="gap-0.5">
            <Text variant="bodyMedium">{t('dataExport.readyTitle')}</Text>
            <Text variant="caption" tone="muted">
              {[current.sizeBytes ? formatBytes(current.sizeBytes, locale) : null, current.expiresAt ? t('dataExport.until', { when: day(current.expiresAt) }) : null]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
          <Button label={t('dataExport.download')} onPress={() => void download(url)} testID="dataExport.download" />
          {nextLine}
        </View>
      );
    }
    return (
      <View className="gap-3" testID={`dataExport.${current.status}`}>
        <Text variant="body" tone={current.status === 'failed' ? 'danger' : 'muted'}>
          {t(current.status === 'failed' ? 'dataExport.failed' : 'dataExport.expired')}
        </Text>
        {requestButton(t('dataExport.requestAgain'))}
        {nextLine}
      </View>
    );
  };

  return (
    <Screen bottom>
      <ScreenHeader title={t('dataExport.title')} leading="back" />
      <ScrollView contentContainerClassName="gap-4 px-gutter pb-10 pt-1">
        <Text variant="body" tone="muted">
          {t('dataExport.lead')}
        </Text>
        <RowCard>
          <View className="gap-3.5 py-3.5">
            <Fact icon={FileArchive} text={t('dataExport.factContent')} />
            <Fact icon={Timer} text={t('dataExport.factTime')} />
            <Fact icon={Mail} text={t('dataExport.factDelivery')} />
            <Fact icon={Download} text={t('dataExport.factLimit')} />
          </View>
        </RowCard>
        <RowCard>
          <View className="py-3.5">
            <SectionState query={state} inset={false} skeleton={<Skeleton className="h-12 rounded-image" />}>
              {renderState}
            </SectionState>
          </View>
        </RowCard>
        {startError ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" testID="dataExport.error">
            {startError}
          </Text>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
