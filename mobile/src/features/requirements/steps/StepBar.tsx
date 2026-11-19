import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** The bottom bar of a step (canvas `.bar`): hairline on top, the actions stacked, safe-area padded. */
export function StepBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View className="gap-2 border-t border-line bg-cream px-6 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
      {children}
    </View>
  );
}

export type StepProps = {
  /** The step finished: the stepper moves on (or to "Hazır"). */
  onDone: () => void;
};
