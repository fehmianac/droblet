import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from './Text';

type Props = {
  /** e.g. "Toplam · 4 parça" */
  totalLabel?: string;
  /** e.g. "₺26.550" */
  totalValue?: string;
  /** Usually one primary Button. */
  children: ReactNode;
};

/** Sticky bottom bar replacing the tab bar on detail/create/checkout screens: paper, top hairline. */
export function BottomActionBar({ totalLabel, totalValue, children }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center gap-4 border-t border-line bg-paper px-gutter pt-3"
      style={{ paddingBottom: Math.max(insets.bottom, 12) }}
    >
      {totalLabel || totalValue ? (
        <View className="gap-0.5">
          {totalLabel ? (
            <Text variant="caption" tone="muted">
              {totalLabel}
            </Text>
          ) : null}
          {totalValue ? <Text variant="h3">{totalValue}</Text> : null}
        </View>
      ) : null}
      <View className="flex-1">{children}</View>
    </View>
  );
}
