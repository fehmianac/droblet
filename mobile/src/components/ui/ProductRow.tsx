import { Pressable, View } from 'react-native';
import type { ReactNode } from 'react';

import { formatMoney, type Money } from '@/lib/format';
import { toBrandUpper } from '@/lib/upper';

import { PlaceholderImage } from './PlaceholderImage';
import { Text } from './Text';

type Props = {
  brand: string;
  name: string;
  /** Null when unknown. */
  price: Money | null;
  imageUri?: string | null;
  onPress?: () => void;
  trailing?: ReactNode;
};

/** Small image + BRAND + name (one line, ellipsis) + price. */
export function ProductRow({ brand, name, price, imageUri, onPress, trailing }: Props) {
  const brandLabel = toBrandUpper(brand);
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[brand, name, price !== null ? formatMoney(price) : null].filter(Boolean).join(', ')}
      className="min-h-16 flex-row items-center gap-3 py-2"
    >
      <PlaceholderImage uri={imageUri} className="h-[70px] w-14 rounded-image" />
      <View className="flex-1 gap-0.5">
        <Text variant="brand" tone="muted" numberOfLines={1}>
          {brandLabel}
        </Text>
        <Text variant="body" numberOfLines={1}>
          {name}
        </Text>
      </View>
      {price !== null ? <Text variant="bodyMedium">{formatMoney(price)}</Text> : null}
      {trailing}
    </Pressable>
  );
}
