import { View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';

type Props = {
  /** One sentence. */
  message: string;
  /** One action. */
  actionLabel?: string;
  onAction?: () => void;
  actionLoading?: boolean;
};

/** Empty / error / offline / placeholder content: one sentence + one clear next step. */
export function StateMessage({ message, actionLabel, onAction, actionLoading }: Props) {
  return (
    <View className="flex-1 items-center justify-center gap-5 px-gutter py-12">
      <Text variant="body" tone="muted" className="text-center">
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" loading={actionLoading} />
      ) : null}
    </View>
  );
}
