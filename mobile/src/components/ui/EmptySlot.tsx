import { Plus } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

import { Icon } from './Icon';
import { Text } from './Text';

type Props = {
  label: string;
  hint?: string;
  onPress: () => void;
  className?: string;
};

/** Dashed frame + plus; opens a picker sheet. */
export function EmptySlot({ label, hint, onPress, className }: Props) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('a11y.addSlot', { label })}
      accessibilityHint={hint}
      className={`min-h-icon-btn items-center justify-center gap-1 rounded-image-lg border border-dashed border-line p-3 active:opacity-70 ${
        className ?? ''
      }`}
    >
      <Icon icon={Plus} tone="muted" />
      <Text variant="caption" tone="muted" numberOfLines={2} className="text-center">
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" tone="muted" numberOfLines={2} className="text-center">
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}
