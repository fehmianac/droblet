import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, MirrorRound, Sparkles } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { LookSlot } from '@/api/contracts/looks';
import type { TryOnResult, TryOnTarget } from '@/api/contracts/tryon';
import { cachedTryOnJobId } from '@/api/wire/tryon';
import { AiShimmerImage, AiSilhouetteTrace } from '@/components/ui/ai';
import { AiBadge } from '@/components/ui/AiBadge';
import { Badge, ImageTag, MissingTag } from '@/components/ui/Bits';
import { SILHOUETTE_BODY_PATH, SILHOUETTE_HEAD, SILHOUETTE_VIEWBOX } from '@/components/brand/logoPaths';
import { Icon } from '@/components/ui/Icon';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { Zoomable, type ViewerImage } from '@/components/ui/viewer';
import { existingTryOnQuery, useExistingTryOn, useTryOnJob } from '@/features/tryon/api';
import { useTryOnPhotoKey } from '@/features/tryon/photoKey';
import { tryOnRuns, useTryOnRun } from '@/features/tryon/runs';
import { useThemeColors } from '@/theme/useThemeColors';

import { SlotThumb, type ItemsById } from './LookCover';

export type LookTryOnState = 'image' | 'generating' | 'none';

export type LookTryOn = {
  state: LookTryOnState;
  /** The image on the current photo (state 'image'). */
  image: TryOnResult | null;
  /** Pseudo job id that opens that image on the try-on screen without a credit (13d). */
  cachedJobId: string | null;
};

/** Pure: what the hero shows from the run of this session and the existing-image check. */
export function decideLookTryOn(input: { generating: boolean; image: TryOnResult | null | undefined }): LookTryOn {
  if (input.generating) return { state: 'generating', image: null, cachedJobId: null };
  const image = input.image?.imageUrl ? input.image : null;
  return image ? { state: 'image', image, cachedJobId: cachedTryOnJobId(image.tryOnId) } : { state: 'none', image: null, cachedJobId: null };
}

/**
 * The look's try-on for 14b's hero: an image made on the CURRENT photo (existing-image check, stale-photo rule),
 * "generating" while a job started in this session for this look runs, otherwise none. A finished job's image
 * becomes the check's answer at once (no second request, no flash of the invitation).
 */
