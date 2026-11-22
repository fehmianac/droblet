import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ChevronRight, MirrorRound } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { AppSegment } from '@/api/contracts';
import { photoImageSource } from '@/api/imageSources';
import { SILHOUETTE_HEAD, SILHOUETTE_VIEWBOX, silhouetteBodyPath } from '@/components/brand/logoPaths';
import { ImageTag } from '@/components/ui/Bits';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useMyPhotos } from '@/features/account/queries';
import type { Requirements } from '@/features/requirements/logic';
import { useSegment } from '@/features/segment/store';
import { useTeenRules } from '@/features/teen/store';
import { visualTones } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

import { TRY_ON_CREDIT_COST } from './api';

export type TryOnInviteKind = 'photo' | 'member' | 'ready';

/**
 * What a tap on the invitation leads to: a missing photo first, then membership, otherwise the try-on and its cost.
 * A consent or credit step is not named here (the tap opens the requirements flow either way).
 */
export function tryOnInviteKind(req: Pick<Requirements, 'ready' | 'hint'>): TryOnInviteKind {
  const missing = req.ready ? null : req.hint;
  if (missing === 'bodyPhoto' || missing === 'facePhoto' || missing === 'bodyType') return 'photo';
  if (missing === 'premium') return 'member';
  return 'ready';
}

/** The invitation's footer for `req`: "Üzerimde gör · 1 kredi" / "Önce fotoğrafını ekle" / "Üyelikle açılır". */
export function useTryOnInviteFooter(req: Pick<Requirements, 'ready' | 'hint'>): { footer: string; ready: boolean } {
  const { t } = useTranslation();
  const kind = tryOnInviteKind(req);
  const footer =
    kind === 'photo'
      ? t('lookDetail.heroAddPhoto')
      : kind === 'member'
        ? t('lookDetail.heroMember')
        : `${t('lookEditor.tryOn')} · ${t('ai.creditCost', { count: TRY_ON_CREDIT_COST })}`;
  return { footer, ready: kind === 'ready' };
}

/**
 * The bundled "on you" sample per segment (Görseller v3): a fictional AI person wearing a look, always shown with the
 * "ÖRNEK" tag. No segment yet = women. Never drawn for a teen account.
 */
export const TRY_ON_EXAMPLE_PHOTOS: Record<AppSegment, number> = {
  women: require('../../../assets/visuals/tryon-example-woman.webp'),
  men: require('../../../assets/visuals/tryon-example-man.webp'),
};

/** Both photos sit at `object-position: 50% 10%` on the boards (the face stays in a short or narrow tile). */
const PHOTO_POSITION = { left: '50%', top: '10%' } as const;
/** Canvas `blur(3px)` on the user's own photo. */
const OWN_PHOTO_BLUR = 3;

/** The sample photo of the segment with "ÖRNEK" top-left (canvas 06 / 14b "fotoğraf yok", "üyelik yok"). */
function SampleLayer({ testID }: { testID: string }) {
  const { t } = useTranslation();
  const segment = useSegment();
  return (
    <>
      <Image
        source={TRY_ON_EXAMPLE_PHOTOS[segment]}
        contentFit="cover"
        contentPosition={PHOTO_POSITION}
        style={StyleSheet.absoluteFill}
        accessible={false}
        testID={`${testID}-sample-${segment}`}
      />
      <InkGradient />
      <ImageTag label={t('lookDetail.heroExample')} className="absolute left-2 top-2" />
    </>
  );
}

/** Bottom ink gradient under the title: clear down to 38%, then to 72% ink at the bottom edge. */
function InkGradient() {
  return <LinearGradient colors={[visualTones.inkClear, visualTones.badge]} locations={[0.38, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />;
}

/**
 * The ready state ("Üzerimde gör · 1 kredi"): the user's own active body photo — the private signed source and cache
 * key of the photo list — blurred and washed with a sand veil, without a tag. No photo in the list or a photo that
 * does not load: the sample. While the list is still unknown only the sand ground shows (never a flash of the sample).
 */
function OwnPhotoLayer({ testID }: { testID: string }) {
  const photos = useMyPhotos();
  const source = photoImageSource(photos.data?.body[0]);
  const [failedUri, setFailedUri] = useState<string | null>(null);
  const refreshed = useRef(false);
  if (photos.isPending) return null;
  if (!source.uri || failedUri === source.uri) return <SampleLayer testID={testID} />;
  const uri = source.uri;
  return (
    <>
      <Image
        source={source.cacheKey ? { uri, cacheKey: source.cacheKey } : { uri }}
        recyclingKey={source.cacheKey ?? uri}
        contentFit="cover"
        contentPosition={PHOTO_POSITION}
        blurRadius={OWN_PHOTO_BLUR}
        cachePolicy="memory-disk"
        transition={200}
        style={StyleSheet.absoluteFill}
        accessible={false}
        onError={() => {
          setFailedUri(uri);
          // An expired signed URL: ask for the photo list once; a fresh URL replaces the sample.
          if (!refreshed.current) {
            refreshed.current = true;
            void Promise.resolve().then(source.onExpired).catch(() => undefined);
          }
        }}
        testID={`${testID}-own-photo`}
      />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: visualTones.sandVeil }]} pointerEvents="none" />
      <InkGradient />
    </>
  );
}

