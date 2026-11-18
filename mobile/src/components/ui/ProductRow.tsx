import { Pressable, View } from 'react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatMoney, type Money } from '@/lib/format';
import { toBrandUpper } from '@/lib/upper';

import { MissingTag } from './Bits';
import { ImageSlot } from './ImageSlot';
import { Text } from './Text';

type Props = {
  brand: string;
  name: string;
  /** Null when unknown. */
  price: Money | null;
  imageUri?: string | null;
  /** The product's category / colour (wardrobe or catalogue vocabulary): glyph and ground of the placeholder. */
  category?: string | null;
  color?: string | null;
  onPress?: () => void;
  trailing?: ReactNode;
  /** Marks a piece the user does not own yet: "EKSİK" on the thumbnail. */
  missing?: boolean;
};

/** 56 × 68 thumbnail (radius 10) + BRAND + name (one line, ellipsis) + price (canvas "Ürün satırı"). */
export function ProductRow({ brand, name, price, imageUri, category, color, onPress, trailing, missing = false }: Props) {
  const { t } = useTranslation();
  const brandLabel = toBrandUpper(brand);
  const label = [missing ? t('common.missingPiece') : null, brand, name, price !== null ? formatMoney(price) : null].filter(Boolean).join(', ');
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessible
      accessibilityLabel={label}
      className="min-h-16 flex-row items-center gap-3 py-2"
    >
      <View>
        <ImageSlot uri={imageUri} className="h-[68px] w-14 rounded-thumb" placeholder={{ kind: 'garment', category, color, glyphSize: 24 }} />
        {missing ? <MissingTag short className="absolute right-1 top-1" /> : null}
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="brand" tone="muted" numberOfLines={1}>
          {brandLabel}
        </Text>
        <Text variant="body" numberOfLines={1}>
          {name}
        </Text>
      </View>
      {price !== null ? <Text variant="price">{formatMoney(price)}</Text> : null}
      {trailing}
    </Pressable>
  );
}
