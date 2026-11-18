import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '@/hooks/useReduceMotion';

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
          className="absolute inset-0 bg-scrim"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('a11y.close')}
        />
        <View
          accessibilityViewIsModal
          className="rounded-t-sheet bg-paper px-gutter pt-2.5 shadow-lg"
          style={{ paddingBottom: Math.max(insets.bottom, 20) }}
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
