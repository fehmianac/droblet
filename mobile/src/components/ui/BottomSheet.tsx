import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useThemeColors } from '@/theme/useThemeColors';

import { Text } from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

/**
 * Bottom sheet (canvas `.sheet`): paper, 28 top radius, 40 × 5 grabber 10 below the edge, scrim tap closes.
 * Animation is off with reduce-motion.
 */
export function BottomSheet({ visible, onClose, title, children }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const colors = useThemeColors();
  return (
    <Modal
      visible={visible}
      transparent
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1 justify-end">
        <Pressable
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
          testID="sheet.scrim"
        />
        {/*
          Opaque paper over the full height, the bottom safe area included, set as a plain style. No shadow class:
          on the new architecture a box shadow on a view with only its top corners rounded drew the sheet's
          background see-through (the screen behind showed through the credit confirmation). The scrim already
          sets the sheet apart.
        */}
        <View
          accessibilityViewIsModal
          className="rounded-t-sheet px-gutter pt-2.5"
          style={{ backgroundColor: colors.paper, paddingBottom: Math.max(insets.bottom, 20) }}
          testID="sheet.body"
        >
          <View className="mb-4 h-[5px] w-10 self-center rounded-pill bg-line" accessible={false} />
          {title ? (
            <Text variant="h3" className="mb-3">
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}
