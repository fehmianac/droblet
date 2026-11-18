import { router, Slot, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Logo } from '@/components/brand/Logo';
import { Screen } from '@/components/ui/Screen';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';

type WardrobeView = 'items' | 'looks' | 'trips';

const HREF = { items: '/wardrobe', looks: '/wardrobe/looks', trips: '/wardrobe/trips' } as const;

/** Gardırop: one tab, three sub-views (Parçalar / Looklar / Bavullar) — not separate tabs. */
export default function WardrobeLayout() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const current: WardrobeView = pathname.endsWith('/looks') ? 'looks' : pathname.endsWith('/trips') ? 'trips' : 'items';

  return (
    <Screen>
      <View className="gap-4 px-gutter pb-3 pt-2">
        <View className="flex-row">
          <Logo />
        </View>
        <Text variant="display">{t('wardrobe.title')}</Text>
        <SegmentedControl<WardrobeView>
          accessibilityLabel={t('tabs.wardrobe')}
          value={current}
          onChange={(v) => router.replace(HREF[v])}
          segments={[
            { value: 'items', label: t('wardrobe.segmentItems') },
            { value: 'looks', label: t('wardrobe.segmentLooks') },
            { value: 'trips', label: t('wardrobe.segmentTrips') },
          ]}
        />
      </View>
      <Slot />
    </Screen>
  );
}
