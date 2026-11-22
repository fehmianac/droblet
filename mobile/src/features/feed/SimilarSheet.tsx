import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';

import type { FeedPost } from '@/api/contracts/feed';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { formatMoney } from '@/lib/format';

import { useSimilarProducts } from './queries';

type Props = {
  post: FeedPost | null;
  onClose: () => void;
};

/**
 * "Benzerlerini gör" on a member's look (Akış F2, decision 21): catalogue products close to the look's pieces —
 * picture, name, brand and price; a row opens the existing product screen (22), where buying happens on the brand's
 * site as everywhere else. Read when the sheet opens; never drawn for teen accounts (the caller hides the button).
 */
export function SimilarSheet({ post, onClose }: Props) {
  const { t } = useTranslation();
  const similar = useSimilarProducts(post?.id ?? null);
  const products = similar.data ?? [];

  return (
    <BottomSheet visible={post !== null} onClose={onClose}>
      {post ? (
        <ScrollView style={{ maxHeight: 520 }} contentContainerClassName="gap-3 pb-2.5" testID="feed.similarSheet" accessibilityLabel={t('homeFeed.similarSheet.title')}>
          <View className="pt-0.5">
            <Text variant="h3" accessibilityRole="header">
              {t('homeFeed.similarSheet.title')}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {t('homeFeed.similarSheet.subtitle', { title: post.title, author: post.author.name })}
            </Text>
          </View>

          {similar.isPending ? (
            <View className="gap-2" accessible accessibilityLabel={t('homeFeed.similarSheet.loading')} accessibilityState={{ busy: true }}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[74px] w-full rounded-image-lg" />
              ))}
            </View>
          ) : similar.isError ? (
            <View className="gap-3" testID="feed.similar.error">
              <Text variant="body" tone="muted" accessibilityLiveRegion="polite">
                {t('homeFeed.similarSheet.error')}
              </Text>
              <Button variant="secondary" label={t('common.retry')} onPress={() => void similar.refetch()} />
            </View>
          ) : products.length === 0 ? (
            <Text variant="body" tone="muted" testID="feed.similar.empty">
              {t('homeFeed.similarSheet.empty')}
            </Text>
          ) : (
            products.map((p) => {
              const price = p.price ? formatMoney(p.price) : null;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => {
                    onClose();
                    router.push({ pathname: '/shop/product/[id]', params: { id: p.id } });
                  }}
                  accessibilityRole="link"
                  accessibilityLabel={
                    price ? t('homeFeed.piecePriceA11y', { name: p.name, brand: p.brandName, price }) : t('homeFeed.pieceA11y', { name: p.name, brand: p.brandName })
                  }
                  testID={`feed.similar.${p.id}`}
                  className="flex-row items-center gap-2.5 rounded-image-lg border border-feed-line bg-paper p-2 active:opacity-80"
                >
                  <ImageSlot uri={p.imageUrl} className="h-14 w-14 rounded-thumb" placeholder={{ kind: 'garment', category: p.category, color: p.colors[0], glyphSize: 26 }} />
                  <View className="min-w-0 flex-1 gap-[3px]">
                    <Text variant="bodyMedium" className="text-[13.5px] leading-[18px]" numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {price ? `${p.brandName} · ${price}` : p.brandName}
                    </Text>
                  </View>
                  <Icon icon={ChevronRight} size={18} tone="muted" />
                </Pressable>
              );
            })
          )}
        </ScrollView>
      ) : null}
    </BottomSheet>
  );
}
