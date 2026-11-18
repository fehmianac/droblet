import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Logo } from '@/components/brand/Logo';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Text } from '@/components/ui/Text';

export type WardrobeView = 'items' | 'looks' | 'trips';

const HREF = { items: '/wardrobe', looks: '/wardrobe/looks', trips: '/wardrobe/trips' } as const;

type Props = {
  current: WardrobeView;
  /** Upper-case label above the title ("GARDIROBUN", "LOOKBOOK") — written upper-case in the translation file. */
  eyebrow: string;
  /** Count headline ("86 parça"). Omit while loading. */
  title?: string;
  /** Icon buttons on the logo row (search, add). */
  actions?: ReactNode;
  /** Sits right of the title ("Seç" chip). */
  titleAccessory?: ReactNode;
  /** Rendered between the logo row and the title (e.g. the search field). */
  children?: ReactNode;
};

/**
 * Shared top of the three Gardırop sub-views (Parçalar / Looklar / Bavullar — one tab, not three):
 * logo row + actions, eyebrow + count headline, and the segment switch.
 */
export function WardrobeHeader({ current, eyebrow, title, actions, titleAccessory, children }: Props) {
  const { t } = useTranslation();
  return (
    <View className="gap-3 px-gutter pb-3">
      <View className="h-12 flex-row items-center justify-between">
        <Logo />
        <View className="flex-row items-center gap-2">{actions}</View>
      </View>
      {children}
      <View className="flex-row items-end justify-between gap-3">
        <View className="flex-1 gap-1">
          <Text variant="eyebrow">{eyebrow}</Text>
          <Text variant="display" numberOfLines={1}>
            {title ?? ' '}
          </Text>
        </View>
        {titleAccessory}
      </View>
      <SegmentedControl<WardrobeView>
        accessibilityLabel={t('tabs.wardrobe')}
        value={current}
        onChange={(v) => {
          if (v !== current) router.replace(HREF[v]);
        }}
        segments={[
          { value: 'items', label: t('wardrobe.segmentItems') },
          { value: 'looks', label: t('wardrobe.segmentLooks') },
          { value: 'trips', label: t('wardrobe.segmentTrips') },
        ]}
      />
    </View>
  );
}
