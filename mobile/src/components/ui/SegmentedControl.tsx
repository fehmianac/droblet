import { Pressable, View } from 'react-native';

import { Text } from './Text';

export type Segment<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  segments: Segment<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  /**
   * 'paper' (default) — Gardırop's Parçalar / Looklar / Bavullar: 44 track, the selected segment is paper with a
   * light shadow. 'ink' — the 02 Kayıt ol / Giriş yap switch: 48 track, the selected segment is filled ink.
   */
  variant?: 'paper' | 'ink';
  /** Each segment gets `${testID}.${value}`. */
  testID?: string;
};

/** Sand track with 4 pt padding and gap; segments are full pills. */
export function SegmentedControl<T extends string>({ segments, value, onChange, accessibilityLabel, variant = 'paper', testID }: Props<T>) {
  const ink = variant === 'ink';
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      className={`flex-row gap-1 rounded-pill bg-sand p-1 ${ink ? 'h-12' : 'h-btn-secondary'}`}
    >
      {segments.map((s) => {
        const selected = s.value === value;
        return (
          <Pressable
            key={s.value}
            testID={testID ? `${testID}.${s.value}` : undefined}
            onPress={() => onChange(s.value)}
            accessibilityRole="tab"
            accessibilityLabel={s.label}
            accessibilityState={{ selected }}
            className={`flex-1 items-center justify-center rounded-pill ${
              selected ? (ink ? 'bg-ink' : 'bg-paper shadow-sm') : ''
            }`}
          >
            <Text
              variant={ink ? 'chip' : 'segment'}
              tone={selected ? (ink ? 'cream' : 'ink') : ink ? 'ink' : 'muted'}
              numberOfLines={1}
            >
              {s.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
