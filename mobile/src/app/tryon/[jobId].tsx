import { useQueryClient } from '@tanstack/react-query';
import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Rect } from 'react-native-svg';

import { tryOnImageSource, viewerSourceOf } from '@/api/imageSources';
import type { TryOnTarget } from '@/api/contracts/tryon';
import { AiBackgroundAction, AiFailure } from '@/components/ui/ai';
import { Badge } from '@/components/ui/Bits';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Text } from '@/components/ui/Text';
import { showToast } from '@/components/ui/toast/store';
import { aiCreditsKey, useAiCredits } from '@/features/credits/useAiCredits';
import { PhotoRejected } from '@/features/requirements/PhotoRejected';
import { requirementsFlow } from '@/features/requirements/store';
import { isTryOnTargetKind, TRY_ON_CREDIT_COST, useStartTryOn, useTryOnJob } from '@/features/tryon/api';
import { TryOnResultImage } from '@/features/tryon/TryOnResultImage';
import { TryOnCurtain } from '@/features/tryon/TryOnCurtain';
import { tryOnPieces } from '@/features/tryon/pieces';
import { CachedTryOnNote, isCachedTryOnJob } from '@/features/tryon/cached';
import { useOutfitPhotoPicker } from '@/features/tryon/OutfitPhotoPicker';
import { PhotoResultActions, ReferenceRejected, referenceViewerImage, shareTryOnImage, SourcePhotoThumb } from '@/features/tryon/PhotoTryOnParts';
import { useStartItemDrafts } from '@/features/wardrobe/mutations';
import { isRecognitionLimitReached, openRecognitionPaywall } from '@/features/wardrobe/recognition';
import { Zoomable } from '@/components/ui/viewer';
import { useThemeColors } from '@/theme/useThemeColors';

