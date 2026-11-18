import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { assignItemsToSlots, parseItemIds, slotMapFromLook } from '@/features/looks/logic';
import { LookEditor } from '@/features/looks/LookEditor';
import { useLook } from '@/features/looks/queries';
import { useItems } from '@/features/wardrobe/queries';

function EditorSkeleton() {
  return (
    <View className="gap-5 px-gutter pt-2">
      <View className="flex-row gap-4">
        <Skeleton className="aspect-[4/5] w-36 rounded-image-lg" />
        <View className="flex-1 justify-center gap-2">
          <Skeleton className="h-3 w-3/4 rounded-field" />
          <Skeleton className="h-3 w-1/2 rounded-field" />
        </View>
      </View>
      <Skeleton className="h-btn-primary w-full rounded-field" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[76px] w-full rounded-card" />
      ))}
    </View>
  );
}

function leave() {
  if (router.canGoBack()) router.back();
  else router.replace('/wardrobe/looks');
}

/**
 * 15 Look oluştur. Params: `id` = edit a saved look; `itemIds` = comma-separated wardrobe item ids
 * preselected in the 10 multi-select (each goes to the slot its category fills).
 * The editor mounts once its starting data is known, so its state is plain `useState`.
 */
export default function LookNewScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string; itemIds?: string }>();
  const id = typeof params.id === 'string' && params.id ? params.id : null;
  const itemIds = parseItemIds(params.itemIds);
  const items = useItems();
  const look = useLook(id);

  // Creating without preselected pieces needs nothing loaded up front (the slot sheet reads the wardrobe itself).
  if (!id && itemIds.length === 0) {
    return <LookEditor look={null} initialSlots={{}} items={items.data} />;
  }

  const shell = (title: string, body: React.ReactNode) => (
    <Screen bottom>
      <ScreenHeader title={title} leading="close" onLeadingPress={leave} />
      {body}
    </Screen>
  );

  if (!id) {
    if (items.data !== undefined) {
      const { slots, skipped } = assignItemsToSlots(items.data, itemIds);
      return <LookEditor look={null} initialSlots={slots} skippedCount={skipped.length} items={items.data} />;
    }
    return shell(t('lookEditor.titleNew'), <ScreenState query={items}>{() => null}</ScreenState>);
  }

  // Edit: the look is required; the wardrobe is only needed to flag deleted pieces, so an unavailable
  // wardrobe (offline, error) must not block editing.
  const itemsSettled = items.data !== undefined || items.status === 'error' || items.fetchStatus === 'paused';
  if (look.data !== undefined && itemsSettled) {
    return <LookEditor key={look.data.id} look={look.data} initialSlots={slotMapFromLook(look.data, items.data)} items={items.data} />;
  }
  return shell(
    t('lookEditor.titleEdit'),
    <ScreenState query={look}>
      {() => <EditorSkeleton />}
    </ScreenState>,
  );
}
