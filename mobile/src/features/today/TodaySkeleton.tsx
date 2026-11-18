import { View } from 'react-native';

import { Skeleton } from '@/components/ui/Skeleton';

export function TodaySkeleton() {
  return (
    <View className="gap-6 px-gutter pt-4">
      <View className="gap-3">
        <Skeleton className="h-3 w-48 rounded-field" />
        <Skeleton className="h-9 w-3/4 rounded-field" />
        <Skeleton className="h-9 w-1/2 rounded-field" />
      </View>
      <Skeleton className="h-16 w-full rounded-card" />
      <Skeleton className="aspect-[4/5] w-full rounded-card" />
      <View className="flex-row gap-3">
        <Skeleton className="h-40 w-36 rounded-image-lg" />
        <Skeleton className="h-40 w-36 rounded-image-lg" />
      </View>
    </View>
  );
}
