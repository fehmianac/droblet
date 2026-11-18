import { router } from 'expo-router';
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
  right?: ReactNode;
};

export function ScreenHeader({ title, leading, onLeadingPress, right }: Props) {
  const { t } = useTranslation();
  const mode = leading ?? (router.canGoBack() ? 'back' : 'none');
  const onPress = onLeadingPress ?? (() => router.back());
  return (
    <View className="min-h-14 flex-row items-center gap-2 px-gutter py-1">
      {mode === 'none' ? null : (
        <IconButton
          icon={mode === 'close' ? X : ChevronLeft}
          variant="plain"
          onPress={onPress}
          accessibilityLabel={t(mode === 'close' ? 'a11y.close' : 'a11y.back')}
          className="-ml-3"
        />
      )}
      <View className="flex-1">
        {title ? (
          <Text variant="h3" numberOfLines={1}>
            {title}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}
