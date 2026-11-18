import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import type { EditProduct } from '@/api/contracts/today';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Text } from '@/components/ui/Text';
import { formatMoney } from '@/lib/format';
import { toBrandUpper } from '@/lib/upper';

type Props = {
  product: EditProduct;
  onPress: () => void;
  /** "İzleme listeme ekle" button, or the "Gardırobunda" badge of an owned piece. */
  trailing: ReactNode;
};

/**
 * A piece of the weekly edit (08), as drawn: 52 × 64 thumbnail, BRAND, name, the price under the name, the
 * trailing control on the right and a hairline under the row.
 */
export function EditProductRow({ product, onPress, trailing }: Props) {
  const price = formatMoney(product.price);
  return (
    <View className="flex-row items-center gap-3 border-b border-line py-2">
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={[product.brand, product.name, price].join(', ')}
        className="flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <PlaceholderImage uri={product.imageUrl} className="h-16 w-[52px] rounded-thumb" />
        <View className="flex-1 gap-0.5">
          <Text variant="brand" tone="muted" numberOfLines={1}>
            {toBrandUpper(product.brand)}
          </Text>
          <Text variant="body" numberOfLines={1} className="text-[13.5px] leading-[18px]">
            {product.name}
          </Text>
          <Text variant="price">{price}</Text>
        </View>
      </Pressable>
      {trailing}
    </View>
  );
}
