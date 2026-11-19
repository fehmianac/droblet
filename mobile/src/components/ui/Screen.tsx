import { useRef, useState, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  children: ReactNode;
  /** Pad for the top safe area (default true). */
  top?: boolean;
  /** Pad for the bottom safe area — off when a tab bar or BottomActionBar handles it. */
  bottom?: boolean;
  className?: string;
};

/**
 * Cream screen background + safe areas. On iOS a screen shown in a page sheet (a `modal` presentation, or a screen
 * pushed inside one) starts below the status bar already, but the root safe-area inset still reports the status bar:
 * padding by it left an empty status-bar-high strip above the header (12c Parça bilgisi, the paywall ×). A screen
 * whose top sits lower than the window's top therefore drops the top inset.
 */
export function Screen({ children, top = true, bottom = false, className }: Props) {
  const insets = useSafeAreaInsets();
  const ref = useRef<View>(null);
  const [inSheet, setInSheet] = useState(false);
  const measure = () => {
    if (Platform.OS !== 'ios' || !top) return;
    ref.current?.measureInWindow((_x, y) => {
      // A page sheet starts ~10 pt under the status bar; a full-screen screen at 0 (also while it slides in).
      const sheet = typeof y === 'number' && y >= insets.top && insets.top > 0;
      setInSheet((prev) => (prev === sheet ? prev : sheet));
    });
  };
  return (
    <View
      ref={ref}
      onLayout={() => {
        measure();
        // Again once a presentation animation has settled (the first layout can happen mid-transition).
        setTimeout(measure, 450);
      }}
      className={`flex-1 bg-cream ${className ?? ''}`}
      style={{ paddingTop: top && !inSheet ? insets.top : 0, paddingBottom: bottom ? insets.bottom : 0 }}
    >
      {children}
    </View>
  );
}
