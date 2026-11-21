import { ChevronRight, MirrorRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { SILHOUETTE_HEAD, SILHOUETTE_VIEWBOX, silhouetteBodyPath } from '@/components/brand/logoPaths';
import { useSegment } from '@/features/segment/store';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import type { Requirements } from '@/features/requirements/logic';
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

/** Dashed standing figure of the invitation (canvas 14b): the brand silhouette, outline in the accent. */
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
  /** Height of the figure (130 on 06 / 14b / 17; smaller where the hero is shorter, 08). */
  figureHeight?: number;
  testID?: string;
};

/**
 * The "senin üzerinde" area without a generated image (canvas 06, 08, 14b, 17 and the pattern board): one opaque tile
 * that is the button — the dashed figure, "Bu look senin üzerinde nasıl durur?" and a footer that says what a tap
 * does. Never a piece collage with a call to action laid over it.
 */
export function TryOnInvite({ footer, ready, onPress, disabled = false, className, figureHeight = 130, testID = 'try-on-invite' }: TryOnInviteProps) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={t('lookDetail.heroInviteA11y', { detail: footer })}
      accessibilityState={{ disabled }}
      className={`min-h-icon-btn items-center bg-sand px-4 pb-3.5 active:opacity-80 ${figureHeight < 110 ? 'pt-3.5' : 'pt-[18px]'} ${disabled ? 'opacity-60' : ''} ${className ?? ''}`}
      testID={testID}
    >
      <InviteFigure height={figureHeight} />
      <Text variant="h3" className={`text-center ${figureHeight < 110 ? 'mt-2' : 'mt-2.5'}`}>
        {t('lookDetail.heroInvite')}
      </Text>
      <View className="mt-auto h-8 flex-row items-center gap-[5px] rounded-pill bg-paper px-3">
        {ready ? <Icon icon={MirrorRound} size={13} tone="accent" /> : null}
        <Text variant="caption" tone="accent" numberOfLines={1} className="shrink font-sans-medium" testID={`${testID}-footer`}>
          {footer}
        </Text>
        {ready ? null : <Icon icon={ChevronRight} size={13} tone="accent" />}
      </View>
    </Pressable>
  );
}
