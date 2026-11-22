import { ExternalLink } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ScrollView, View } from 'react-native';

import type { FeedPost } from '@/api/contracts/feed';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { formatMoney } from '@/lib/format';

import { buyableProducts, ownedProducts } from './logic';
import { useOpenOnBrandSite } from './useOpenOnBrandSite';

type Props = {
  post: FeedPost | null;
  onClose: () => void;
};

/**
 * "Look'taki ürünler" (canvas 06″ buy sheet): the post's cover and title, the products that can be bought and are not
 * in the wardrobe — each "Satın al" opens the product on its brand's site — then "GARDIROBUNDA VAR" and the line
 * saying sale, payment and delivery are the brand's. Never drawn for teen accounts (the caller hides the button).
 */
export function BuySheet({ post, onClose }: Props) {
  const { t } = useTranslation();
  const brandSite = useOpenOnBrandSite();
  const buyable = post ? buyableProducts(post) : [];
  const owned = post ? ownedProducts(post) : [];

  return (
    <BottomSheet visible={post !== null} onClose={onClose}>
      {post ? (
        <ScrollView style={{ maxHeight: 560 }} contentContainerClassName="gap-3 pb-2.5" testID="feed.buySheet" accessibilityLabel={t('homeFeed.buySheet.title')}>
          <View className="flex-row items-center gap-3 pt-0.5">
            <ImageSlot
              uri={post.images[0] ?? null}
              className="h-[60px] w-12 rounded-thumb"
              placeholder={{ kind: 'look', pieces: post.products.map((p) => ({ category: p.category, color: p.colors[0], imageUrl: p.imageUrl })), seed: post.id }}
            />
            <View className="flex-1">
              <Text variant="h3" accessibilityRole="header">
                {t('homeFeed.buySheet.title')}
              </Text>
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t('homeFeed.buySheet.subtitle', { title: post.title, author: post.author.name })}
              </Text>
            </View>
          </View>

          {buyable.length > 0 ? (
            <>
              <Text variant="eyebrow" className="mt-1">
                {t('homeFeed.buySheet.buyable', { count: buyable.length })}
              </Text>
              {buyable.map((p) => (
                <View key={p.id} className="gap-1">
                  <View className="flex-row items-center gap-2.5 rounded-image-lg border border-feed-line bg-paper p-2" testID={`feed.buy.${p.id}`}>
                    <ImageSlot
                      uri={p.imageUrl}
                      className="h-14 w-14 rounded-thumb"
                      placeholder={{ kind: 'garment', category: p.category, color: p.colors[0], glyphSize: 26 }}
                    />
                    <View className="min-w-0 flex-1 gap-[3px]">
                      <Text variant="bodyMedium" className="text-[13.5px] leading-[18px]" numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text variant="caption" tone="muted" numberOfLines={1}>
                        {p.price ? `${p.brandName} · ${formatMoney(p.price)}` : p.brandName}
                      </Text>
                    </View>
                    <Button
                      label={t('homeFeed.buySheet.buy')}
                      size="md"
                      icon={ExternalLink}
                      iconPosition="trailing"
                      loading={brandSite.pendingId === p.id}
                      onPress={() => brandSite.open(p, { source: 'post', postId: post.id })}
                      accessibilityHint={t('homeFeed.buySheet.buyA11y', { name: p.name, brand: p.brandName })}
                      className="px-3"
                      testID={`feed.buy.open.${p.id}`}
                    />
                  </View>
                  {brandSite.error?.productId === p.id ? (
                    <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
                      {brandSite.error.message}
                    </Text>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}

          {owned.length > 0 ? (
            <>
              <Text variant="eyebrow" className="mt-1">
                {t('homeFeed.buySheet.owned')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {owned.map((p) => (
                  <View key={p.id} className="min-w-[45%] flex-1 flex-row items-center gap-2 rounded-image bg-feed-thumb p-1.5" testID={`feed.owned.${p.id}`}>
                    <ImageSlot
                      uri={p.imageUrl}
                      className="h-9 w-9 rounded-[8px]"
                      placeholder={{ kind: 'garment', category: p.category, color: p.colors[0], glyphSize: 18 }}
                    />
                    <Text variant="caption" className="flex-1 text-[12.5px]" numberOfLines={1}>
                      {p.name}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}

          <Text variant="caption" tone="muted" className="mt-0.5 text-center text-[11.5px] leading-[17px]">
            {t('homeFeed.buySheet.disclaimer')}
          </Text>
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}
