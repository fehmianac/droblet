import { Check, CircleAlert, ImageOff, Pencil, ScanSearch } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import type { ItemDraft } from '@/api/contracts/wardrobe';
import { AiProgressBar, brandEasing } from '@/components/ui/ai';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { motion } from '@/theme/tokens';

import { BOX_STAGGER_MS, DETECT_STAGES, detectProgress, detectStageIndex, isLowConfidence } from './detect';
import { DetectPhoto, type PhotoPiece } from './DetectPhoto';
import { CautionBadge } from './ItemForm';
import { ItemThumb } from './ItemThumb';

/** What the screen shows under the photo: the wait, the choice, or why there is nothing to choose. */
export type DetectPhase = 'loading' | 'choose' | 'empty' | 'failed';

type Props = {
  /** Default `choose`. The photo stays in place across phases; only what is under it changes. */
  phase?: DetectPhase;
  /** The group photo (the boxes are drawn on it) and its pixel size. */
  photoUrl: string | null;
  photoSize: { width: number; height: number } | null;
  /** When the photo was sent (ms since epoch): the stage sentences follow it. Default: when the screen opened. */
  since?: number;
  /** Opened from 12 right after its scan: the boxes appear one by one even if the result was already in. */
  continued?: boolean;
  /** The detected pieces, by their number. */
  pieces: ItemDraft[];
  selection: Set<string>;
  /** Pieces the user already edited in 12c. */
  edited: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: (all: boolean) => void;
  onEdit: (id: string) => void;
  onAdd: () => void;
  onDiscard: () => void;
  adding: boolean;
  notice: string | null;
  /** Nothing found / failed: "Tekrar dene" and "Elle gir". */
  onRetry?: () => void;
  onManual?: () => void;
  retrying?: boolean;
  /** Offline: retry needs a connection. */
  retryDisabled?: boolean;
};

function pieceName(piece: ItemDraft, fallback: string): string {
  return piece.suggestion?.name?.trim() || fallback;
}

