import { router } from 'expo-router';
import { ShoppingBag } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useCartCount } from '@/api/cart';
import { InlinePlaceholder } from '@/components/navigation/InlinePlaceholder';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { IconButton } from '@/components/ui/IconButton';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';

type DiscoverSection = 'editor' | 'shop' | 'influencer' | 'friends' | 'series';

const SECTIONS: { value: DiscoverSection; labelKey: `discover.chip${'Editor' | 'Shop' | 'Influencer' | 'Friends' | 'Series'}` }[] = [
  { value: 'editor', labelKey: 'discover.chipEditor' },
  { value: 'shop', labelKey: 'discover.chipShop' },
  { value: 'influencer', labelKey: 'discover.chipInfluencer' },
  { value: 'friends', labelKey: 'discover.chipFriends' },
  { value: 'series', labelKey: 'discover.chipSeries' },
];

/** 20 Keşfet shell: top chips + cart icon with badge. Section content arrives with E8/E9. */
export default function DiscoverTab() {
  const { t } = useTranslation();
  const [section, setSection] = useState<DiscoverSection>('editor');
  const cart = useCartCount();
  const count = cart.data ?? 0;

  return (
    <Screen>
      <OfflineBanner />
      <View className="flex-row items-center justify-between px-gutter pb-2 pt-2">
        <View className="gap-1">
          <Text variant="eyebrow">{t('brand.wordmark')}</Text>
          <Text variant="display">{t('discover.title')}</Text>
        </View>
        <IconButton
          icon={ShoppingBag}
          badge={count}
          onPress={() => router.push('/cart')}
          accessibilityLabel={count > 0 ? t('a11y.cartWithCount', { count }) : t('a11y.cart')}
        />
      </View>
      <ChipRow>
        {SECTIONS.map((s) => (
          <Chip key={s.value} label={t(s.labelKey)} selected={section === s.value} onPress={() => setSection(s.value)} />
        ))}
      </ChipRow>
      <InlinePlaceholder />
    </Screen>
  );
}
