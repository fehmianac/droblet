import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  /** Pad for the top safe area (default true). */
  top?: boolean;
  /** Pad for the bottom safe area — off when a tab bar or BottomActionBar handles it. */
  bottom?: boolean;
  className?: string;
};

/** Cream screen background + safe areas. */
export function Screen({ children, top = true, bottom = false, className }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className={`flex-1 bg-cream ${className ?? ''}`}
      style={{ paddingTop: top ? insets.top : 0, paddingBottom: bottom ? insets.bottom : 0 }}
    >
      {children}
    </View>
  );
}
