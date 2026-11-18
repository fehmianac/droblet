import { Check, ChevronRight, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { sizes } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

/**
 * Rows of the profile area exactly as the canvas draws them on 28 / 29 / 29c: a paper card padded 14,
 * rows 44–45 high, hairlines between rows that stop at the card's padding (not edge to edge).
 */

/** Paper card (20 radius, hairline) whose rows are inset by 14. */
export function RowCard({ children, className }: { children: ReactNode; className?: string }) {
  return <View className={`rounded-card border border-line bg-paper px-3.5 ${className ?? ''}`}>{children}</View>;
}

export type CanvasGlyphName = 'hanger' | 'mirror';
export type RowIcon = LucideIcon | CanvasGlyphName;

/** Canvas glyphs Lucide does not have, drawn with the board's own paths: the brand hanger and the standing mirror. */
export function CanvasGlyph({ name, size, tone = 'ink' }: { name: CanvasGlyphName; size: number; tone?: 'ink' | 'muted' }) {
  const colors = useThemeColors();
  const stroke = { stroke: colors[tone], strokeWidth: sizes.iconStroke, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {name === 'hanger' ? (
        <>
          <Path d="M10 6.5a2 2 0 1 1 2.6 1.9c-.4.2-.6.6-.6 1V10.5" {...stroke} />
          <Path d="M12 10.5 3.4 17.4c-.6.5-.3 1.6.5 1.6h16.2c.8 0 1.1-1.1.5-1.6z" {...stroke} />
        </>
      ) : (
        <>
          <Rect x={6} y={3} width={12} height={15} rx={6} {...stroke} />
          <Path d="M12 18v3M8 21h8" {...stroke} />
        </>
      )}
    </Svg>
  );
}

function RowGlyph({ icon, size, tone }: { icon: RowIcon; size: number; tone: 'ink' | 'muted' }) {
  return typeof icon === 'string' ? <CanvasGlyph name={icon} size={size} tone={tone} /> : <Icon icon={icon} size={size} tone={tone} />;
}

type MenuRowProps = {
  icon: RowIcon;
  label: string;
  /** Muted value on the right ("Sıcak Sonbahar", "Yıllık"). */
  value?: string;
  /** Badge on the right ("1 fiyat düştü", "Yakında"). */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Visible but not available yet (Aile planı): muted, no chevron. */
  disabled?: boolean;
  first?: boolean;
  testID?: string;
};

/** 28 menu line: 19 icon · 14.5 label · value / badge · 16 chevron; 45 high. */
export function ProfileMenuRow({ icon, label, value, trailing, onPress, disabled = false, first = false, testID }: MenuRowProps) {
  const interactive = Boolean(onPress) && !disabled;
  const tone = disabled ? 'muted' : 'ink';
  return (
    <Pressable
      testID={testID}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityState={{ disabled: !interactive }}
      className={`min-h-[45px] flex-row items-center gap-3 py-1.5 active:opacity-70 ${first ? '' : 'border-t border-line'}`}
    >
      <RowGlyph icon={icon} size={19} tone={tone} />
      <Text variant="body" tone={tone} className="flex-1 text-[14.5px]">
        {label}
      </Text>
      {value ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {interactive ? <Icon icon={ChevronRight} size={16} /> : null}
    </Pressable>
  );
}

type ChoiceRowProps = {
  label: string;
  checked: boolean;
  onPress: () => void;
  /** radio = one of a group (closet visibility); checkbox = on / off (notification types). */
  kind: 'radio' | 'checkbox';
  first?: boolean;
  disabled?: boolean;
};

/** 29 choice line: 14.5 label, a 20 pt ink radio or check box on the right; the whole 44 pt row is the target. */
export function ChoiceRow({ label, checked, onPress, kind, first = false, disabled = false }: ChoiceRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={kind}
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      className={`min-h-icon-btn flex-row items-center gap-3 py-1.5 active:opacity-70 ${first ? '' : 'border-t border-line'} ${
        disabled ? 'opacity-40' : ''
      }`}
    >
      <Text variant="body" className="flex-1 text-[14.5px]">
        {label}
      </Text>
      {kind === 'radio' ? (
        <View className={`h-5 w-5 items-center justify-center rounded-pill border ${checked ? 'border-ink' : 'border-muted'}`}>
          {checked ? <View className="h-3 w-3 rounded-pill bg-ink" /> : null}
        </View>
      ) : (
        <View className={`h-5 w-5 items-center justify-center rounded-[3px] border ${checked ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
          {checked ? <Icon icon={Check} size={15} tone="cream" /> : null}
        </View>
      )}
    </Pressable>
  );
}

/** 29c "what is deleted" line: 18 icon + 14 text, 44 high. Not interactive. */
export function InfoRow({ icon, label, first = false }: { icon: RowIcon; label: string; first?: boolean }) {
  return (
    <View className={`min-h-icon-btn flex-row items-center gap-3 py-1.5 ${first ? '' : 'border-t border-line'}`}>
      <RowGlyph icon={icon} size={18} tone="ink" />
      <Text variant="body" className="flex-1">
        {label}
      </Text>
    </View>
  );
}
