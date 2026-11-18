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
};

/** 36 high pill, line border on the screen colour, Jost 13 (canvas `.chip`). Selected = filled ink, cream text. */
export function Chip({ label, selected = false, onPress, disabled = false, badge, accessibilityHint }: ChipProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      hitSlop={{ top: 4, bottom: 4 }}
      className={`h-chip flex-row items-center gap-1.5 rounded-pill border px-[15px] ${
        selected ? 'border-ink bg-ink' : 'border-line bg-transparent'
      } ${disabled ? 'opacity-40' : 'active:opacity-80'}`}
    >
      <Text variant="chip" tone={selected ? 'cream' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
      {badge ? (
        <View className="h-[18px] justify-center rounded-pill bg-sand px-2">
          <Text variant="dot" className="font-sans-medium">
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
