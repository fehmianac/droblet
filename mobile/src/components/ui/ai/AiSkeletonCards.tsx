import { View } from 'react-native';

import { placeholderTones, type PlaceholderTone } from '@/theme/tokens';

import { Silhouette } from '../Silhouette';
import { Skeleton } from '../Skeleton';
import { AiReveal } from './AiReveal';
import { AiShimmer } from './AiShimmer';

const DEFAULT_TONES: readonly PlaceholderTone[] = ['dark', 'taupe', 'clay'];
const LINE_WIDTHS = [
  ['w-4/5', 'w-[55%]'],
  ['w-[70%]', 'w-[45%]'],
  ['w-3/4', 'w-1/2'],
] as const;

type Props = {
  /** How many suggestion cards are coming (stilist: 3). */
  count?: number;
  tones?: readonly PlaceholderTone[];
  /** Height of each card's image area. */
  imageClassName?: string;
};

/**
 * Suggestion cards "filling in" one after another (500 ms apart, 4.5 s loop) over shimmering
 * skeletons — the stilist wait (`AiYukleniyorStilist.dc.html`). With reduce-motion: plain skeletons.
 */
export function AiSkeletonCards({ count = 3, tones = DEFAULT_TONES, imageClassName = 'h-[200px]' }: Props) {
  return (
    <View className="flex-row gap-2.5" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length: count }, (_, i) => {
        const widths = LINE_WIDTHS[i % LINE_WIDTHS.length] ?? LINE_WIDTHS[0];
        const tone = tones[i % tones.length] ?? 'taupe';
        return (
          <View key={i} className="flex-1 gap-2">
            <View className={`overflow-hidden rounded-image-lg bg-sand ${imageClassName}`}>
              <AiShimmer band={0.6} from={-1.2} to={2.2} />
              <AiReveal index={i} preset="card" className="absolute inset-0" fill>
                <View className="h-full w-full items-center justify-center" style={{ backgroundColor: placeholderTones[tone] }}>
                  <Silhouette height={74} tone={tone === 'dark' ? 'cream' : 'ink'} />
                </View>
              </AiReveal>
            </View>
            <Skeleton className={`h-2.5 rounded-[5px] ${widths[0]}`} />
            <Skeleton className={`h-2.5 rounded-[5px] ${widths[1]}`} />
          </View>
        );
      })}
    </View>
  );
}

/** Skeleton piece rows (thumb + two lines) under a card that is still being written. */
export function AiSkeletonRows({ count = 2 }: { count?: number }) {
  return (
    <View className="gap-2.5" accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} className="flex-row items-center gap-3">
          <Skeleton className="h-12 w-10 rounded-[8px]" />
          <View className="flex-1 gap-1.5">
            <Skeleton className={`h-2.5 rounded-[5px] ${i % 2 === 0 ? 'w-[70%]' : 'w-3/5'}`} />
            <Skeleton className={`h-2.5 rounded-[5px] ${i % 2 === 0 ? 'w-2/5' : 'w-[35%]'}`} />
          </View>
        </View>
      ))}
    </View>
  );
}
