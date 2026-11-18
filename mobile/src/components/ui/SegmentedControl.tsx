import { Pressable, View } from 'react-native';

import { Text } from './Text';

export type Segment<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

/** Sand track; the selected segment is paper with a light shadow. */
export function SegmentedControl<T extends string>({ segments, value, onChange, accessibilityLabel }: Props<T>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className="h-btn-secondary flex-row rounded-pill bg-sand p-1"
    >
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            onPress={() => onChange(s.value)}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected }}
            className={`flex-1 items-center justify-center rounded-pill ${selected ? 'bg-paper shadow-sm' : ''}`}
          >
            <Text variant="bodyMedium" tone={selected ? 'ink' : 'muted'} numberOfLines={1}>
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
