import type { LucideIcon } from 'lucide-react-native';
import { View } from 'react-native';

import { Button, type ButtonVariant } from './Button';
import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  /** One sentence. */
  message: string;
  /** One action. */
  actionLabel?: string;
  onAction?: () => void;
  actionLoading?: boolean;
  /**
   * The `Durum*` boards: a 96 sand circle with a 40 line glyph, a serif headline above the sentence and the
   * action as a full-width button. All optional — without them the message stays the plain sentence + action.
   */
  icon?: LucideIcon;
  title?: string;
  /** Glyph inside the action button (the "Tekrar dene" arrow). */
  actionIcon?: LucideIcon;
  /** `primary` draws the action as on the boards (ink, full width, 52). Default: the outlined 44 button. */
  actionVariant?: Extract<ButtonVariant, 'primary' | 'secondary'>;
  actionDisabled?: boolean;
  /** Outlined second action under the first one (`DurumBos`: "Hazır kütüphaneden seç"). */
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  /** `alert` = an error (announced at once, `DurumHata`); `status` = empty / offline (announced politely). */
  role?: 'alert' | 'status';
  testID?: string;
};

/** Empty / error / offline / placeholder content: one sentence + one clear next step. */
export function StateMessage({
  message,
  actionLabel,
  onAction,
  actionLoading,
  icon,
  title,
  actionIcon,
  actionVariant = 'secondary',
  actionDisabled,
  secondaryActionLabel,
  onSecondaryAction,
  role,
  testID,
}: Props) {
  const board = actionVariant === 'primary';
  const hasAction = Boolean(actionLabel && onAction);
  const hasSecondary = Boolean(secondaryActionLabel && onSecondaryAction);
  return (
    <View
      testID={testID}
      className={`flex-1 items-center justify-center px-gutter ${board ? 'gap-4 pb-24 pt-6' : 'gap-5 py-12'}`}
      accessibilityRole={role === 'alert' ? 'alert' : undefined}
      accessibilityLiveRegion={role === 'alert' ? 'assertive' : role === 'status' ? 'polite' : undefined}
    >
      {icon ? (
        <View className="h-24 w-24 items-center justify-center rounded-pill bg-sand">
          <Icon icon={icon} size={40} />
        </View>
      ) : null}
      {title ? (
        <Text variant="h2" className="px-4 text-center" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      <Text variant="body" tone="muted" className="px-4 text-center">
        {message}
      </Text>
      {hasAction || hasSecondary ? (
        <View className={board ? 'w-full gap-2 px-4' : 'items-center gap-2'}>
          {actionLabel && onAction ? (
            <Button
              label={actionLabel}
              onPress={onAction}
              variant={actionVariant}
              icon={actionIcon}
              loading={actionLoading}
              disabled={actionDisabled}
            />
          ) : null}
          {secondaryActionLabel && onSecondaryAction ? (
            <Button label={secondaryActionLabel} onPress={onSecondaryAction} variant="secondary" size={board ? 'lg' : 'md'} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
