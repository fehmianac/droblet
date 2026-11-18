import { router } from 'expo-router';
import { Check, ChevronRight, Heart, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { TodayLook } from '@/api/contracts';
import { AiBusyButton, AiDropPulse, AiShimmerImage } from '@/components/ui/ai';
import { AiImage } from '@/components/ui/AiBadge';
import { Badge } from '@/components/ui/Bits';
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
  /** A new suggestion is being prepared ("Başka öneri"). */
  refreshing: boolean;
};

/**
 * Bugünün kombini (06): "Senin üzerinde" image beside the piece thumbnails, missing-piece marker +
 * "Look'u tamamla", then "Bunu giyiyorum" with refresh (another suggestion) and heart (lookbook).
 * While another suggestion is prepared the card uses the AI loading language, never a spinner.
 */
export function TodayLookCard({ look, onWear, onRefresh, onToggleFavorite, refreshing }: Props) {
  const { t } = useTranslation();
  const hasMissing = look.pieces.some((p) => p.source === 'store');
  return (
    <View className="gap-4 rounded-card border border-line bg-paper p-4">
      <View className="flex-row gap-2">
        {refreshing ? (
          <AiShimmerImage className="aspect-[4/5] flex-[2] rounded-image-lg" accessibilityLabel={t('todayHome.refreshing')}>
            <AiDropPulse height={30} hookTone="sand" />
          </AiShimmerImage>
        ) : (
          <AiImage
            kind="onYou"
            uri={look.tryOnImageUrl}
            className="aspect-[4/5] flex-[2]"
            accessibilityLabel={t('todayHome.lookImageA11y', { name: look.name })}
          />
        )}
        <View className="flex-1 gap-2">
          {look.pieces.slice(0, 4).map((p) => {
            const missing = p.source === 'store';
            return (
              <View key={p.id} className="flex-1">
                <PlaceholderImage
                  uri={p.imageUrl}
                  accessibilityLabel={missing ? t('todayHome.pieceMissingA11y', { name: p.name }) : p.name}
                  className={`h-full w-full rounded-image ${missing ? 'border border-dashed border-accent' : ''}`}
                />
                {missing ? (
                  <View className="absolute bottom-1 left-1 right-1 rounded-pill bg-accent px-1.5 py-0.5" pointerEvents="none">
                    <Text variant="brand" tone="paper" numberOfLines={1} className="text-center" maxFontSizeMultiplier={1.2}>
                      {t('todayHome.missingPieceTag')}
                    </Text>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>

      <View className="flex-row items-end gap-3">
        <View className="flex-1 gap-1.5">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text variant="eyebrow">{t('today.lookEyebrow')}</Text>
            <Badge label={t(`occasion.${look.occasion}`)} />
          </View>
          <Text variant="h3" numberOfLines={2}>
            {look.name}
          </Text>
        </View>
        {hasMissing ? (
          <Pressable
            onPress={() => router.push({ pathname: '/shop/builder', params: { lookId: look.id } })}
            accessibilityRole="link"
            accessibilityLabel={t('today.completeLook')}
            hitSlop={8}
            className="min-h-icon-btn flex-row items-center gap-0.5 active:opacity-70"
          >
            <Text variant="caption" tone="accent">
              {t('today.completeLook')}
            </Text>
            <Icon icon={ChevronRight} size={14} tone="accent" />
          </Pressable>
        ) : null}
      </View>

      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          {refreshing ? (
            <AiBusyButton label={t('todayHome.refreshing')} />
          ) : look.wornToday ? (
            <View
              className="h-btn-primary flex-row items-center justify-center gap-2 rounded-pill bg-sand px-4"
              accessibilityLiveRegion="polite"
              accessible
              accessibilityLabel={t('today.worn')}
            >
              <Icon icon={Check} tone="accent" size={18} />
              <Text variant="button" numberOfLines={1} className="shrink">
                {t('today.worn')}
              </Text>
            </View>
          ) : (
            <Button label={t('today.wearThis')} icon={Check} onPress={onWear} />
          )}
        </View>
        <IconButton icon={RefreshCw} onPress={onRefresh} disabled={refreshing} accessibilityLabel={t('a11y.refreshLook')} />
        <IconButton
          icon={Heart}
          active={look.isFavorite}
          onPress={onToggleFavorite}
          accessibilityLabel={t(look.isFavorite ? 'a11y.unfavorite' : 'a11y.favorite')}
        />
      </View>
    </View>
  );
}
