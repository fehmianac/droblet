import { useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';

/**
 * React Native's `KeyboardAvoidingView` works out the overlap from its own `onLayout` frame, which is relative to
 * its parent — so when it sits inside a wrapper (`ScreenState`, a route's own `View`, a page sheet below the
 * status bar) it believes it starts at the top of the window and pads by the header's height too little. On a
 * 4.7" screen that left the fixed footer (Kaydet on Profili düzenle) behind the keyboard. This wrapper measures
 * where it really is in the window and hands that to `keyboardVerticalOffset`; the avoiding view inside starts
 * at y 0 of the wrapper, so the sum is exact wherever it is mounted. iOS only (Android resizes the window).
 */
export function KeyboardAvoider({ children, testID }: { children: ReactNode; testID?: string }) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const [offset, setOffset] = useState(0);
  if (Platform.OS !== 'ios') {
    return (
      <View className="flex-1" testID={testID}>
        {children}
      </View>
    );
  }
  return (
    <View
      ref={ref}
      className="flex-1"
      collapsable={false}
      testID={testID ? `${testID}.frame` : undefined}
      onLayout={() => ref.current?.measureInWindow((_x, y) => setOffset((prev) => (Number.isFinite(y) && y !== prev ? Math.max(0, y) : prev)))}
    >
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={offset} className="flex-1" testID={testID}>
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