/** "AI önizleme" on the stage: the ink badge at its 28-high size (`AiYukleniyor`). */
function StageBadge({ label }: { label: string }) {
  return (
    <View className="h-7 flex-row items-center gap-1 rounded-pill bg-ink px-2.5">
      <Icon icon={Sparkles} size={12} tone="cream" />
      <Text variant="badge" tone="cream" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** The credit glyph of the board (a 12 × 15 capsule, 1.5 stroke) in front of "1 kredi · kalan 11". */
function CreditGlyph({ color }: { color: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" accessible={false}>
      <Rect x={6} y={3} width={12} height={15} rx={6} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * "Üzerimde gör" — the full-screen wait of a try-on job (`AiYukleniyor`), its result and its failure.
 * Params: `jobId`; optional `title` (what is being tried on), `kind` + `id` (the target, so "Tekrar
 * dene" can start a fresh job). Leaving keeps the job running on the server; polling stops while
 * the screen is not focused.
 *
 * Outfit-photo try-on (`mode=photo`, 16e / 16f): `ref` = the outfit photo on the device (or its signed URL), `draftId`
 * when it came from "Parçaları seç". The result shows the "Kaynak fotoğraf" thumbnail and "Parçalara ayır ve gardıroba
 * ekle" + share; a refused outfit photo (`guardRejected` + referenceIssue) shows why and "Başka fotoğraf seç".
 */
export default function TryOnScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const client = useQueryClient();
  const params = useLocalSearchParams<{
    jobId: string;
    title?: string;
    kind?: string;
    id?: string;
    mode?: string;
    ref?: string;
    draftId?: string;
    uploadId?: string;
  }>();
  const focused = useIsFocused();
  const job = useTryOnJob(params.jobId, { enabled: focused });
  const credits = useAiCredits();
  const start = useStartTryOn();
  const title = params.title || null;
  const photoMode = params.mode === 'photo';
  // The hub's outfit photo can be picked again from here (the new 16d replaces this screen).
  const otherPhoto = useOutfitPhotoPicker({ replace: true });
  const startDrafts = useStartItemDrafts();
  const [sharing, setSharing] = useState(false);
  // Curtain wait (21e): the pieces this app started the job with. A result that arrives while the curtain is showing is
  // revealed by opening it before the result layout; a result that was already there (cache, reopened screen) opens at once.
  const pieces = useMemo(() => tryOnPieces.get(params.jobId), [params.jobId]);
  const [startedAt] = useState(() => Date.now());
  const [phase, setPhase] = useState<'unknown' | 'waiting' | 'revealing' | 'revealed'>('unknown');
  const settledNow = job.isDone || job.isFailed;
  if (phase === 'unknown') setPhase(settledNow ? 'revealed' : 'waiting');
  else if (phase === 'waiting' && job.isDone) setPhase('revealing');

  const settled = job.isDone || job.isFailed;
  useEffect(() => {
    if (settled) void client.invalidateQueries({ queryKey: aiCreditsKey });
  }, [client, settled]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  // The photo on the device (hub) can be sent to "Parçaları seç"; from 12 and an import the photo is already split there.
  // A local photo was uploaded for the try-on (`uploadId`): recognition starts on that same upload — never sent twice.
  const localRef = params.ref && !/^https?:/i.test(params.ref) ? params.ref : null;
  const split =
    params.draftId || params.kind === 'import-photo'
      ? close
      : localRef
        ? () =>
            void (params.uploadId ? startDrafts.startFromUpload(params.uploadId, localRef) : startDrafts.start([localRef]))
              .then(({ draftIds }) => {
                const draftId = draftIds[0];
                if (draftId) router.replace({ pathname: '/item/detect', params: { draftId, photo: localRef, since: String(Date.now()) } });
              })
              .catch((error: unknown) => {
                // Free recognitions used up: the paywall, as on 12.
                if (isRecognitionLimitReached(error)) openRecognitionPaywall();
                else showToast({ message: t('tryOnPhoto.splitFailed'), tone: 'error' });
              })
        : null;

  if (job.isFailed) {
    const target: TryOnTarget | null = isTryOnTargetKind(params.kind) && params.id ? { kind: params.kind, id: params.id } : null;
    const retry = () => {
      if (!target) {
        job.refetch();
        return;
      }
      void start
        .start(target)
        .then(({ jobId }) => router.replace({ pathname: '/tryon/[jobId]', params: { jobId, title: title ?? '', kind: target.kind, id: target.id } }))
        .catch(() => undefined);
    };
    // 16f: the outfit photo itself was refused (nobody / several people / no clothing / a minor) — pick another one.
    const reference = job.job?.error?.reference;
    if (photoMode && reference) {
      const fromHub = !params.draftId && params.kind !== 'import-photo';
      return (
        <Screen bottom={false}>
          <ScreenHeader title={t('screens.tryon')} leading="close" onLeadingPress={close} />
          <ReferenceRejected issue={reference} photoUri={params.ref || null} onOtherPhoto={fromHub ? otherPhoto.open : close} onClose={close} />
          {otherPhoto.sheet}
        </Screen>
      );
    }
    // The server refused the photo (canvas 11 "Fotoğraf uygun değil"): tips, then back to the photo step.
    const photo = job.job?.error?.photo;
    if (job.job?.error?.code === 'photo_unsuitable' && photo) {
      return (
        <Screen bottom={false}>
          <ScreenHeader title={t('screens.tryon')} leading="close" onLeadingPress={close} />
          <PhotoRejected photo={photo} onRetry={retry} />
        </Screen>
      );
    }
    // The wait stops where it was: the stage stands still and its text area says what happened (canvas note, 60 s).
    return (
      <Screen top={false} bottom>
        <View>
          <TryOnCurtain className="h-[470px] w-full" pieces={pieces} startedAt={startedAt} stopped />
          <View className="absolute left-gutter right-gutter flex-row items-center justify-between" style={{ top: insets.top + 6 }}>
            <IconButton icon={ChevronLeft} variant="inverse" onPress={close} accessibilityLabel={t('a11y.back')} />
          </View>
        </View>
        <View className="flex-1 gap-3.5 px-6 pt-[22px]">
          <Text variant="eyebrow">{t('ai.tryOnEyebrow')}</Text>
          <AiFailure layout="inline" creditRefunded={job.creditRefunded} onRetry={retry} retrying={start.isStarting} />
        </View>
      </Screen>
    );
  }

  if (job.isDone && phase !== 'revealed') return renderWait(true);

  if (job.isDone) {
    const remaining = job.result?.creditsRemaining ?? credits.remaining;
    const imageLabel = title ? t('tryOn.imageA11yNamed', { name: title }) : t('tryOn.imageA11y');
    const imageTag = job.result?.source === 'face' ? t('req.tryOnFace.tag') : t('aiBadge.onYou');
    const imageUrl = job.result?.imageUrl ?? null;
    // Same cache key (`tryon:{id}`) as the image on the screen; a fresh URL once if the presigned one expired.
    const viewer = viewerSourceOf(tryOnImageSource(job.result));
    const tryOnId = job.result?.tryOnId ?? null;
    const referenceUri = photoMode ? (job.result?.referenceUrl ?? params.ref ?? null) || null : null;
    const reference = referenceViewerImage(tryOnId, referenceUri, t('tryOnPhoto.sourceThumb'));
    const images = [...(viewer ? [{ ...viewer, label: imageLabel, ai: { tag: imageTag } }] : []), ...(reference ? [reference] : [])];
    const heading = photoMode ? t('tryOnPhoto.resultTitle') : title ? t('tryOn.readyTitleNamed', { name: title }) : t('tryOn.readyTitle');
    const share =
      photoMode && imageUrl && tryOnId
        ? () => {
            setSharing(true);
            shareTryOnImage(imageUrl, tryOnId, t('tryOnPhoto.shareMessage'))
              .catch(() => showToast({ message: t('tryOnPhoto.shareFailed'), tone: 'error' }))
              .finally(() => setSharing(false));
          }
        : null;
    return (
      <Screen bottom={!photoMode}>
        <ScreenHeader title={t('screens.tryon')} leading="close" onLeadingPress={close} />
        <ScrollView contentContainerClassName="gap-4 px-gutter pb-4">
          <View>
          <Zoomable
            images={images}
            disabled={!imageUrl}
            accessibilityLabel={imageLabel}
            testID="tryon.zoom"
          >
            <TryOnResultImage
              tryOnId={job.result?.tryOnId ?? null}
              url={job.result?.imageUrl ?? null}
              className="aspect-[2/3] w-full"
              accessibilityLabel={imageLabel}
              tagLabel={job.result?.source === 'face' ? t('req.tryOnFace.tag') : undefined}
            />
            {job.result?.imageUrl ? (
              <View className="absolute left-2.5 top-2.5" pointerEvents="none">
                <Badge tone="ink" icon={Sparkles} label={t('ai.previewBadge')} />
              </View>
            ) : null}
          </Zoomable>
          {reference && referenceUri ? <SourcePhotoThumb images={images} index={images.length - 1} uri={referenceUri} /> : null}
          </View>
          <View className="gap-1.5" accessibilityLiveRegion="polite">
            <Text variant="eyebrow">{t('tryOn.readyEyebrow')}</Text>
            <Text variant="h2">{heading}</Text>
            <Text variant="body" tone="muted">
              {t('tryOn.readyBody')}
            </Text>
            {job.result?.source === 'face' ? (
              <View className="gap-1.5" testID="tryon.faceNote">
                <View className="flex-row items-center gap-1.5">
                  <Icon icon={Sparkles} size={14} tone="accent" />
                  <Text variant="caption" className="flex-1">
                    {t('req.tryOnFace.note')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => requirementsFlow.open({ action: 'tryOn', start: 'steps', path: 'body' })}
                  accessibilityRole="button"
                  testID="tryon.addBodyPhoto"
                  className="min-h-11 flex-row items-center gap-2 rounded-field border border-line bg-paper px-3 active:opacity-70"
                >
                  <Icon icon={Camera} size={16} />
                  <Text variant="bodyMedium" className="flex-1">
                    {t('req.tryOnFace.addBodyPhoto')}
                  </Text>
                  <Icon icon={ChevronRight} size={16} tone="muted" />
                </Pressable>
              </View>
            ) : null}
            {isCachedTryOnJob(params.jobId) ? (
              // 13d: nothing was generated and nothing charged — said instead of the balance.
              <CachedTryOnNote />
            ) : remaining !== null && remaining !== undefined ? (
              <Text variant="caption" tone="muted">
                {t('tryOn.remaining', { count: remaining })}
              </Text>
            ) : null}
          </View>
        </ScrollView>
        {photoMode ? (
          <PhotoResultActions onSplit={split} splitting={startDrafts.isPending} onShare={share} sharing={sharing} onDone={close} />
        ) : (
          <View className="px-gutter pb-4">
            <Button label={t('tryOn.done')} onPress={close} />
          </View>
        )}
      </Screen>
    );
  }

  return renderWait(false);

  function renderWait(reveal: boolean) {
    const cost = TRY_ON_CREDIT_COST;
    const revealImage = reveal ? (
      <TryOnResultImage
        tryOnId={job.result?.tryOnId ?? null}
        url={job.result?.imageUrl ?? null}
        className="h-full w-full"
        accessibilityLabel={title ? t('tryOn.imageA11yNamed', { name: title }) : t('tryOn.imageA11y')}
      />
    ) : null;
    return (
      <Screen top={false} bottom>
        <View>
          <TryOnCurtain
            className="h-[470px] w-full"
            pieces={pieces}
            startedAt={startedAt}
            reveal={reveal}
            revealImage={revealImage}
            onRevealed={() => setPhase('revealed')}
          />
          <View className="absolute left-gutter right-gutter flex-row items-center justify-between" style={{ top: insets.top + 6 }}>
            <IconButton icon={ChevronLeft} variant="inverse" onPress={close} accessibilityLabel={t('a11y.back')} />
            <StageBadge label={t('ai.previewBadge')} />
          </View>
        </View>
        <View className="flex-1 gap-3.5 px-6 pt-[22px]">
          <Text variant="eyebrow">{t('ai.tryOnEyebrow')}</Text>
          <Text variant="h3" numberOfLines={2}>
            {title ? t('ai.tryOnCurtain.heading', { name: title }) : t('ai.tryOnCurtain.headingFallback')}
          </Text>
          <Text variant="body" tone="muted">
            {t('ai.tryOnCurtain.body')}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <CreditGlyph color={colors.muted} />
            <Text variant="caption" tone="muted" className="flex-1">
              {credits.remaining !== null
                ? t('tryOn.creditLine', { count: cost, remaining: credits.remaining })
                : t('tryOn.creditCostOnly', { count: cost })}
            </Text>
          </View>
        </View>
        <View className="px-6 pb-4">
          <AiBackgroundAction onPress={close} />
        </View>
      </Screen>
    );
  }
}