/** Dashed standing figure of the teen invitation (canvas 14b before the photos): the brand silhouette, outline in the accent. */
function InviteFigure({ height }: { height: number }) {
  const colors = useThemeColors();
  const segment = useSegment();
  return (
    <Svg width={(height * 78) / 130} height={height} viewBox={SILHOUETTE_VIEWBOX} accessible={false} testID={`try-on-invite-figure-${segment}`}>
      <Circle {...SILHOUETTE_HEAD} fill={colors.ink} opacity={0.1} />
      <Path d={silhouetteBodyPath(segment)} fill={colors.ink} opacity={0.1} />
      <Path d={silhouetteBodyPath(segment)} fill="none" stroke={colors.accent} strokeWidth={1} strokeDasharray="3 2.4" strokeLinejoin="round" />
      <Circle {...SILHOUETTE_HEAD} fill="none" stroke={colors.accent} strokeWidth={1} strokeDasharray="3 2.4" />
    </Svg>
  );
}

export type TryOnInviteProps = {
  /** "Üzerimde gör · 1 kredi", "Önce fotoğrafını ekle", "Üyelikle açılır". */
  footer: string;
  /** Ready: the mirror icon before the footer; otherwise a chevron after it. */
  ready: boolean;
  onPress: () => void;
  disabled?: boolean;
  /** Size, flex and radius of the tile. */
  className?: string;
  /** Height of the teen figure (130 on 06 / 14b / 17; smaller where the hero is shorter, 08 — also the tighter top padding). */
  figureHeight?: number;
  testID?: string;
};

/**
 * The "senin üzerinde" area without a generated image (canvas 06, 08, 14b, 17 and the pattern board): one opaque tile
 * that is the button — a full-bleed photo under a bottom ink gradient, "Bu look senin üzerinde nasıl durur?" in cream
 * and a footer that says what a tap does. Ready: the user's own body photo, blurred and veiled; otherwise the
 * segment's sample photo tagged "ÖRNEK". A teen account keeps the dashed figure (no adult sample photo, no own photo).
 * Never a piece collage with a call to action laid over it.
 */
export function TryOnInvite({ footer, ready, onPress, disabled = false, className, figureHeight = 130, testID = 'try-on-invite' }: TryOnInviteProps) {
  const { t } = useTranslation();
  const teen = useTeenRules().isTeen;
  const compact = figureHeight < 110;
  const pill = (
    <View className={`h-8 flex-row items-center gap-[5px] rounded-pill bg-paper px-3 ${teen ? 'mt-auto' : 'mt-2.5'}`}>
      {ready ? <Icon icon={MirrorRound} size={13} tone="accent" /> : null}
      <Text variant="caption" tone="accent" numberOfLines={1} className="shrink font-sans-medium" testID={`${testID}-footer`}>
        {footer}
      </Text>
      {ready ? null : <Icon icon={ChevronRight} size={13} tone="accent" />}
    </View>
  );
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t('lookDetail.heroInviteA11y', { detail: footer })}
      accessibilityState={{ disabled }}
      className={`min-h-icon-btn items-center overflow-hidden bg-sand px-4 pb-3.5 active:opacity-80 ${compact ? 'pt-3.5' : 'pt-[18px]'} ${disabled ? 'opacity-60' : ''} ${className ?? ''}`}
      testID={testID}
    >
      {teen ? (
        <>
          <InviteFigure height={figureHeight} />
          <Text variant="h3" className={`text-center ${compact ? 'mt-2' : 'mt-2.5'}`}>
            {t('lookDetail.heroInvite')}
          </Text>
        </>
      ) : (
        <>
          {ready ? <OwnPhotoLayer testID={testID} /> : <SampleLayer testID={testID} />}
          <Text variant="h3" tone="cream" className="mt-auto text-center text-[19px] leading-[21px]">
            {t('lookDetail.heroInvite')}
          </Text>
        </>
      )}
      {pill}
    </Pressable>
  );
}
