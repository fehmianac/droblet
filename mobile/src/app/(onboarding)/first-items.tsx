import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Camera, Check } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';

import { track } from '@/analytics/track';
import type { LibraryItem } from '@/api/contracts';
import { useAddLibraryItems, useItemLibrary } from '@/api/today';
import { useSession } from '@/auth/session';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';

const TARGET = 5;

function LibraryTile({ item, selected, onToggle }: { item: LibraryItem; selected: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t(selected ? 'a11y.itemSelected' : 'a11y.selectItem', { name: item.name })}
      testID={`firstItems.item.${item.id}`}
      className="flex-1 gap-1.5"
    >
      <View>
        <PlaceholderImage
          uri={item.imageUrl}
          className={`aspect-[4/5] w-full rounded-image ${selected ? 'border-2 border-ink' : ''}`}
        />
        {selected ? (
          <View className="absolute right-2 top-2 h-6 w-6 items-center justify-center rounded-pill bg-ink">
            <Icon icon={Check} tone="paper" size={14} />
          </View>
        ) : null}
      </View>
      <Text variant="caption" numberOfLines={2}>
        {item.name}
      </Text>
    </Pressable>
  );
}

function GridSkeleton() {
  return (
    <View className="gap-4 px-gutter pt-2">
      {[0, 1].map((row) => (
        <View key={row} className="flex-row gap-3">
          {[0, 1, 2].map((col) => (
            <View key={col} className="flex-1">
              <Skeleton className="aspect-[4/5] w-full rounded-image" />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * 04b İlk 5 parça (3/3) — "Gardırobunda bunlardan hangileri var?" ready-made library grid + camera
 * shortcut. "Devam et" adds the chosen pieces to the wardrobe (`POST v1/tenant/item/from-library`).
 */
export default function FirstItemsScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const library = useItemLibrary();
  const addItems = useAddLibraryItems();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const goToPaywall = () => router.push({ pathname: '/paywall', params: { from: 'onboarding' } });

  const submit = () => {
    if (session.status === 'signedIn') {
      void AsyncStorage.setItem(`droblet.firstItems.${session.user.id}`, JSON.stringify(selected));
    }
    track('signup_step', { step: 'first_items', count: selected.length });
    // The user is never held on this step: a failed add is not fatal, 12b offers the same pieces later.
    addItems.mutate(selected, { onSettled: goToPaywall });
  };

  const openCamera = () => router.push('/item/add');

  return (
    <Screen>
      <ScreenHeader leading="back" right={<Button variant="text" label={t('common.skip')} onPress={goToPaywall} testID="firstItems.skip" />} />
      <View className="gap-2 px-gutter pb-4">
        <Text variant="eyebrow">
          {t('common.eyebrowWithStep', { label: t('firstItems.eyebrow'), step: t('common.stepOf', { current: 3, total: 3 }) })}
        </Text>
        <Text variant="display">{t('firstItems.title')}</Text>
        <Text variant="body" tone="muted">
          {t('firstItems.body')}
        </Text>
        <View className="mt-2 flex-row items-center justify-between gap-3">
          <Text variant="bodyMedium" tone="accent" accessibilityLiveRegion="polite">
            {t('firstItems.counter', { count: selected.length })}
          </Text>
          <Button variant="secondary" icon={Camera} label={t('firstItems.camera')} onPress={openCamera} />
        </View>
      </View>

      <ScreenState
        query={library}
        skeleton={<GridSkeleton />}
        isEmpty={(items) => items.length === 0}
        empty={{ message: t('firstItems.empty'), actionLabel: t('firstItems.emptyAction'), onAction: openCamera }}
      >
        {(items) => (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            numColumns={3}
            columnWrapperClassName="gap-3"
            contentContainerClassName="gap-4 px-gutter pb-8"
            renderItem={({ item }) => (
              <LibraryTile item={item} selected={selected.includes(item.id)} onToggle={() => toggle(item.id)} />
            )}
          />
        )}
      </ScreenState>

      <BottomActionBar>
        <Button
          label={t('common.continue')}
          onPress={submit}
          disabled={selected.length < TARGET}
          loading={addItems.isPending}
          testID="firstItems.continue"
        />
      </BottomActionBar>
    </Screen>
  );
}
