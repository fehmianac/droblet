import { router, useCanGoBack } from 'expo-router';
import { ChevronLeft, X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IconButton } from './IconButton';
import { Text } from './Text';

type Props = {
  title?: string;
  /** 'back' (default when history exists), 'close' for modals, or none. */
  leading?: 'back' | 'close' | 'none';
  onLeadingPress?: () => void;
  /** 'outline' draws the leading button with the line border (the ✕ of 15 Look oluştur). Default 'plain'. */
  leadingVariant?: 'plain' | 'outline';
  /** Screen-reader name of the leading button when it is not plain "Geri" / "Kapat" (e.g. "Vazgeç" on an AI wait). */
  leadingLabel?: string;
  right?: ReactNode;
};

/**
 * Header of a pushed screen, as on every canvas detail board: 48 high, borderless back button pulled
 * 10 into the gutter, the title centred (Jost 500, 15) between 70 pt insets, actions on the right.
 */
export function ScreenHeader({ title, leading, onLeadingPress, leadingVariant = 'plain', leadingLabel, right }: Props) {
  const { t } = useTranslation();
  // Hook, not `router.canGoBack()`: the imperative router is unavailable when a detail screen is the first route (deep link).
  const canGoBack = useCanGoBack();
  const mode = leading ?? (canGoBack ? 'back' : 'none');
  const onPress = onLeadingPress ?? (() => router.back());
  return (
    <View className="h-12 flex-row items-center justify-between px-gutter">
      {title ? (
        <View className="absolute left-[70px] right-[70px] items-center" pointerEvents="none">
          <Text variant="title" numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      {mode === 'none' ? (
        <View />
      ) : (
        <IconButton
          icon={mode === 'close' ? X : ChevronLeft}
          variant={leadingVariant}
          iconSize={leadingVariant === 'outline' ? 20 : 22}
          onPress={onPress}
          accessibilityLabel={leadingLabel ?? t(mode === 'close' ? 'a11y.close' : 'a11y.back')}
          className={leadingVariant === 'outline' ? '' : '-ml-2.5'}
        />
      )}
      <View className="flex-row items-center gap-2">{right}</View>
    </View>
  );
}
