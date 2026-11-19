import { ChevronRight, Star, type LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, Switch, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useThemeColors } from '@/theme/useThemeColors';

type MenuRowProps = {
  icon?: LucideIcon;
  label: string;
  /** Muted value on the right, e.g. "Sıcak Sonbahar". */
  value?: string;
  /** Badge on the right, e.g. "Yakında". */
  trailing?: ReactNode;
  onPress?: () => void;
  /** Visible but not available (e.g. Aile planı). */
  disabled?: boolean;
  first?: boolean;
  testID?: string;
};

/** One line of a menu card: icon · label · value / badge · chevron. 52 high. */
export function MenuRow({ icon, label, value, trailing, onPress, disabled = false, first = false, testID }: MenuRowProps) {
  const interactive = Boolean(onPress) && !disabled;
  return (
    <Pressable
      testID={testID}
      onPress={interactive ? onPress : undefined}
      disabled={!interactive}
      accessibilityRole={interactive ? 'button' : undefined}
      accessibilityState={{ disabled: !interactive }}
      className={`min-h-btn-primary flex-row items-center gap-3 px-4 py-2 active:opacity-70 ${first ? '' : 'border-t border-line'}`}
    >
      {icon ? <Icon icon={icon} size={20} tone={disabled ? 'muted' : 'ink'} /> : null}
      <Text variant="body" tone={disabled ? 'muted' : 'ink'} className="flex-1">
        {label}
      </Text>
      {value ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {interactive ? <Icon icon={ChevronRight} size={18} tone="muted" /> : null}
    </Pressable>
  );
}

type RadioRowProps = { label: string; selected: boolean; onPress: () => void; first?: boolean; disabled?: boolean };

/** Radio line inside a card (closet visibility, report reason). The whole row is the target. */
export function RadioRow({ label, selected, onPress, first = false, disabled = false }: RadioRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected, disabled }}
      className={`min-h-btn-primary flex-row items-center justify-between gap-3 px-4 py-2 active:opacity-70 ${
        first ? '' : 'border-t border-line'
      }`}
    >
      <Text variant="body" className="flex-1">
        {label}
      </Text>
      <View className={`h-5 w-5 items-center justify-center rounded-pill border ${selected ? 'border-ink' : 'border-line'}`}>
        {selected ? <View className="h-2.5 w-2.5 rounded-pill bg-ink" /> : null}
      </View>
    </Pressable>
  );
}

type ToggleRowProps = { label: string; value: boolean; onChange: (value: boolean) => void; first?: boolean; disabled?: boolean };

export function ToggleRow({ label, value, onChange, first = false, disabled = false }: ToggleRowProps) {
  const colors = useThemeColors();
  return (
    <View className={`min-h-btn-primary flex-row items-center justify-between gap-3 px-4 py-2 ${first ? '' : 'border-t border-line'}`}>
      <Text variant="body" className="flex-1">
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ false: colors.line, true: colors.accent }}
        thumbColor={colors.paper}
        ios_backgroundColor={colors.line}
      />
    </View>
  );
}

type StarRatingProps = { value: number | null; onRate: (score: number) => void };

/** 1–5 stars, each a 44 pt target; stars up to the user's rating are filled. */
export function StarRating({ value, onRate }: StarRatingProps) {
  const { t } = useTranslation();
  return (
    <View className="flex-row" accessibilityRole="radiogroup" accessibilityLabel={t('feed.rateGroup')}>
      {[1, 2, 3, 4, 5].map((score) => {
        const on = value !== null && score <= value;
        return (
          <Pressable
            key={score}
            onPress={() => onRate(score)}
            accessibilityRole="radio"
            accessibilityLabel={t('feed.rateStar', { count: score })}
            accessibilityState={{ checked: value === score }}
            className="h-icon-btn w-icon-btn items-center justify-center active:opacity-70"
          >
            <Icon icon={Star} size={24} tone={on ? 'accent' : 'muted'} filled={on} />
          </Pressable>
        );
      })}
    </View>
  );
}

type ConfirmDialogProps = {
  visible: boolean;
  onCancel: () => void;
  title: string;
  children: ReactNode;
  /** The confirm and cancel buttons. */
  actions: ReactNode;
};

/** Centred alert dialog for irreversible actions (29b). Scrim tap = cancel. */
export function ConfirmDialog({ visible, onCancel, title, children, actions }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  return (
    <Modal visible={visible} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={onCancel} statusBarTranslucent>
      <View className="flex-1 items-center justify-center px-gutter">
        <Pressable
          className="absolute inset-0 bg-scrim"
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel={t('common.cancel')}
        />
        <View accessibilityViewIsModal accessibilityRole="alert" className="w-full gap-4 rounded-card bg-paper p-6">
          <Text variant="h2">{title}</Text>
          {children}
          <View className="gap-2 pt-2">{actions}</View>
        </View>
      </View>
    </Modal>
  );
}
