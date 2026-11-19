import { useQueries } from '@tanstack/react-query';
import { History } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { TryOnTarget } from '@/api/contracts/tryon';
import { cachedTryOnImageId, cachedTryOnJobId } from '@/api/wire/tryon';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

import { existingTryOnQuery, useExistingTryOn } from './api';

/**
 * Canvas 13d — "Üzerimde gör" for a target that already has an image with the current photo (same pieces + same
 * body photo, or same face photo + body type): the server would answer from its cache and charge nothing, so the
 * credit confirmation must not open. The check (`GET v1/tenant/tryon?kind=&id=`) runs when the screen opens, so the
 * tap is instant; when it has not answered, failed or the device is offline, `cachedJobId` is null and the caller
 * falls back to the confirmation sheet (the server still answers from its cache and charges nothing).
 *
 *   const cached = useCachedTryOn({ kind: 'look', id });
 *   const onTryOn = () => (cached.cachedJobId ? openResult(cached.cachedJobId) : openCreditSheet());
 */
export function useCachedTryOn(target: TryOnTarget | null, options: { enabled?: boolean } = {}) {
  const existing = useExistingTryOn(target, options);
  const imageId = existing.data?.tryOnId ?? null;
  return {
    /** The pseudo job id that opens the existing image (`/tryon/[jobId]`, `useTryOnJob`) — null when there is none (yet). */
    cachedJobId: imageId ? cachedTryOnJobId(imageId) : null,
    checking: existing.isFetching,
  };
}

/**
 * The same check for several targets (a trip's days): target id → the pseudo job id of its existing image, or null.
 * A target missing from the map has not answered (yet) or failed — treat it as uncached.
 */
export function useCachedTryOns(targets: TryOnTarget[], options: { enabled?: boolean } = {}): Record<string, string | null> {
  const results = useQueries({ queries: targets.map((target) => existingTryOnQuery(target, options.enabled ?? true)) });
  const map: Record<string, string | null> = {};
  targets.forEach((target, i) => {
    const data = results[i]?.data;
    if (data !== undefined) map[target.id] = data?.tryOnId ? cachedTryOnJobId(data.tryOnId) : null;
  });
  return map;
}

/** True for the pseudo job id of an image that already existed (nothing was generated, no credit spent). */
export function isCachedTryOnJob(jobId: string | null | undefined): boolean {
  return cachedTryOnImageId(jobId) !== null;
}

/** "Daha önce oluşturuldu · kredi harcanmadı" — under an image that came from the cache (13d). */
export function CachedTryOnNote({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <View className={`flex-row items-center gap-1.5 ${className ?? ''}`} accessible accessibilityRole="text" testID="tryon.cachedNote">
      <Icon icon={History} size={14} tone="accent" />
      <Text variant="caption" tone="accent" className="font-sans-medium text-[12.5px]">
        {t('tryOn.cachedNote')}
      </Text>
    </View>
  );
}
