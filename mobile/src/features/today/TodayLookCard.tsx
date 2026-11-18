import { router } from 'expo-router';
import { Check, Heart, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { TodayLook } from '@/api/contracts';
import { AiImage } from '@/components/ui/AiBadge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Text } from '@/components/ui/Text';

type Props = {
  look: TodayLook;
  onWear: () => void;
  onRefresh: () => void;
  onToggleFavorite: () => void;
  refreshing: boolean;
};

/**
 * Bugünün kombini: "Senin üzerinde" AI image, piece thumbnails, missing-piece marker + "Look'u tamamla",
 * refresh (another suggestion), heart (lookbook), primary "Bunu giyiyorum".
 */
export function TodayLookCard({ look, onWear, onRefresh, onToggleFavorite, refreshing }: Props) {
  const { t } = useTranslation();
  const missing = look.pieces.filter((p) => p.source === 'store');

  return (
    <View className="gap-4 rounded-card border border-line bg-paper p-4">
      <AiImage kind="onYou" uri={look.tryOnImageUrl} className="aspect-[4/5] w-full" accessibilityLabel={look.name} />

      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-1.5">
          <View className="flex-row items-center gap-2">
            <Text variant="eyebrow">{t('today.lookEyebrow')}</Text>
            <View className="rounded-pill bg-sand px-2.5 py-0.5">
              <Text variant="caption">{t(`occasion.${look.occasion}`)}</Text>
            </View>
          </View>
          <Text variant="h2">{look.name}</Text>
        </View>
        <IconButton icon={RefreshCw} onPress={onRefresh} disabled={refreshing} accessibilityLabel={t('a11y.refreshLook')} />
        <IconButton
          icon={Heart}
          active={look.isFavorite}
          onPress={onToggleFavorite}
          accessibilityLabel={t(look.isFavorite ? 'a11y.unfavorite' : 'a11y.favorite')}
        />
      </View>

      <View className="flex-row gap-2">
        {look.pieces.map((p) => (
          <View key={p.id} className="flex-1 gap-1">
            <PlaceholderImage
              uri={p.imageUrl}
              accessibilityLabel={p.source === 'store' ? `${p.name}, ${t('today.missingPiece')}` : p.name}
              className={`aspect-[4/5] w-full rounded-image ${p.source === 'store' ? 'border border-dashed border-accent' : ''}`}
            />
            {p.source === 'store' ? (
              <Text variant="caption" tone="accent" numberOfLines={1}>
                {t('today.missingPiece')}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {missing.length > 0 ? (
        <Button
          variant="secondary"
          label={t('today.completeLook')}
          onPress={() => router.push({ pathname: '/shop/builder', params: { lookId: look.id } })}
        />
      ) : null}

      {look.wornToday ? (
        <View
          className="h-btn-primary flex-row items-center justify-center gap-2 rounded-pill bg-sand"
          accessibilityLiveRegion="polite"
          accessible
          accessibilityLabel={t('today.worn')}
        >
          <Icon icon={Check} tone="accent" size={18} />
          <Text variant="button">{t('today.worn')}</Text>
        </View>
      ) : (
        <Button label={t('today.wearThis')} onPress={onWear} />
      )}
    </View>
  );
}