export function useLookTryOn(lookId: string | undefined, options: { enabled?: boolean } = {}): LookTryOn {
  const client = useQueryClient();
  const target: TryOnTarget | null = lookId ? { kind: 'look', id: lookId } : null;
  const photoKey = useTryOnPhotoKey();
  const existing = useExistingTryOn(target, options);
  const runJobId = useTryOnRun(target);
  const job = useTryOnJob(runJobId, { enabled: Boolean(runJobId) });
  const ended = Boolean(runJobId) && (job.isDone || job.isFailed || job.timedOut);

  useEffect(() => {
    if (!target || !runJobId || !ended) return;
    if (job.isDone && job.result) client.setQueryData(existingTryOnQuery(target, true, photoKey).queryKey, job.result);
    tryOnRuns.clear(target, runJobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per ended job
  }, [ended, runJobId]);

  return decideLookTryOn({ generating: Boolean(runJobId) && !ended, image: existing.data ?? (job.isDone ? job.result : null) });
}

/** The right column: every piece up to 4; with more, 3 + a "+N" tile (the piece rows below list them all). */
export function heroTiles(slots: LookSlot[]): { shown: LookSlot[]; more: number } {
  if (slots.length <= 4) return { shown: slots, more: 0 };
  return { shown: slots.slice(0, 3), more: slots.length - 3 };
}

/** Dashed standing figure of the invitation (canvas 14b): the brand silhouette, outline in the accent. */
function InviteFigure() {
  const colors = useThemeColors();
  return (
    <Svg width={78} height={130} viewBox={SILHOUETTE_VIEWBOX} accessible={false}>
      <Circle {...SILHOUETTE_HEAD} fill={colors.ink} opacity={0.1} />
      <Path d={SILHOUETTE_BODY_PATH} fill={colors.ink} opacity={0.1} />
      <Path d={SILHOUETTE_BODY_PATH} fill="none" stroke={colors.accent} strokeWidth={1} strokeDasharray="3 2.4" strokeLinejoin="round" />
      <Circle {...SILHOUETTE_HEAD} fill="none" stroke={colors.accent} strokeWidth={1} strokeDasharray="3 2.4" />
    </Svg>
  );
}

type InviteProps = {
  /** "Üzerimde gör · 1 kredi", "Önce fotoğrafını ekle", "Üyelikle açılır", or the requirements hint. */
  footer: string;
  /** Ready: the mirror icon before the footer; otherwise a chevron after it. */
  ready: boolean;
  onPress: () => void;
};

type Props = {
  name: string;
  slots: LookSlot[];
  itemsById: ItemsById;
  tryOn: LookTryOn;
  invite: InviteProps;
};

/**
 * 14b hero, in the layout of 06 "Bugünün kombini": the "senin üzerinde" area large on the left and the pieces
 * stacked on the right. Left: the try-on on the current photo, whole (2:3, contain) with "AI önizleme" and
 * "SENİN ÜZERİNDE" — tap → full-screen viewer (image + pieces); while generating, the AI loading language; without
 * an image, the invitation (figure, "Bu look senin üzerinde nasıl durur?", the cost or the missing step). Never a
 * collage beside tiles of the same pieces.
 */
export function LookHero({ name, slots, itemsById, tryOn, invite }: Props) {
  const { t } = useTranslation();
  const { shown, more } = heroTiles(slots);
  const viewerImages: ViewerImage[] = [
    ...(tryOn.image?.imageUrl ? [{ uri: tryOn.image.imageUrl, label: t('tryOn.imageA11yNamed', { name }), ai: { tag: t('aiBadge.onYou') } }] : []),
    ...slots.filter((s) => s.imageUrl && !s.deleted).map((s) => ({ uri: s.imageUrl ?? '', label: s.name, caption: s.name })),
  ];
  const viewerIndex = (uri: string | null | undefined) => (uri ? viewerImages.findIndex((img) => img.uri === uri) : -1);

  return (
    <View className="h-[266px] flex-row overflow-hidden rounded-card border border-line bg-paper" testID="look-hero">
      <View className="flex-[23]">
        {tryOn.state === 'image' && tryOn.image?.imageUrl ? (
          <Zoomable images={viewerImages} index={0} accessibilityLabel={t('tryOn.imageA11yNamed', { name })} className="h-full w-full" testID="look-hero-image">
            <ImageSlot uri={tryOn.image.imageUrl} fit="contain" className="h-full w-full bg-sand" accessibilityLabel={t('tryOn.imageA11yNamed', { name })} />
            <View className="absolute left-2 top-2" pointerEvents="none">
              <Badge tone="ink" icon={Sparkles} label={t('ai.previewBadge')} />
            </View>
            <View className="absolute bottom-2 left-2" pointerEvents="none">
              <AiBadge kind="onYou" />
            </View>
          </Zoomable>
        ) : tryOn.state === 'generating' ? (
          <AiShimmerImage className="h-full w-full" accessibilityLabel={t('lookDetail.heroPreparingA11y', { name })}>
            <View testID="look-hero-generating" className="items-center gap-2">
              <AiSilhouetteTrace height={150} />
              <Text variant="h3" className="text-center" accessibilityLiveRegion="polite">
                {t('lookDetail.heroPreparing')}
              </Text>
            </View>
            <View className="absolute left-2 top-2" pointerEvents="none">
              <Badge tone="ink" icon={Sparkles} label={t('ai.previewBadge')} />
            </View>
            <ImageTag label={t('ai.preparingTag')} className="absolute bottom-2 left-2" />
          </AiShimmerImage>
        ) : (
          <Pressable
            onPress={invite.onPress}
            accessibilityRole="button"
            accessibilityLabel={t('lookDetail.heroInviteA11y', { detail: invite.footer })}
            className="h-full w-full items-center bg-sand px-4 pb-3.5 pt-[18px] active:opacity-80"
            testID="look-hero-invite"
          >
            <InviteFigure />
            <Text variant="h3" className="mt-2.5 text-center">
              {t('lookDetail.heroInvite')}
            </Text>
            <View className="mt-auto h-8 flex-row items-center gap-[5px] rounded-pill bg-paper px-3">
              {invite.ready ? <Icon icon={MirrorRound} size={13} tone="accent" /> : null}
              <Text variant="caption" tone="accent" numberOfLines={1} className="font-sans-medium" testID="look-hero-invite-footer">
                {invite.footer}
              </Text>
              {invite.ready ? null : <Icon icon={ChevronRight} size={13} tone="accent" />}
            </View>
          </Pressable>
        )}
      </View>

      <View className="flex-[12] gap-1 p-1" accessible={false} importantForAccessibility="no-hide-descendants" testID="look-hero-pieces">
        {shown.map((slot) => {
          const store = slot.source === 'store';
          const index = viewerIndex(slot.imageUrl);
          return (
            <View key={slot.slot} className={`flex-1 overflow-hidden rounded-thumb ${store ? 'border-[1.5px] border-dashed border-accent' : ''}`}>
              <Zoomable images={viewerImages} index={index} disabled={index < 0} className="h-full w-full">
                <SlotThumb slot={slot} itemsById={itemsById} className="h-full w-full" glyphSize={28} />
              </Zoomable>
              {store ? <MissingTag short={shown.length > 3} className="absolute right-1.5 top-1.5" /> : null}
            </View>
          );
        })}
        {more > 0 ? (
          <View className="flex-1 items-center justify-center rounded-thumb bg-sand" testID="look-hero-more">
            <Text variant="bodyMedium">{t('lookDetail.heroMore', { count: more })}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
