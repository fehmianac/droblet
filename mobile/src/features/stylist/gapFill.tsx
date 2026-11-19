import { Sparkles } from 'lucide-react-native';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useAddLibraryItems } from '@/api/today';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';

/**
 * Owner decision 3 — a thin wardrobe never ends in "not enough pieces": the stylist fills the gaps with pieces
 * Droblet picks (ready library first, else the store). Library picks join the wardrobe with one tap; the ids added
 * on this device are remembered so every screen shows them as added at once.
 */
const added = new Set<string>();
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version += 1;
  listeners.forEach((l) => l());
};

export const addedLibraryPieces = {
  has: (id: string) => added.has(id),
  mark(ids: readonly string[]) {
    ids.forEach((id) => added.add(id));
    emit();
  },
  /** Tests. */
  reset() {
    added.clear();
    emit();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** "Gardıroba ekle" for library picks: `POST v1/tenant/item/from-library`, then remembered as added. */
export function useAddSuggestedPieces() {
  useSyncExternalStore(addedLibraryPieces.subscribe, () => version, () => version);
  const add = useAddLibraryItems();
  return {
    isAdded: (id: string) => added.has(id),
    isAdding: add.isPending,
    failed: add.isError,
    /** Resolves once the pieces are in the wardrobe (already added ones are skipped). */
    add: async (libraryItemIds: readonly string[]) => {
      const missing = [...new Set(libraryItemIds)].filter((id) => !added.has(id));
      if (missing.length === 0) return;
      await add.mutateAsync(missing);
      addedLibraryPieces.mark(missing);
    },
  };
}

/** The soft banner that replaced the "Parça yetersiz" dead end: some pieces are Droblet's picks — add them? */
export function GapFillBanner({ libraryItemIds, testID = 'gapfill.banner' }: { libraryItemIds: readonly string[]; testID?: string }) {
  const { t } = useTranslation();
  const pieces = useAddSuggestedPieces();
  const open = libraryItemIds.filter((id) => !pieces.isAdded(id));
  return (
    <View className="gap-2.5 rounded-card border border-line bg-sand px-3.5 py-3" testID={testID}>
      <View className="flex-row items-start gap-2.5">
        <Icon icon={Sparkles} size={16} tone="accent" />
        <Text variant="caption" className="flex-1 leading-[18px]">
          {t('req.gapFill.banner')}
        </Text>
      </View>
      {libraryItemIds.length > 0 ? (
        open.length > 0 ? (
          <Button
            variant="secondary"
            size="md"
            label={t('req.gapFill.addAll')}
            loading={pieces.isAdding}
            onPress={() => void pieces.add(open).catch(() => undefined)}
            testID={`${testID}.addAll`}
          />
        ) : (
          <Text variant="caption" tone="muted" accessibilityLiveRegion="polite">
            {t('req.gapFill.added')}
          </Text>
        )
      ) : null}
      {pieces.failed ? (
        <Text variant="caption" tone="danger" accessibilityRole="alert">
          {t('req.gapFill.addFailed')}
        </Text>
      ) : null}
    </View>
  );
}
