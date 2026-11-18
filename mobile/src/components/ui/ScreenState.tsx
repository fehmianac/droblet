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

type Props<T> = {
  query: QueryLike<T>;
  /** Loading = skeleton boxes shaped like the content (not a spinner). */
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  /** Empty = one sentence + one action. */
  empty?: { message: string; actionLabel: string; onAction: () => void };
  children: (data: T) => ReactNode;
};

/**
 * The five screen states (TEAM_LEAD mobile style): loading (skeleton) · empty · error (retry) ·
 * offline (cached data + top band, or an explained state when nothing is cached) · success.
 */
export function ScreenState<T>({ query, skeleton, isEmpty, empty, children }: Props<T>) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const retry = () => void query.refetch();

  let body: ReactNode;
  if (query.data !== undefined) {
    body = isEmpty?.(query.data) && empty ? (
      <StateMessage message={empty.message} actionLabel={empty.actionLabel} onAction={empty.onAction} />
    ) : (
      children(query.data)
    );
  } else if (query.status === 'error') {
    body = (
      <StateMessage
        message={t(`errors.${extractApiError(query.error)}`)}
        actionLabel={t('common.retry')}
        onAction={retry}
        actionLoading={query.isRefetching}
      />
    );
  } else if (!online || query.fetchStatus === 'paused') {
    body = <StateMessage message={t('states.offlineNoCache')} actionLabel={t('common.retry')} onAction={retry} />;
  } else {
    body = (
      <View accessibilityLabel={t('a11y.loading')} accessible>
        {skeleton}
      </View>
    );
  }

  return (
    <View className="flex-1">
      <OfflineBanner />
      {body}
    </View>
  );
}
