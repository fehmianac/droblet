import { useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { LookSlot } from '@/api/contracts/looks';
import type { TryOnResult, TryOnTarget } from '@/api/contracts/tryon';
import { cachedTryOnJobId } from '@/api/wire/tryon';
import { AiShimmerImage, AiSilhouetteTrace } from '@/components/ui/ai';
import { AiBadge } from '@/components/ui/AiBadge';
import { Badge, ImageTag } from '@/components/ui/Bits';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Text } from '@/components/ui/Text';
import { Zoomable, type ViewerImage } from '@/components/ui/viewer';
import { existingTryOnQuery, useExistingTryOn, useTryOnJob } from '@/features/tryon/api';
import { useTryOnPhotoKey } from '@/features/tryon/photoKey';
import { tryOnRuns, useTryOnRun } from '@/features/tryon/runs';
import { TryOnInvite, type TryOnInviteProps } from '@/features/tryon/TryOnInvite';

import { heroTiles, HeroPieceColumn } from './HeroPieces';
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

export { heroTiles };

/** The "senin üzerinde" area while this look's image is generated (06, 14b): the AI loading language, never a spinner. */
export function HeroGenerating({ name, className, testID }: { name: string; className?: string; testID?: string }) {
  const { t } = useTranslation();
  return (
    <AiShimmerImage className={className} accessibilityLabel={t('lookDetail.heroPreparingA11y', { name })}>
      <View testID={testID} className="items-center gap-2">
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
  );
}

type InviteProps = Pick<TryOnInviteProps, 'footer' | 'ready' | 'onPress'>;

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
  const { shown, more } = heroTiles(slots, (s) => s.source === 'store');
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
          <HeroGenerating name={name} className="h-full w-full" testID="look-hero-generating" />
        ) : (
          <TryOnInvite {...invite} className="h-full w-full" testID="look-hero-invite" />
        )}
      </View>

      <HeroPieceColumn
        testID="look-hero-pieces"
        moreTestID="look-hero-more"
        more={more}
        pieces={shown.map((slot) => {
          const index = viewerIndex(slot.imageUrl);
          return {
            key: slot.slot,
            missing: slot.source === 'store',
            content: (
              <Zoomable images={viewerImages} index={index} disabled={index < 0} className="h-full w-full">
                <SlotThumb slot={slot} itemsById={itemsById} className="h-full w-full" glyphSize={28} />
              </Zoomable>
            ),
          };
        })}
      />
    </View>
  );
}
