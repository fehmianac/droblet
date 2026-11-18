import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Camera, Check, ChevronRight } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import { track } from '@/analytics/track';
import type { LibraryItem } from '@/api/contracts';
import { useItemLibrary } from '@/api/today';
import { useSession } from '@/auth/session';
import { StepHeader } from '@/components/auth/StepHeader';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Screen } from '@/components/ui/Screen';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { libraryCategory } from '@/features/wardrobe/form';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';

/** The board shows a 3 × 3 selection; the whole library is one tap away. */
const GRID_SIZE = 9;
const COLUMNS = 3;

function rowsOf<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += COLUMNS) rows.push(items.slice(i, i + COLUMNS));
  return rows;
}

function LibraryTile({ item, selected, onToggle }: { item: LibraryItem; selected: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onToggle}
      testID={`firstItems.item.${item.id}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={t(selected ? 'a11y.itemSelected' : 'a11y.selectItem', { name: item.name })}
      className="flex-1 gap-1.5 active:opacity-80"
    >
      <View>
        <ItemThumb
          category={libraryCategory(item.category)}
          color="white"
          uri={item.imageUrl}
          glyphSize={36}
          className={`h-20 w-full rounded-image border-2 ${selected ? 'border-ink' : 'border-transparent'}`}
        />
        {selected ? (
          <View className="absolute right-1.5 top-1.5 h-[22px] w-[22px] items-center justify-center rounded-pill bg-ink">
            <Icon icon={Check} tone="cream" size={13} />
          </View>
        ) : null}
      </View>
      <Text variant="caption" className="leading-[15px]" numberOfLines={2}>
        {item.name}
      </Text>
    </Pressable>
  );
}

function GridSkeleton() {
  return (
    <View className="gap-2.5 px-5 pt-3">
      <Skeleton className="h-14 w-full rounded-card" />
      {[0, 1, 2].map((row) => (
        <View key={row} className="flex-row gap-2.5">
          {[0, 1, 2].map((col) => (
            <View key={col} className="flex-1 gap-1.5">
              <Skeleton className="h-20 w-full rounded-image" />
              <Skeleton className="h-3 w-2/3 rounded-tag" />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * 04b İlk 5 parça (3/3) — "Gardırobunda bunlardan hangileri var?": camera shortcut card, a 3 × 3 grid of
 * ready-made pieces, a link to the whole library and the bottom bar with the "N / 5 seçildi" counter.
 * Five is a recommendation, not a gate. No backend contract yet (E2): the selection is kept on the device
 * under the user's key.
 */
export default function FirstItemsScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const library = useItemLibrary();
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = () => {
    if (session.status === 'signedIn') {
      void AsyncStorage.setItem(`droblet.firstItems.${session.user.id}`, JSON.stringify(selected));
    }
    track('signup_step', { step: 'first_items', count: selected.length });
    router.push({ pathname: '/paywall', params: { from: 'onboarding' } });
  };

  const openCamera = () => router.push('/item/add');

  const cameraCard = (
    <Pressable
      onPress={openCamera}
      accessibilityRole="button"
      accessibilityLabel={t('firstItems.camera')}
      accessibilityHint={t('firstItems.cameraBody')}
      className="min-h-[56px] flex-row items-center gap-3 rounded-card border border-line bg-paper px-3.5 py-2.5 active:opacity-80"
    >
      <View className="h-10 w-10 items-center justify-center rounded-pill bg-ink">
        <Icon icon={Camera} size={18} tone="cream" />
      </View>
      <View className="flex-1">
        <Text variant="bodyMedium">{t('firstItems.camera')}</Text>
        <Text variant="caption" tone="muted">
          {t('firstItems.cameraBody')}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={16} />
    </Pressable>
  );

  return (
    <Screen>
      <StepHeader step={3} total={3} />
      <View className="gap-2 px-6 pt-3.5">
        <Text variant="eyebrow">{t('firstItems.eyebrow')}</Text>
        <Text variant="display" className="text-[29px] leading-[31px]">
          {t('firstItems.title')}
        </Text>
        <Text variant="body" tone="muted">
          {t('firstItems.body')}
        </Text>
      </View>

      <ScreenState
        query={library}
        skeleton={<GridSkeleton />}
        isEmpty={(items) => items.length === 0}
        empty={{ message: t('firstItems.empty'), actionLabel: t('firstItems.emptyAction'), onAction: openCamera }}
      >
        {(items) => (
          <ScrollView className="flex-1" contentContainerClassName="gap-3 px-5 pb-4 pt-3">
            {cameraCard}
            <View className="gap-2.5">
              {rowsOf(items.slice(0, GRID_SIZE)).map((row) => (
                <View key={row.map((item) => item.id).join()} className="flex-row gap-2.5">
                  {row.map((item) => (
                    <LibraryTile key={item.id} item={item} selected={selected.includes(item.id)} onToggle={() => toggle(item.id)} />
                  ))}
                  {Array.from({ length: COLUMNS - row.length }, (_, i) => (
                    <View key={`pad${i}`} className="flex-1" />
                  ))}
                </View>
              ))}
            </View>
            <Pressable
              onPress={() => router.push('/item/library')}
              accessibilityRole="link"
              accessibilityLabel={t('firstItems.seeLibrary')}
              className="min-h-icon-btn items-center justify-center active:opacity-70"
            >
              <Text variant="label">{t('firstItems.seeLibrary')}</Text>
            </Pressable>
          </ScrollView>
        )}
      </ScreenState>

      <BottomActionBar>
        <View className="flex-row items-center gap-2.5">
          <View className="flex-1" accessibilityLiveRegion="polite">
            <Text variant="button" numberOfLines={1}>
              {t('firstItems.counter', { count: selected.length })}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t('firstItems.counterHint')}
            </Text>
          </View>
          <Button size="bar" label={t('common.continue')} onPress={submit} testID="firstItems.continue" />
        </View>
      </BottomActionBar>
    </Screen>
  );
}
