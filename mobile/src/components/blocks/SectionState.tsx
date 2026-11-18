import { ShoppingBag } from 'lucide-react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCartCount } from '@/api/cart';
import { extractApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Text } from '@/components/ui/Text';
import { useIsOnline } from '@/sync/network';

type QueryLike<T> = {
  data: T | undefined;
  status: 'pending' | 'error' | 'success';
  fetchStatus: 'fetching' | 'paused' | 'idle';
  error: unknown;
  refetch: () => unknown;
};

type Props<T> = {
  query: QueryLike<T>;
  skeleton: ReactNode;
  isEmpty?: (data: T) => boolean;
  /** One sentence shown when the section has nothing. */
  emptyText?: string;
  /** Overrides the mapped API error sentence. */
  errorText?: string;
  /** Pad text states by the screen gutter (default). Off inside sheets and cards, which pad themselves. */
  inset?: boolean;
  children: (data: T) => ReactNode;
};

/**
 * The five states for a section inside a screen (a strip, a tab body, a sheet list) — the compact
 * sibling of `ScreenState`: skeleton · one-sentence empty · error + "Tekrar dene" · offline · content.
 */
export function SectionState<T>({ query, skeleton, isEmpty, emptyText, errorText, inset = true, children }: Props<T>) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const pad = inset ? 'px-gutter' : '';

  if (query.data !== undefined) {
    if (isEmpty?.(query.data) && emptyText) {
      return (
        <Text variant="body" tone="muted" className={`${pad} py-4`}>
          {emptyText}
        </Text>
      );
    }
    return <>{children(query.data)}</>;
  }
  if (query.status === 'error' || !online || query.fetchStatus === 'paused') {
    const message =
      query.status === 'error' ? (errorText ?? t(`errors.${extractApiError(query.error)}`)) : t('states.offlineNoCache');
    return (
      <View className={`items-start gap-1 ${pad} py-2`}>
        <Text variant="body" tone="muted">
          {message}
        </Text>
        <Button variant="text" label={t('common.retry')} onPress={() => void query.refetch()} className="-ml-2" />
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel={t('a11y.loading')}>
      {skeleton}
    </View>
  );
}

/** Cart icon with the line-count badge → 24 Sepet. Used on 20, 21, 22 and 24b. */
export function CartButton({ variant = 'outline' }: { variant?: 'outline' | 'plain' | 'inverse' }) {
  const { t } = useTranslation();
  const count = useCartCount().data ?? 0;
  return (
    <IconButton
      icon={ShoppingBag}
      variant={variant}
      badge={count}
      onPress={() => router.push('/cart')}
      accessibilityLabel={count > 0 ? t('a11y.cartWithCount', { count }) : t('a11y.cart')}
    />
  );
}
