import type { LucideIcon } from 'lucide-react-native';
import { Pressable, ScrollView, View } from 'react-native';
import type { ReactNode } from 'react';

import { Icon } from './Icon';
import { Text } from './Text';

type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  /** Small trailing badge, e.g. "Yakında" on disabled segments. */
  badge?: string;
  /** 14 pt glyph after the label, e.g. the chevron of a filter chip that opens a sheet. */
  trailingIcon?: LucideIcon;
  accessibilityHint?: string;
  testID?: string;
  /** A 5-pt dot after the label (13c: "this day already has a plan"). */
  dot?: boolean;
  /** Replaces the label read by screen readers (e.g. "Sal 24 Kas, planı var"). */
  accessibilityLabel?: string;
  /** A 12-pt colour dot before the label (the RENK chips of 21 "Filtrele"): `#RRGGBB`. */
  swatch?: string;
  /** Stretch to the cell and centre the label (chips laid out in a grid, e.g. the 3-column ORTAM grid on 16). */
  fill?: boolean;
};

/** 36 high pill, line border on the screen colour, Jost 13 (canvas `.chip`). Selected = filled ink, cream text. */
export function Chip({ label, selected = false, onPress, disabled = false, badge, trailingIcon, accessibilityHint, fill = false, dot = false, swatch, accessibilityLabel, testID }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (badge ? `${label}, ${badge}` : label)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      hitSlop={{ top: 4, bottom: 4 }}
      className={`h-chip flex-row items-center gap-1.5 rounded-pill border ${fill ? 'justify-center self-stretch px-2' : 'px-[15px]'} ${
        selected ? 'border-ink bg-ink' : 'border-line bg-transparent'
      } ${disabled ? 'opacity-40' : 'active:opacity-80'}`}
    >
      {swatch ? <View className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: swatch }} /> : null}
      <Text variant="chip" tone={selected ? 'cream' : 'ink'} numberOfLines={1}>
        {label}
      </Text>
      {dot ? <View className={`h-[5px] w-[5px] rounded-full ${selected ? 'bg-cream' : 'bg-accent'}`} testID={testID ? `${testID}.dot` : undefined} /> : null}
      {trailingIcon ? <Icon icon={trailingIcon} size={14} tone={selected ? 'cream' : 'ink'} /> : null}
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
export function ChipWrap({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View className="flex-row flex-wrap gap-2" testID={testID}>
      {children}
    </View>
  );
}
