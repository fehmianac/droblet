import { CircleAlert } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

/**
 * Canvas 11a: the one-line hint under a gated button — "Boy fotoğrafın gerekiyor · 2 adım". Tapping it opens
 * the same requirements sheet as the button. Renders nothing when the action can run.
 */
export function RequirementHint({ hint, onPress, testID = 'requirements.hint', className }: { hint: string | null; onPress: () => void; testID?: string; className?: string }) {
  if (!hint) return null;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hint}
      testID={testID}
      hitSlop={6}
      className={`min-h-[20px] flex-row items-center justify-center gap-1 active:opacity-70 ${className ?? ''}`}
    >
      <Icon icon={CircleAlert} size={12} tone="accent" />
      <Text variant="caption" tone="accent" className="font-sans-medium text-[11.5px]" numberOfLines={1}>
        {hint}
      </Text>
    </Pressable>
  );
}

/** The small count on a gated button ("Üzerimde gör ②"): how many steps are missing. */
export function StepCountBadge({ count, tone = 'accent' }: { count: number; tone?: 'accent' | 'ink' }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <View
      className={`h-5 min-w-5 items-center justify-center rounded-pill px-1 ${tone === 'accent' ? 'bg-accent' : 'bg-ink'}`}
      accessible
      accessibilityLabel={t('req.hint.badgeA11y', { count })}
      testID="requirements.badge"
    >
      <Text variant="badge" tone="paper" className="text-[11px]">
        {String(count)}
      </Text>
    </View>
  );
}
