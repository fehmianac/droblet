import { CircleAlert, RotateCcw, WifiOff, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { extractApiError, isNotFound } from '@/api/errors';
import { DropLoader } from '@/components/brand/DropLoader';
import { useIsOnline } from '@/sync/network';

import type { EmptyIllustrationKind } from './illustrations/EmptyIllustration';
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
  /** Canvas 22d–22e: the empty list's drawing in place of the icon circle. */
  illustration?: EmptyIllustrationKind;
  title?: string;
  actionDisabled?: boolean;
  /** Outlined second way in, under the action (`DurumBos`: "Hazır kütüphaneden seç"). */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
};

/** Not found (404): one sentence + the way back, as on 11 Parça detayı ("Bu parça artık gardırobunda yok"). */
type NotFoundState = {
  message: string;
  actionLabel: string;
  onAction: () => void;
  icon?: LucideIcon;
  title?: string;
};

type Props<T> = {
  query: QueryLike<T>;
  isEmpty?: (data: T) => boolean;
  /** Empty = one sentence + one action. */
  empty?: EmptyState;
  /**
   * `DurumHata`: the screen's own headline ("Gardırobun yüklenemedi") and its sentence for an error without
   * a known cause. Known causes (no connection, session, server) keep their own sentence.
   */
  error?: { title?: string; message?: string };
  /**
   * What a 404 / 410 shows (an unknown id, a deleted record, content not published yet). Without it the
   * screen's `empty` state is used, and without that a generic "not found" + back. Never "Tekrar dene":
   * retrying cannot bring the thing back.
   */
  notFound?: NotFoundState;
  /** Screen-reader name of the loading state ("Gardırop yükleniyor"). */
  loadingLabel?: string;
  /**
   * First load: the screen's own content-shaped skeleton (canvas n_durum / n_yukleme — rows, cards and buttons as
   * shimmering blocks, laid out like the content so nothing moves when it arrives). Without it the drop loader,
   * kept for screens where nothing at all is known yet.
   */
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
};

/** Without history (deep link / cold start), back goes to Bugün. */
const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

/**
 * The five states of every list and detail screen, drawn as on the `Durum*` boards (canvas note n_durum): loading =
 * the screen's `skeleton` shaped like its content (the drop loader only where none is given) · empty = one
 * sentence + one action · not found (404) = the screen's not-found sentence + the way back · error = "Tekrar dene" (network / 5xx) · offline = cached data (the root sync pill says so) or an explained
 * state when nothing is cached · success.
 */
export function ScreenState<T>({ query, isEmpty, empty, error, notFound, loadingLabel, skeleton, children }: Props<T>) {
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
          illustration={empty.illustration}
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
  } else if (query.status === 'error' && isNotFound(query.error)) {
    if (!notFound && empty) {
      body = (
        <StateMessage
          testID="state-empty"
          role="status"
          icon={empty.icon}
          illustration={empty.illustration}
          title={empty.title}
          message={empty.message}
          actionLabel={empty.actionLabel}
          onAction={empty.onAction}
          actionVariant="primary"
          secondaryActionLabel={empty.secondaryActionLabel}
          onSecondaryAction={empty.onSecondaryAction}
        />
      );
    } else {
      const state = notFound ?? { message: t('states.notFound'), actionLabel: t('states.notFoundAction'), onAction: goBack };
      body = (
        <StateMessage
          testID="state-not-found"
          role="status"
          icon={state.icon}
          title={state.title}
          message={state.message}
          actionLabel={state.actionLabel}
          onAction={state.onAction}
        />
      );
    }
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
  } else if (skeleton) {
    // First load: the screen's skeleton, busy and named for screen readers (its blocks are hidden from them).
    body = (
      <View
        className="flex-1"
        testID="state-skeleton"
        accessible
        accessibilityRole="progressbar"
        accessibilityState={{ busy: true }}
        accessibilityLabel={loadingLabel ?? t('a11y.loading')}
      >
        {skeleton}
      </View>
    );
  } else {
    // First load with nothing known and no skeleton: the drop loader holds the content's place (flex-1), so the
    // header, chips and tab bar never move when the data arrives. Cached data is shown at once (no loader at all).
    body = <DropLoader size="screen" testID="state-loading" accessibilityLabel={loadingLabel ?? t('a11y.loading')} />;
  }

  return (
    // Offline / sync status is the floating `SyncPill` at the root: nothing here pushes the content.
    <View className="flex-1">{body}</View>
  );
}
