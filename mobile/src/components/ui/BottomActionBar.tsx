import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';

type Props = {
  /** e.g. "Toplam" */
  totalLabel?: string;
  /** e.g. "₺8.240" */
  totalValue?: string;
  /** Usually one primary Button with `size="bar"` (48 high). */
  children: ReactNode;
};

/**
 * Sticky bottom bar replacing the tab bar on detail/create/checkout screens (canvas `.bar`):
 * paper, top hairline, padding 12 / 20 / 30, total (12 muted over 17 medium) + the action.
 */
export function BottomActionBar({ totalLabel, totalValue, children }: Props) {
  const insets = useSafeAreaInsets();
  const hasTotal = Boolean(totalLabel || totalValue);
  return (
    <View
      className="flex-row items-center gap-2.5 border-t border-line bg-paper px-gutter pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      {hasTotal ? (
        <View className="flex-1">
          {totalLabel ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {totalLabel}
            </Text>
          ) : null}
          {totalValue ? (
            <Text variant="total" numberOfLines={1}>
              {totalValue}
            </Text>
          ) : null}
        </View>
      ) : null}
      <View className={hasTotal ? 'shrink' : 'flex-1'}>{children}</View>
    </View>
  );
}
