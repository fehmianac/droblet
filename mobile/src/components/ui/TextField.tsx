import { CircleAlert, Eye, EyeOff } from 'lucide-react-native';
import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput, View, type TextInputInstance, type TextInputProps } from 'react-native';

import { useThemeColors } from '@/theme/useThemeColors';

import { Icon } from './Icon';
import { Text } from './Text';

type Props = Omit<TextInputProps, 'className' | 'ref'> & {
  ref?: Ref<TextInputInstance>;
  label: string;
  /** Shown under the field in danger colour, with an icon (colour never carries meaning alone). */
  error?: string | null;
  hint?: string;
  /** Adds a show/hide toggle. */
  password?: boolean;
};

export function TextField({ label, error, hint, password = false, ref, value, ...input }: Props) {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [hidden, setHidden] = useState(true);
  /**
   * A password field is NOT controlled from JS. On iOS a secure field whose text is written back by React
   * treats the next key as "replace everything", so only the last typed character survived (seen on the
   * simulator: "Sm0keTest2026" arrived as "6"). The native field keeps its own text; `onChangeText` still
   * reports every change, and `value` is only used as the starting text.
   */
  const [initialValue] = useState(value);
  const textProps = password ? { defaultValue: initialValue } : { value };
  return (
    <View className="gap-1.5">
      <Text variant="label">{label}</Text>
      <View
        className={`h-field flex-row items-center rounded-field border bg-paper ${
          error ? 'border-danger' : 'border-line'
        }`}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityHint={error ?? hint}
          placeholderTextColor={colors.muted}
          selectionColor={colors.accent}
          secureTextEntry={password && hidden}
          maxFontSizeMultiplier={1.6}
          multiline={false}
          numberOfLines={1}
          className="h-full flex-1 px-3.5 font-sans text-[15px] text-ink"
          {...textProps}
          {...input}
        />
        {password ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            testID={input.testID ? `${input.testID}.toggle` : undefined}
            accessibilityRole="button"
            accessibilityLabel={t(hidden ? 'a11y.showPassword' : 'a11y.hidePassword')}
            className="h-icon-btn w-icon-btn items-center justify-center"
          >
            <Icon icon={hidden ? Eye : EyeOff} size={20} tone="muted" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <View className="flex-row items-center gap-1.5" accessibilityLiveRegion="polite">
          <Icon icon={CircleAlert} size={14} tone="danger" />
          <Text variant="caption" tone="danger" className="flex-1">
            {error}
          </Text>
        </View>
      ) : hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
