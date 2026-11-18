import { Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { currentLanguage } from '@/i18n';
import { formatTry } from '@/lib/format';
import { toDisplayUpper } from '@/lib/upper';

import { PlaceholderImage } from './PlaceholderImage';
import { Text } from './Text';

type Props = {
  brand: string;
  name: string;
  /** TRY amount; null when unknown. */
  price: number | null;
  imageUri?: string | null;
  onPress?: () => void;
  trailing?: ReactNode;
};

/** Small image + BRAND + name (one line, ellipsis) + price. */
export function ProductRow({ brand, name, price, imageUri, onPress, trailing }: Props) {
  useTranslation(); // re-render on language change (brand casing depends on it)
  const brandLabel = toDisplayUpper(brand, currentLanguage());
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[brand, name, price !== null ? formatTry(price) : null].filter(Boolean).join(', ')}
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
      {price !== null ? <Text variant="bodyMedium">{formatTry(price)}</Text> : null}
      {trailing}
    </Pressable>
  );
}
