import { router } from 'expo-router';
import { Check, ChevronRight, Heart, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { TodayLook } from '@/api/contracts';
import { AiBusyButton, AiDropPulse, AiShimmerImage } from '@/components/ui/ai';
import { MissingTag } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { PlaceholderImage } from '@/components/ui/PlaceholderImage';
import { Text } from '@/components/ui/Text';
import { currentLanguage } from '@/i18n';
import { toDisplayUpper } from '@/lib/upper';

import { todayThumbs } from './logic';
import { OnYouImage } from './OnYouImage';

type Props = {
  look: TodayLook;
  onWear: () => void;
  onRefresh: () => void;
  onToggleFavorite: () => void;
  /** A new suggestion is being prepared ("Başka öneri"). */
  refreshing: boolean;
};

/**
 * Bugünün kombini (06), as drawn: the "SENİN ÜZERİNDE" image flush with the card's left edge, three piece
 * thumbnails beside it (the missing one dashed, with "EKSİK PARÇA"), then "BUGÜNÜN KOMBİNİ · OFİS" + the name
 * with "Look'u tamamla", and "Bunu giyiyorum" with refresh (another suggestion) and heart (lookbook).
 * While another suggestion is prepared the card uses the AI loading language, never a spinner.
 */
export function TodayLookCard({ look, onWear, onRefresh, onToggleFavorite, refreshing }: Props) {
  const { t } = useTranslation();
  const hasMissing = look.pieces.some((p) => p.source === 'store');
  const eyebrow = toDisplayUpper(t('todayHome.lookEyebrow', { occasion: t(`occasion.${look.occasion}`) }), currentLanguage());
  return (
    <View className="overflow-hidden rounded-card border border-line bg-paper">
      <View className="h-[264px] flex-row">
        {refreshing ? (
          <AiShimmerImage className="flex-[23]" accessibilityLabel={t('todayHome.refreshing')}>
            <AiDropPulse height={30} hookTone="sand" />
          </AiShimmerImage>
        ) : (
          <OnYouImage
            uri={look.tryOnImageUrl}
            className="flex-[23]"
            silhouetteHeight={168}
            accessibilityLabel={t('todayHome.lookImageA11y', { name: look.name })}
          />
        )}
        <View className="flex-[12] gap-1 p-1">
          {todayThumbs(look.pieces).map((p) => {
            const missing = p.source === 'store';
            return (
              <View key={p.id} className="flex-1">
                <PlaceholderImage
                  uri={p.imageUrl}
                  accessibilityLabel={missing ? t('todayHome.pieceMissingA11y', { name: p.name }) : p.name}
                  className={`h-full w-full rounded-thumb ${missing ? 'border-[1.5px] border-dashed border-accent' : ''}`}
                />
                {missing ? <MissingTag className="absolute right-1.5 top-1.5" /> : null}
              </View>
            );
          })}
        </View>
      </View>

      <View className="gap-2.5 px-4 pb-3.5 pt-3">
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text variant="eyebrow" numberOfLines={1}>
              {eyebrow}
            </Text>
            <Text variant="h3" numberOfLines={2} className="text-[22px] leading-[25px]">
              {look.name}
            </Text>
          </View>
          {hasMissing ? (
            <Pressable
              onPress={() => router.push({ pathname: '/shop/builder', params: { lookId: look.id } })}
              accessibilityRole="link"
              accessibilityLabel={t('today.completeLook')}
              hitSlop={8}
              className="min-h-icon-btn flex-row items-center gap-1 active:opacity-70"
            >
              <Text variant="label" tone="accent">
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
                className="h-btn-secondary flex-row items-center justify-center gap-2 rounded-pill bg-sand px-4"
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
              <Button size="md" label={t('today.wearThis')} icon={Check} onPress={onWear} />
            )}
          </View>
          <IconButton icon={RefreshCw} iconSize={19} onPress={onRefresh} disabled={refreshing} accessibilityLabel={t('a11y.refreshLook')} />
          <IconButton
            icon={Heart}
            iconSize={19}
            active={look.isFavorite}
            onPress={onToggleFavorite}
            accessibilityLabel={t(look.isFavorite ? 'a11y.unfavorite' : 'a11y.favorite')}
          />
        </View>
      </View>
    </View>
  );
}