function PieceRow({
  piece,
  checked,
  edited,
  onToggle,
  onEdit,
}: {
  piece: ItemDraft;
  checked: boolean;
  edited: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const s = piece.suggestion;
  const name = pieceName(piece, t('itemDetect.pieceFallback', { n: piece.index ?? 0 }));
  const meta = [s?.subcategory || (s?.category ? t(`itemCategory.${s.category}`) : null), s?.color ? t(`itemColor.${s.color}`) : null]
    .filter(Boolean)
    .join(' · ');
  const low = isLowConfidence(piece);
  return (
    <View className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5" testID={`detect-piece-${piece.index ?? 0}`}>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('itemDetect.editA11y', { name })}
        accessibilityHint={low ? t('itemDetect.checkHint') : undefined}
        className="min-h-icon-btn flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <View>
          <ItemThumb
            category={s?.category ?? 'accessory'}
            color={s?.color ?? 'other'}
            uri={piece.imageUrl}
            className="h-[62px] w-[52px] rounded-thumb"
            glyphSize={28}
          />
          <View className="absolute -left-1 -top-1 h-5 min-w-5 items-center justify-center rounded-[5px] bg-ink px-1">
            <Text variant="caption" tone="cream" className="text-[11px]">
              {piece.index}
            </Text>
          </View>
        </View>
        <View className="flex-1 gap-0.5">
          <Text variant="bodyMedium" numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <View className="flex-row flex-wrap gap-1.5 pt-1">
            {low && !edited ? <CautionBadge label={t('itemDetect.check')} /> : null}
            {edited ? (
              <View className="flex-row items-center gap-1">
                <Icon icon={Pencil} size={12} tone="muted" />
                <Text variant="caption" tone="muted">
                  {t('itemDetect.edited')}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityLabel={t('itemDetect.checkboxA11y', { name })}
        accessibilityState={{ checked }}
        hitSlop={10}
        className="h-icon-btn w-8 items-center justify-center"
        testID={`detect-check-${piece.index ?? 0}`}
      >
        <View className={`h-[22px] w-[22px] items-center justify-center rounded-[5px] border ${checked ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
          {checked ? <Icon icon={Check} size={15} tone="cream" /> : null}
        </View>
      </Pressable>
    </View>
  );
}

/** The short name on a box chip: "N · " + the sub-type ("Gömlek"), else the category, else "Parça N". */
function useChipLabel() {
  const { t } = useTranslation();
  return (piece: ItemDraft) => {
    const s = piece.suggestion;
    const kind = s?.subcategory?.trim() || (s?.category ? t(`itemCategory.${s.category}`) : '') || t('itemDetect.pieceFallback', { n: piece.index ?? 0 });
    return `${piece.index ?? 0} · ${kind}`;
  };
}

/** Re-renders twice a second while `active`, returning the time since `since`. */
function useElapsed(since: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [active]);
  return Math.max(0, now - since);
}

/** One stage sentence at a time, fading in with a 4 pt rise when it changes (instantly with reduce-motion). */
function StageLine({ text, reduceMotion }: { text: string; reduceMotion: boolean }) {
  const v = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      v.set(1);
      return;
    }
    v.set(0);
    v.set(withTiming(1, { duration: motion.stageFadeMs, easing: brandEasing }));
  }, [reduceMotion, text, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 4 }] }));
  return (
    <View accessible accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={text} className="min-h-[30px] justify-center" testID="detect-stage">
      <Animated.View style={style}>
        <Text variant="h3" accessibilityRole="none" numberOfLines={2}>
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

/** "Üst ve altlar aranıyor…" → … → "Neredeyse hazır…", the bar easing toward 90 % (100 % when `done`). */
function DetectWait({ since, done, reduceMotion }: { since: number; done: boolean; reduceMotion: boolean }) {
  const { t } = useTranslation();
  const elapsed = useElapsed(since, !done);
  const stage = done ? DETECT_STAGES.length - 1 : detectStageIndex(elapsed);
  return (
    <View className="gap-3" testID="detect-processing">
      <StageLine text={t(`itemDetect.${DETECT_STAGES[stage] ?? 'stageAlmost'}`)} reduceMotion={reduceMotion} />
      <AiProgressBar progress={detectProgress(elapsed, done)} accessibilityLabel={t('itemDetect.progressA11y')} />
      <Text variant="body" tone="muted">
        {t('itemDetect.analysingBody')}
      </Text>
    </View>
  );
}

/** The choice sliding up under the photo once the boxes are in (static with reduce-motion or when opened ready). */
function SlideUp({ animate, delayMs, children }: { animate: boolean; delayMs: number; children: ReactNode }) {
  const v = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    v.set(animate ? withDelay(delayMs, withTiming(1, { duration: motion.listUpMs, easing: brandEasing })) : 1);
  }, [animate, delayMs, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 28 }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * Parçaları seç (canvas 15: `ParcaSecAraniyor`, `ParcaSecBeliriyor`, `ParcaSecSecim`, `ParcaSecBulunamadi`,
 * `ParcaSecHata`). One layout for the whole life of the photo, so nothing jumps:
 * - loading: the user's photo with the scan line of 12, the stage sentence and the thin bar under it;
 * - result: the line fades, the bar completes, every piece's box fades/scales in 120 ms apart with its
 *   "N · tür" chip, then "Fotoğrafta N parça bulduk" and the rows slide up. Rows: plain crop, name,
 *   category · colour, "Kontrol et" when the AI was unsure, and a checkbox; doubtful pieces start
 *   unticked; "Tümünü seç / Hiçbirini" flips all; a row opens 12c;
 * - nothing found / failed: the photo stays with a status tag, the reason, "Tekrar dene" and "Elle gir".
 * Reduce-motion: no sweep, no stagger, no slide; the stage sentence still changes.
 */
export function DetectChooser({
  phase = 'choose',
  photoUrl,
  photoSize,
  since,
  continued = false,
  pieces,
  selection,
  edited,
  onToggle,
  onSelectAll,
  onEdit,
  onAdd,
  onDiscard,
  adding,
  notice,
  onRetry,
  onManual,
  retrying = false,
  retryDisabled = false,
}: Props) {
  const { t } = useTranslation();
  const chipLabel = useChipLabel();
  const reduceMotion = useReduceMotion();
  const [openedAt] = useState(() => Date.now());
  const waitSince = since ?? openedAt;
  const [loadedAspect, setLoadedAspect] = useState<number | null>(null);
  const aspect = photoSize ? photoSize.width / photoSize.height : (loadedAspect ?? 3 / 4);

  // The result is animated only when the user watched the wait on this screen.
  const [watched, setWatched] = useState(phase === 'loading' || continued);
  if (phase === 'loading' && !watched) setWatched(true);
  const animate = watched && !reduceMotion;

  // After the wait: the bar completes for a moment before the choice slides in.
  const [finishing, setFinishing] = useState(false);
  const [previous, setPrevious] = useState(phase);
  if (previous !== phase) {
    setPrevious(phase);
    if (previous === 'loading' && phase === 'choose' && animate) setFinishing(true);
  }
  useEffect(() => {
    if (!finishing) return;
    const timer = setTimeout(() => setFinishing(false), motion.barFinishMs);
    return () => clearTimeout(timer);
  }, [finishing]);

  const photoPieces: PhotoPiece[] =
    phase === 'choose' ? pieces.flatMap((p) => (p.box ? [{ id: p.id, index: p.index ?? 0, box: p.box, label: chipLabel(p) }] : [])) : [];
  // The list starts once the last box is nearly in (the bar's finish already took part of that time).
  const listDelay = Math.max(0, photoPieces.length * BOX_STAGGER_MS + 160 - motion.barFinishMs);
  const count = pieces.filter((p) => selection.has(p.id)).length;
  const allSelected = count === pieces.length;

  const status =
    phase === 'empty' ? { icon: ScanSearch, label: t('itemDetect.emptyTag') } : phase === 'failed' ? { icon: ImageOff, label: t('itemDetect.failedTag') } : null;
  const photoLabel =
    phase === 'choose' ? t('itemDetect.photoA11y', { count: pieces.length }) : phase === 'loading' ? t('itemDetect.photoScanA11y') : t('itemDetect.photoPlainA11y');

  let below: ReactNode;
  if (phase === 'loading' || finishing) {
    below = <DetectWait since={waitSince} done={phase !== 'loading'} reduceMotion={reduceMotion} />;
  } else if (phase === 'choose') {
    below = (
      <SlideUp animate={animate} delayMs={listDelay}>
        <View className="gap-4">
          <View className="gap-1.5" accessibilityLiveRegion="polite">
            <Text variant="h2" accessibilityRole="header">
              {t('itemDetect.found', { count: pieces.length })}
            </Text>
            <Text variant="body" tone="muted">
              {t('itemDetect.foundBody')}
            </Text>
          </View>
          <View className="flex-row items-center justify-end gap-2">
            <Button
              variant="text"
              label={t(allSelected ? 'itemDetect.selectNone' : 'itemDetect.selectAll')}
              onPress={() => onSelectAll(!allSelected)}
              testID="detect-select-all"
            />
          </View>
          {notice ? (
            <View
              className="flex-row items-start gap-2 rounded-image-lg bg-sand p-3"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="detect-notice"
            >
              <Icon icon={CircleAlert} size={16} tone="danger" />
              <Text variant="caption" className="flex-1">
                {notice}
              </Text>
            </View>
          ) : null}
          <View className="gap-2">
            {pieces.map((piece) => (
              <PieceRow
                key={piece.id}
                piece={piece}
                checked={selection.has(piece.id)}
                edited={edited.has(piece.id)}
                onToggle={() => onToggle(piece.id)}
                onEdit={() => onEdit(piece.id)}
              />
            ))}
          </View>
          <Button variant="text" label={t('itemDetect.discard')} onPress={onDiscard} testID="detect-discard" />
        </View>
      </SlideUp>
    );
  } else {
    const empty = phase === 'empty';
    below = (
      <View className="gap-2" accessibilityRole="alert" accessibilityLiveRegion="polite" testID={empty ? 'detect-empty' : 'detect-failed'}>
        <Text variant="h3" accessibilityRole="header">
          {t(empty ? 'itemDetect.emptyTitle' : 'itemDetect.failedTitle')}
        </Text>
        <Text variant="body" tone="muted">
          {t(empty ? 'itemDetect.emptyBody' : 'itemDetect.failedBody')}
        </Text>
      </View>
    );
  }
  const outcome = phase === 'empty' || phase === 'failed';

  return (
    <>
      <ScrollView contentContainerClassName="gap-5 px-gutter pb-8 pt-1" testID="detect-chooser">
        <DetectPhoto
          uri={photoUrl}
          aspect={aspect}
          pieces={photoPieces}
          selection={selection}
          scanning={phase === 'loading'}
          stagger={animate}
          status={status}
          accessibilityLabel={photoLabel}
          onAspect={photoSize ? undefined : setLoadedAspect}
        />
        {below}
      </ScrollView>
      {phase === 'choose' && !finishing ? (
        <SlideUp animate={animate} delayMs={listDelay}>
          <BottomActionBar>
            <Button
              size="lg"
              label={count > 0 ? t('itemDetect.add', { count }) : t('itemDetect.addNone')}
              disabled={count === 0}
              loading={adding}
              onPress={onAdd}
              testID="detect-add"
            />
          </BottomActionBar>
        </SlideUp>
      ) : null}
      {outcome ? (
        <BottomActionBar>
          <View className="gap-2.5">
            <Button label={t('itemDetect.retry')} onPress={() => onRetry?.()} loading={retrying} disabled={retryDisabled || !onRetry} testID="detect-retry" />
            <Button variant="secondary" label={t('itemDetect.manual')} onPress={() => onManual?.()} testID="detect-manual" />
          </View>
        </BottomActionBar>
      ) : null}
    </>
  );
}
