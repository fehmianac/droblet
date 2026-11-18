import { View } from 'react-native';

import { Skeleton } from '@/components/ui/Skeleton';

/** Loading shape of 06: date line, two-line greeting, the 58-high day strip, the outfit card, the edit strip. */
export function TodaySkeleton() {
  return (
    <View className="gap-[18px] px-gutter pt-1.5">
      <View className="gap-2">
        <Skeleton className="h-3 w-48 rounded-field" />
        <Skeleton className="h-9 w-3/4 rounded-field" />
        <Skeleton className="h-9 w-1/2 rounded-field" />
      </View>
      <View className="flex-row gap-1.5">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <View key={i} className="flex-1">
            <Skeleton className="h-[58px] w-full rounded-image-lg" />
          </View>
        ))}
      </View>
      <Skeleton className="h-[372px] w-full rounded-card" />
      <View className="flex-row gap-2.5">
        <Skeleton className="h-[190px] w-[140px] rounded-image-lg" />
        <Skeleton className="h-[190px] w-[140px] rounded-image-lg" />
      </View>
    </View>
  );
}
