import { useId, useRef } from 'react';
import { Platform, Pressable, TextInput, View, type TextInputInstance } from 'react-native';

import { useThemeColors } from '@/theme/useThemeColors';

import { Text } from './Text';
import { KeyboardDoneBar } from './TextField';

type Props = {
  value: string;
  onChangeText: (value: string) => void;
  /** Called once all boxes are filled (auto-submit). */
  onComplete?: (value: string) => void;
  length?: number;
  label: string;
  error?: boolean;
  editable?: boolean;
  autoFocus?: boolean;
  testID?: string;
};

/**
 * A one-time code as separate boxes (e-mail verification). One real field under the boxes keeps paste, the iOS
 * "from Messages / Mail" suggestion (`oneTimeCode`) and deleting natural; the cursor moves to the next box as digits
 * arrive, and the last digit calls `onComplete`. The number pad gets the "Bitti" bar.
 */
export function CodeInput({ value, onChangeText, onComplete, length = 6, label, error = false, editable = true, autoFocus = true, testID = 'code' }: Props) {
  const colors = useThemeColors();
  const ref = useRef<TextInputInstance>(null);
  const accessoryId = `code-done-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const digits = value.split('');
  const active = Math.min(value.length, length - 1);

  return (
    <Pressable onPress={() => ref.current?.focus()} accessible={false} testID={`${testID}.boxes`}>
      <View className="flex-row justify-between gap-2" pointerEvents="none">
        {Array.from({ length }, (_, i) => (
          <View
            key={i}
            className={`h-14 flex-1 items-center justify-center rounded-field border bg-paper ${
              error ? 'border-danger' : i === active && editable ? 'border-ink' : 'border-line'
            }`}
            testID={`${testID}.box.${i}`}
          >
            <Text variant="h2">{digits[i] ?? ''}</Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={ref}
        value={value}
        onChangeText={(text) => {
          const clean = text.replace(/\D/g, '').slice(0, length);
          onChangeText(clean);
          if (clean.length === length) onComplete?.(clean);
        }}
        editable={editable}
        autoFocus={autoFocus}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete={Platform.OS === 'android' ? 'sms-otp' : 'one-time-code'}
        maxLength={length}
        caretHidden
        selectionColor={colors.accent}
        accessibilityLabel={label}
        inputAccessoryViewID={Platform.OS === 'ios' ? accessoryId : undefined}
        testID={testID}
        // Covers the boxes so a tap anywhere focuses it; transparent, the boxes draw the digits.
        className="absolute inset-0 text-transparent"
        style={{ color: 'transparent' }}
      />
      {Platform.OS === 'ios' ? <KeyboardDoneBar nativeID={accessoryId} /> : null}
    </Pressable>
  );
}
