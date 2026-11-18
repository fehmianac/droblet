import { Image } from 'expo-image';
import { View } from 'react-native';

type Props = {
  uri?: string | null;
  className?: string;
  accessibilityLabel?: string;
};

/**
 * Image slot. Without a URI it renders the design's sand placeholder box.
 * Size, aspect ratio and radius come from `className` (e.g. `aspect-[4/5] rounded-image-lg`).
 */
export function PlaceholderImage({ uri, className, accessibilityLabel }: Props) {
  return (
    <View
      className={`overflow-hidden bg-sand ${className ?? ''}`}
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
    >
      {uri ? <Image source={{ uri }} contentFit="cover" className="h-full w-full" transition={150} /> : null}
    </View>
  );
}
