import { router } from 'expo-router';
import { Check, ChevronRight, Heart, RefreshCw } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { itemImageSource, tryOnImageSource } from '@/api/imageSources';
import type { TodayLook } from '@/api/contracts';
import { AiBusyButton, AiDropPulse, AiShimmerImage } from '@/components/ui/ai';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { heroTiles, HeroPieceColumn } from '@/features/looks/HeroPieces';
import { HeroGenerating, useLookTryOn } from '@/features/looks/LookHero';
import { TryOnInvite } from '@/features/tryon/TryOnInvite';
import { useTryOnAction } from '@/features/tryon/useTryOnAction';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { toDisplayUpper } from '@/lib/upper';

import { OnYouImage } from './OnYouImage';
import { useTeenRules } from '@/features/teen/store';

type Props = {
  look: TodayLook;
  onWear: () => void;
  onRefresh: () => void;
  onToggleFavorite: () => void;
  /** A new suggestion is being prepared ("Başka öneri"). */
  refreshing: boolean;
};

/**
 * Bugünün kombini (06), as drawn — the same layout as 14b's hero in every state: the "senin üzerinde" area large on
 * the left and the pieces stacked on the right (up to 4, or 3 + "+N"; the missing one dashed, with "EKSİK PARÇA"),
 * then "BUGÜNÜN KOMBİNİ · OFİS" + the name with "Look'u tamamla", and "Bunu giyiyorum" with refresh (another
 * suggestion) and heart (lookbook).
 *
 * Left: the try-on image, whole (contain) with "SENİN ÜZERİNDE"; while this look's image or another suggestion is
 * prepared, the AI loading language (never a spinner); without an image, the invitation tile — the figure, "Bu look
 * senin üzerinde nasıl durur?" and what a tap does ("Üzerimde gör · 1 kredi" / "Önce fotoğrafını ekle" / "Üyelikle
 * açılır"). Never a piece collage with a call to action laid over it.
 */
export function TodayLookCard({ look, onWear, onRefresh, onToggleFavorite, refreshing }: Props) {
  const language = useAppLanguage();
  const { t } = useTranslation();
  const hasMissing = look.pieces.some((p) => p.source === 'store');
  const hideCommerce = useTeenRules().hide.commerce;
  // An image the plan already carries wins; otherwise the existing-image check and this session's run (14b's rules).
  const lookTryOn = useLookTryOn(look.id, { enabled: !look.tryOnImageUrl });
  // The run / check result carries its id: stable cache key `tryon:{id}` and a fresh URL once when it expired.
  const image = look.tryOnImageUrl ? { uri: look.tryOnImageUrl, cacheKey: null } : tryOnImageSource(lookTryOn.state === 'image' ? lookTryOn.image : null);
  const imageUrl = image.uri;
  const generating = !imageUrl && lookTryOn.state === 'generating';
  const action = useTryOnAction({ target: { kind: 'look', id: look.id }, title: look.name, feature: 'today_try_on', cachedJobId: lookTryOn.cachedJobId });
  const { shown, more } = heroTiles(look.pieces, (p) => p.source === 'store');
  const eyebrow = toDisplayUpper(t('todayHome.lookEyebrow', { occasion: t(`occasion.${look.occasion}`) }), language);
  return (
    <View className="overflow-hidden rounded-card border border-line bg-paper" testID="today-look-card">
      <View className="h-[264px] flex-row">
        <View className="flex-[23]">
          {refreshing ? (
            <AiShimmerImage className="h-full w-full" accessibilityLabel={t('todayHome.refreshing')}>
              <AiDropPulse height={30} />
            </AiShimmerImage>
          ) : imageUrl ? (
            <OnYouImage
              {...image}
              className="h-full w-full bg-sand"
              pieces={[]}
              seed={look.id}
              silhouetteHeight={168}
              accessibilityLabel={t('todayHome.lookImageA11y', { name: look.name })}
            />
          ) : generating ? (
            <HeroGenerating name={look.name} className="h-full w-full" testID="today-look-generating" />
          ) : (
            <TryOnInvite {...action.invite} className="h-full w-full" testID="today-look-invite" />
          )}
        </View>
        <HeroPieceColumn
          testID="today-look-pieces"
          readable
          more={more}
          pieces={shown.map((p) => {
            const missing = p.source === 'store';
            return {
              key: p.id,
              missing,
              content: (
                <ImageSlot
                  {...itemImageSource(p, 'thumb')}
                  placeholder={{ kind: 'garment', category: p.category, color: p.color, glyphSize: 28 }}
                  accessibilityLabel={missing ? t('todayHome.pieceMissingA11y', { name: p.name }) : p.name}
                  className="h-full w-full"
                />
              ),
            };
          })}
        />
      </View>
      {action.sheet}

      <View className="gap-2.5 px-4 pb-3.5 pt-3">
        {action.note ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite" testID="today-look-note">
            {action.note}
          </Text>
        ) : null}
        <View className="flex-row items-end justify-between gap-3">
          <View className="flex-1 gap-1">
            <Text variant="eyebrow" numberOfLines={1}>
              {eyebrow}
            </Text>
            <Text variant="h3" numberOfLines={2} className="text-[22px] leading-[25px]">
              {look.name}
            </Text>
          </View>
          {/* Canvas 18: a store link — not drawn for a teen. */}
          {hasMissing && !hideCommerce ? (
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
