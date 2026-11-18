import { Redirect } from 'expo-router';
import { Heart, ShoppingBag } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import { AiImage } from '@/components/ui/AiBadge';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Chip, ChipRow } from '@/components/ui/Chip';
import { EmptySlot } from '@/components/ui/EmptySlot';
import { IconButton } from '@/components/ui/IconButton';
import { LookCard } from '@/components/ui/LookCard';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { ProductCard } from '@/components/ui/ProductCard';
import { ProductRow } from '@/components/ui/ProductRow';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { formatTry } from '@/lib/format';

/** Component showcase (dev builds only) — sample data from the design's 08 Haftanın edit'i. */
export default function ComponentsShowcase() {
  const { t } = useTranslation();
  const [segment, setSegment] = useState<'a' | 'b' | 'c'>('a');
  const [chip, setChip] = useState(0);
  const [fav, setFav] = useState(false);
  const [sheet, setSheet] = useState(false);

  if (!__DEV__) return <Redirect href="/" />;

  return (
    <Screen>
      <ScreenHeader title={t('screens.components')} />
      <OfflineBanner />
      <ScrollView contentContainerClassName="gap-8 pb-8">
        <View className="gap-3 px-gutter">
          <Text variant="eyebrow">{t('style.eyebrow')}</Text>
          <Text variant="display">{t('style.title')}</Text>
          <Text variant="h2">{t('body.title')}</Text>
          <Text variant="h3">{t('today.weeklyEdit')}</Text>
          <Text variant="body">{t('welcome.promise')}</Text>
          <Text variant="brand" tone="muted">
            {t('brand.wordmark')}
          </Text>
        </View>

        <View className="gap-3 px-gutter">
          <Text variant="h3">{t('dev.buttons')}</Text>
          <Button label={t('today.wearThis')} onPress={() => setSheet(true)} />
          <Button variant="secondary" label={t('today.completeLook')} onPress={() => undefined} />
          <Button label={t('dev.loadingButton')} onPress={() => undefined} loading />
          <Button label={t('dev.disabledButton')} onPress={() => undefined} disabled />
          <View className="flex-row gap-3">
            <IconButton icon={Heart} active={fav} onPress={() => setFav(!fav)} accessibilityLabel={t('a11y.favorite')} />
            <IconButton icon={ShoppingBag} badge={4} onPress={() => undefined} accessibilityLabel={t('a11y.cart')} />
          </View>
        </View>

        <View className="gap-3">
          <Text variant="h3" className="px-gutter">
            {t('dev.chips')}
          </Text>
          <ChipRow>
            {(['office', 'dinner', 'weekend', 'wedding', 'travel', 'sport'] as const).map((o, i) => (
              <Chip key={o} label={t(`occasion.${o}`)} selected={chip === i} onPress={() => setChip(i)} />
            ))}
            <Chip label={t('style.segment.men')} disabled badge={t('common.comingSoon')} />
          </ChipRow>
          <View className="px-gutter">
            <SegmentedControl
              value={segment}
              onChange={setSegment}
              segments={[
                { value: 'a', label: t('wardrobe.segmentItems') },
                { value: 'b', label: t('wardrobe.segmentLooks') },
                { value: 'c', label: t('wardrobe.segmentTrips') },
              ]}
            />
          </View>
        </View>

        <View className="gap-3 px-gutter">
          <Text variant="h3">{t('dev.cards')}</Text>
          <AiImage kind="onYou" uri={null} className="aspect-[4/5] w-full" />
          <AiImage kind="preview" uri={null} className="aspect-[4/5] w-2/3" />
          <ProductRow brand="Marks & Spencer" name="Beyaz Poplin Gömlek" price={3000} />
          <ProductRow brand="Beymen Club" name="City Medium Siyah Çanta" price={12950} />
          <View className="flex-row gap-3">
            <ProductCard brand="Vakko" name="Yün Karışımlı Blazer" price={null} favorite={fav} onToggleFavorite={() => setFav(!fav)} onPress={() => undefined} />
            <ProductCard brand="Communité" name="Triko Kazak" price={4200} favorite={false} onToggleFavorite={() => undefined} onPress={() => undefined} />
          </View>
          <View className="flex-row gap-3">
            <LookCard className="flex-1" tag={t('occasion.office')} name="Lacivert Blazer" rating={4.6} onPress={() => undefined} />
            <View className="flex-1">
              <EmptySlot label={t('occasion.evening')} onPress={() => undefined} className="aspect-[4/5]" />
            </View>
          </View>
        </View>

        <View className="gap-3 px-gutter">
          <Text variant="h3">{t('dev.states')}</Text>
          <Skeleton className="h-24 w-full rounded-card" />
          <StateMessage message={t('states.placeholder')} actionLabel={t('common.retry')} onAction={() => undefined} />
        </View>
      </ScrollView>
      <BottomActionBar totalLabel={`${t('product.total')} · ${t('product.piecesCount', { count: 4 })}`} totalValue={formatTry(26550)}>
        <Button label={t('dev.sampleBuy')} onPress={() => setSheet(true)} />
      </BottomActionBar>
      <BottomSheet visible={sheet} onClose={() => setSheet(false)} title={t('dev.sheet')}>
        <Text variant="body" tone="muted">
          {t('body.privacy')}
        </Text>
      </BottomSheet>
    </Screen>
  );
}
