import { View } from 'react-native';

import { AiBadge } from '@/components/ui/AiBadge';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Silhouette } from '@/components/ui/Silhouette';

type Props = {
  /** Owner-only try-on image; null until one is generated. */
  uri: string | null;
  /** Size, flex and radius (the 06 card and the 08 hero draw it square-cornered, edge to edge). */
  className?: string;
  /** Height of the standing figure shown while there is no image yet. */
  silhouetteHeight: number;
  accessibilityLabel?: string;
};

/**
 * The "SENİN ÜZERİNDE" image as boards 06 and 08 draw it: no radius of its own, the standing figure
 * while the image is not there yet, and the AI marker bottom-left (always on — AI output is marked).
 */
export function OnYouImage({ uri, className, silhouetteHeight, accessibilityLabel }: Props) {
  return (
    <View className={`overflow-hidden ${className ?? ''}`}>
      <PlaceholderImage uri={uri} className="h-full w-full" accessibilityLabel={accessibilityLabel} />
      {uri ? null : (
        <View className="absolute inset-0 items-center justify-center" pointerEvents="none">
          <Silhouette height={silhouetteHeight} />
        </View>
      )}
      <View className="absolute bottom-2 left-2" pointerEvents="none">
        <AiBadge kind="onYou" />
      </View>
    </View>
  );
}
