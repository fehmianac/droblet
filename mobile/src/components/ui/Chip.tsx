import { Pressable, ScrollView, View } from 'react-native';
import type { ReactNode } from 'react';

import { Text } from './Text';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Small trailing badge, e.g. "Yakında" on disabled segments. */
  badge?: string;
  accessibilityHint?: string;
  testID?: string;
};

/** 36 high pill. Selected = filled ink. */
export function Chip({ label, selected = false, onPress, disabled = false, badge, accessibilityHint, testID }: ChipProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      testID={testID}
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      hitSlop={{ top: 4, bottom: 4 }}
      className={`h-chip flex-row items-center gap-2 rounded-pill border px-4 ${
        selected ? 'border-ink bg-ink' : 'border-line bg-paper'
      } ${disabled ? 'opacity-40' : 'active:opacity-80'}`}
    >
      <Text variant="bodyMedium" tone={selected ? 'paper' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
      {badge ? (
        <View className="rounded-pill bg-sand px-2 py-0.5">
          <Text variant="caption" tone="accent">
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Horizontally scrolling chip row, inset by the 20 pt gutter. */
export function ChipRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerClassName="gap-2 px-gutter py-1"
    >
      {children}
    </ScrollView>
  );
}

/** Wrapping chip group for forms (e.g. style tags). */
export function ChipWrap({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-2">{children}</View>;
}
