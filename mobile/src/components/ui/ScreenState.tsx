import { CircleAlert, RotateCcw, WifiOff, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { extractApiError } from '@/api/errors';
import { useIsOnline } from '@/sync/network';

import { OfflineBanner } from './OfflineBanner';
import { StateMessage } from './StateMessage';

type QueryLike<T> = {
  data: T | undefined;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: unknown;
  isRefetching: boolean;
  refetch: () => unknown;
};

type EmptyState = {
  /** One sentence. */
  message: string;
  /** One action. */
  actionLabel: string;
  onAction: () => void;
  /** `DurumBos`: line glyph in the 96 sand circle and the serif headline above the sentence. */
  icon?: LucideIcon;
  title?: string;
  actionDisabled?: boolean;
  /** Outlined second way in, under the action (`DurumBos`: "Hazır kütüphaneden seç"). */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
};

type Props<T> = {
  query: QueryLike<T>;
  /** Loading = skeleton boxes shaped like the content (not a spinner). */
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  /** Empty = one sentence + one action. */
  empty?: EmptyState;
  /**
   * `DurumHata`: the screen's own headline ("Gardırobun yüklenemedi") and its sentence for an error without
   * a known cause. Known causes (no connection, session, server) keep their own sentence.
   */
  error?: { title?: string; message?: string };
  /** Text of the offline top band, e.g. "Çevrimdışısın · kayıtlı gardırop gösteriliyor". */
  offlineMessage?: string;
  /** Screen-reader name of the loading state ("Gardırop yükleniyor"). */
  loadingLabel?: string;
  /** `false` when the screen draws `<OfflineBanner />` itself, above its header (default `true`). */
  banner?: boolean;
  children: (data: T) => ReactNode;
};

/**
 * The five states of every list screen, drawn as on the `Durum*` boards (canvas note "Tüm liste ekranları
 * için ortak durumlar"): loading = skeleton boxes shaped like the content (never a spinner) · empty = one
 * sentence + one action · error = "Tekrar dene" · offline = cached data under the top band (or an explained
 * state when nothing is cached) · success.
 */
export function ScreenState<T>({ query, skeleton, isEmpty, empty, error, offlineMessage, loadingLabel, banner = true, children }: Props<T>) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const retry = () => void query.refetch();

  let body: ReactNode;
  if (query.data !== undefined) {
    body =
      isEmpty?.(query.data) && empty ? (
        <StateMessage
          testID="state-empty"
          role="status"
          icon={empty.icon}
          title={empty.title}
          message={empty.message}
          actionLabel={empty.actionLabel}
          onAction={empty.onAction}
          actionDisabled={empty.actionDisabled}
          actionVariant="primary"
          secondaryActionLabel={empty.secondaryActionLabel}
          onSecondaryAction={empty.onSecondaryAction}
        />
      ) : (
        children(query.data)
      );
  } else if (query.status === 'error') {
    const code = extractApiError(query.error);
    body = (
      <StateMessage
        testID="state-error"
        role="alert"
        icon={CircleAlert}
        title={error?.title ?? t('states.errorHeadline')}
        message={code === 'unknown' && error?.message ? error.message : t(`errors.${code}`)}
        actionLabel={t('common.retry')}
        actionIcon={RotateCcw}
        actionVariant="primary"
        onAction={retry}
        actionLoading={query.isRefetching}
      />
    );
  } else if (!online || query.fetchStatus === 'paused') {
    body = (
      <StateMessage
        testID="state-offline"
        role="status"
        icon={WifiOff}
        title={t('states.offlineHeadline')}
        message={t('states.offlineNoCache')}
        actionLabel={t('common.retry')}
        actionIcon={RotateCcw}
        actionVariant="primary"
        onAction={retry}
      />
    );
  } else {
    body = (
      <View testID="state-loading" accessibilityLabel={loadingLabel ?? t('a11y.loading')} accessibilityState={{ busy: true }} accessible>
        {skeleton}
      </View>
    );
  }

  return (
    <View className="flex-1">
      {banner ? <OfflineBanner message={offlineMessage} /> : null}
      {body}
    </View>
  );
}
