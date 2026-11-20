import { Image } from 'expo-image';
import type { TFunction } from 'i18next';
import { router, useIsFocused } from 'expo-router';
import { Check, ChevronRight, CircleAlert, Images, RefreshCw, X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { BULK_ADD_MAX, type ItemDraft } from '@/api/contracts/wardrobe';
import { AiBackgroundAction, AiProgressBar, AiShimmerImage } from '@/components/ui/ai';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { isReviewable, pendingGroups } from '@/features/wardrobe/detect';
import { draftProgress, formFromDraft, isDraftComplete, limitBulkSelection, toItemFields } from '@/features/wardrobe/form';
import { CautionBadge } from '@/features/wardrobe/ItemForm';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useAddItems, useDiscardDraft, useRetryDraft, useStartItemDrafts } from '@/features/wardrobe/mutations';
import { StatePanel } from '@/features/wardrobe/parts';
import { fitToRecognitionQuota, isRecognitionLimitReached, openRecognitionPaywall, useItemRecognition } from '@/features/wardrobe/recognition';
import { useItemDrafts } from '@/features/wardrobe/queries';
import { useManualEntry } from '@/features/wardrobe/useManualEntry';
import {
  markCleanRevealed,
  markProcessing,
  overallProgress,
  processingPreview,
  rememberLocalPreviews,
  rowProgress,
  shouldRevealClean,
} from '@/features/wardrobe/bulkRows';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { useIsOnline } from '@/sync/network';
import { motion, scanTones } from '@/theme/tokens';

/** How often the simulated row progress moves while something is processing. */
const TICK_MS = 1000;
/** Blur of the picked photo while it is processed (canvas: radius ~14–16 under a cream veil), at the tile size. */
const PREVIEW_BLUR = 16;

type Notice =
  | { kind: 'none' }
  | { kind: 'offline' | 'photoFailed' | 'startFailed' | 'recognitionLimit' }
  | { kind: 'overLimit'; rejected: number }
  | { kind: 'quotaSkipped'; skipped: number };

type RowProps = {
  draft: ItemDraft;
  /** 0–1: simulated while processing (eases toward 90 %), 1 once the result is in. */
  progress: number;
  checked: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRetry: () => void;
  retrying: boolean;
};

const TILE = 'h-[62px] w-[52px] rounded-thumb';

/** The picked photo, blurred under a cream veil: "this one is being worked on". */
function BlurredPhoto({ uri }: { uri: string }) {
  return (
    <>
      {/* Decoded at the tile size first (iOS), so the blur reads the same whatever the photo resolution. */}
      <Image source={{ uri }} blurRadius={PREVIEW_BLUR} enforceEarlyResizing contentFit="cover" style={StyleSheet.absoluteFill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: scanTones.veil }]} />
    </>
  );
}

/**
 * The row's picture. Processing: the photo the user picked, blurred (a sand shimmer when there is none yet).
 * Ready: the cleaned (background-removed) image, sharp, with a small check; when this session watched it
 * being processed, it cross-fades in over the blurred photo (400 ms; instant with reduce-motion).
 */
function DraftTile({ draft }: { draft: ItemDraft }) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const processing = draft.status === 'processing';
  const preview = processingPreview(draft);
  const [reveal] = useState(() => draft.status === 'ready' && shouldRevealClean(draft.id));
  const opacity = useSharedValue(reveal ? 0 : 1);

  useEffect(() => {
    if (processing) markProcessing(draft.id);
  }, [draft.id, processing]);

  useEffect(() => {
    if (!reveal) return;
    markCleanRevealed(draft.id);
    opacity.set(reduceMotion ? 1 : withTiming(1, { duration: motion.cleanFadeMs }));
  }, [draft.id, opacity, reduceMotion, reveal]);

  const sharpStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (processing) {
    if (!preview) return <AiShimmerImage className={TILE} />;
    return (
      <View className={`overflow-hidden bg-sand ${TILE}`} testID={`bulk-tile-blurred-${draft.id}`}>
        <BlurredPhoto uri={preview} />
      </View>
    );
  }

  const s = draft.suggestion;
  return (
    <View className={`overflow-hidden bg-sand ${TILE}`} testID={`bulk-tile-${draft.status === 'ready' ? 'clean' : 'failed'}-${draft.id}`}>
      {reveal && preview ? <BlurredPhoto uri={preview} /> : null}
      <Animated.View style={[StyleSheet.absoluteFill, sharpStyle]}>
        <ItemThumb category={s?.category ?? 'top'} color={s?.color ?? 'other'} uri={draft.imageUrl} className="h-full w-full" glyphSize={30} />
      </Animated.View>
      {draft.status === 'ready' ? (
        <View
          className="absolute bottom-[3px] right-[3px] h-4 w-4 items-center justify-center rounded-pill bg-ink"
          accessible
          accessibilityLabel={t('bulkAdd.cleanedA11y')}
        >
          <Icon icon={Check} size={11} tone="cream" />
        </View>
      ) : null}
    </View>
  );
}

/** The recognised name ("Beyaz crop top"), else what the row is doing: "Tanınıyor…" / "Tanınamadı". */
function rowName(draft: ItemDraft, t: TFunction): string {
  const s = draft.suggestion;
  const name = s?.name?.trim() || s?.subcategory?.trim();
  if (name) return name;
  if (draft.status === 'processing') return t('bulkAdd.recognising');
  if (draft.status === 'failed') return t('bulkAdd.unrecognised');
  return s?.category ? t(`itemCategory.${s.category}`) : t('bulkAdd.piece');
}

/** "Üst · Beyaz" under the name, when known. */
function rowMeta(draft: ItemDraft, t: TFunction): string {
  const s = draft.suggestion;
  return [s?.category ? t(`itemCategory.${s.category}`) : null, s?.color ? t(`itemColor.${s.color}`) : null].filter(Boolean).join(' · ');
}

function DraftRow({ draft, progress, checked, onToggle, onEdit, onRemove, onRetry, retrying }: RowProps) {
  const { t } = useTranslation();
  const name = rowName(draft, t);
  const meta = rowMeta(draft, t);
  const complete = isDraftComplete(draft);
  const known = Boolean(draft.suggestion?.name?.trim() || draft.suggestion?.subcategory?.trim());

  if (draft.status === 'processing') {
    return (
      <View
        className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5"
        accessible
        accessibilityLabel={t('bulkAdd.rowProcessing', { name })}
        accessibilityState={{ busy: true }}
        testID={`bulk-row-processing-${draft.id}`}
      >
        <DraftTile draft={draft} />
        <View className="flex-1 gap-1.5">
          <View className="gap-0.5">
            <Text variant="bodyMedium" tone={known ? 'ink' : 'muted'} numberOfLines={1}>
              {name}
            </Text>
            {known && meta ? (
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
          </View>
          <AiProgressBar progress={progress} />
        </View>
      </View>
    );
  }

  if (draft.status === 'failed') {
    return (
      <View className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5" testID={`bulk-row-failed-${draft.id}`}>
        <DraftTile draft={draft} />
        <View className="flex-1 gap-0.5">
          <Text variant="bodyMedium" numberOfLines={1}>
            {name}
          </Text>
          <View className="flex-row items-center gap-1">
            <Icon icon={CircleAlert} size={13} tone="danger" />
            <Text variant="caption" tone="danger" className="flex-1" numberOfLines={2}>
              {t('bulkAdd.failedRow')}
            </Text>
          </View>
        </View>
        <IconButton icon={RefreshCw} onPress={onRetry} disabled={retrying} accessibilityLabel={t('bulkAdd.retryA11y', { name })} />
        <IconButton icon={X} variant="plain" onPress={onRemove} accessibilityLabel={t('bulkAdd.removeA11y', { name })} />
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5" testID={`bulk-row-ready-${draft.id}`}>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('bulkAdd.editA11y', { name })}
        className="min-h-icon-btn flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <DraftTile draft={draft} />
        <View className="flex-1 gap-0.5">
          <Text variant="bodyMedium" numberOfLines={1}>
            {name}
          </Text>
          {meta ? (
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {draft.lowConfidence.length > 0 || !complete ? (
            <View className="pt-1">
              <CautionBadge label={t(!complete ? 'bulkAdd.incomplete' : draft.lowConfidence.includes('category') ? 'bulkAdd.checkCategory' : 'bulkAdd.checkFields')} />
            </View>
          ) : null}
        </View>
      </Pressable>
      <IconButton icon={X} variant="plain" onPress={onRemove} accessibilityLabel={t('bulkAdd.removeA11y', { name })} />
      <Pressable
        onPress={complete ? onToggle : onEdit}
        accessibilityRole="checkbox"
        accessibilityLabel={t('bulkAdd.addA11y', { name })}
        accessibilityState={{ checked, disabled: !complete }}
        accessibilityHint={complete ? undefined : t('bulkAdd.incomplete')}
        hitSlop={10}
        className="h-icon-btn w-8 items-center justify-center"
      >
        <View className={`h-[22px] w-[22px] items-center justify-center rounded-[5px] border ${checked ? 'border-ink bg-ink' : 'border-muted bg-paper'} ${complete ? '' : 'opacity-40'}`}>
          {checked ? <Icon icon={Check} size={15} tone="cream" /> : null}
        </View>
      </Pressable>
    </View>
  );
}

/** "Foto 3 · 4 parça bulundu — Seç": a photo whose pieces wait for the chooser. */
function GroupCard({ group, photoNumber }: { group: ItemDraft; photoNumber: number }) {
  const { t } = useTranslation();
  const count = group.itemCount ?? 2;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/item/detect', params: { draftId: group.id, from: 'bulk' } })}
      accessibilityRole="button"
      accessibilityLabel={t('itemDetect.groupCardA11y', { n: photoNumber, count })}
      className="flex-row items-center gap-3 rounded-menu border border-ink bg-paper p-2.5 active:opacity-80"
      testID={`bulk-group-${group.id}`}
    >
      <ItemThumb category="top" uri={group.imageUrl} className="h-[62px] w-[52px] rounded-thumb" glyphSize={30} />
      <View className="flex-1 gap-0.5">
        <Text variant="bodyMedium" numberOfLines={1}>
          {t('itemDetect.groupCard', { n: photoNumber, count })}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {t('itemDetect.groupCardBody')}
        </Text>
      </View>
      <View className="flex-row items-center gap-1">
        <Text variant="chip">{t('itemDetect.groupCardAction')}</Text>
        <Icon icon={ChevronRight} size={16} />
      </View>
    </Pressable>
  );
}

/** Photo number per draft: pieces of one photo share their photo's number (rows are grouped by photo). */
function photoNumbers(drafts: ItemDraft[]): Map<string, number> {
  const numbers = new Map<string, number>();
  const byPhoto = new Map<string, number>();
  for (const d of drafts) {
    const photo = d.groupId ?? d.id;
    if (!byPhoto.has(photo)) byPhoto.set(photo, byPhoto.size + 1);
    numbers.set(d.id, byPhoto.get(photo) ?? 1);
  }
  return numbers;
}

/**
 * 13 Toplu ekle — up to 30 photos at once. Each photo becomes an AI draft; the screen shows the
 * batch progress from the drafts' status, then the "Kontrol et" list where every draft can be
 * edited, unchecked or removed. Low-confidence drafts are flagged and left unchecked. Nothing enters
 * the wardrobe before "N parçayı gardıroba ekle". Drafts live on the server, so leaving the screen
 * ("Arka planda devam et") and coming back shows them again.
 *
 * Every photo runs the multi-item detection: a photo with several pieces shows up as a "N parça bulundu"
 * card that opens the chooser; the pieces kept there come back here (background removal, then review),
 * grouped under their photo. Pieces chosen in the chooser start ticked.
 */
export default function ItemBulkScreen() {
  const { t } = useTranslation();
  const online = useIsOnline();
  // Polling stops while another screen is on top (e.g. editing one draft in 12c).
  const focused = useIsFocused();
  const drafts = useItemDrafts({ enabled: focused });
  const startDrafts = useStartItemDrafts();
  const addItems = useAddItems();
  const discard = useDiscardDraft();
  const retry = useRetryDraft();

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<Notice>({ kind: 'none' });
  /** Picked photos the free AI recognition did not cover: each "Elle gir" takes the next one into the manual form. */
  const [unrecognised, setUnrecognised] = useState<string[]>([]);

  const queued = drafts.data?.filter((d) => d.kind !== 'piece').length ?? 0;

  // The simulated row progress moves once a second while anything is processing.
  const anyProcessing = drafts.data?.some((d) => isReviewable(d) && d.status === 'processing') ?? false;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyProcessing || !focused) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [anyProcessing, focused]);

  const recognition = useItemRecognition();

  // Free AI recognition used up: the paywall opens; this screen stays underneath with "Elle gir".
  const limitReached = () => {
    setNotice({ kind: 'recognitionLimit' });
    void recognition.refresh();
    openRecognitionPaywall();
  };
  // "Elle gir" (no AI, no allowance), then form 12c: a manual draft a refused recognition left behind, else the
  // next unrecognised photo of the pick, else a photo picked now.
  const manual = useManualEntry({ from: 'bulk' });
  const enterManually = () => {
    if (manual.hasPending) {
      manual.enter();
      return;
    }
    const [photoUri, ...rest] = unrecognised;
    setUnrecognised(rest);
    manual.enter(photoUri ?? null);
  };

  const onPicked = (photos: PreparedPhoto[]) => {
    const { accepted: withinBatch, rejected } = limitBulkSelection(photos, queued);
    // Only part of the batch may fit the free recognition quota: process those, report the rest.
    const { accepted, skipped } = fitToRecognitionQuota(withinBatch, recognition.remaining);
    setUnrecognised(withinBatch.slice(accepted.length).map((p) => p.localUri));
    if (withinBatch.length > 0 && accepted.length === 0) {
      limitReached();
      return;
    }
    setNotice(skipped > 0 ? { kind: 'quotaSkipped', skipped } : rejected > 0 ? { kind: 'overLimit', rejected } : { kind: 'none' });
    if (accepted.length === 0) return;
    const localUris = accepted.map((p) => p.localUri);
    startDrafts
      .start(localUris)
      .then((res) => {
        rememberLocalPreviews(res.draftIds, localUris);
        const serverSkipped = res.skippedCount ?? 0;
        if (skipped + serverSkipped > 0) setNotice({ kind: 'quotaSkipped', skipped: skipped + serverSkipped });
      })
      .catch((error: unknown) => {
        if (!isRecognitionLimitReached(error)) {
          setNotice({ kind: 'startFailed' });
          return;
        }
        // Nothing was started (402): every photo of this pick can still be entered by hand — on the API they
        // already are manual drafts (`adopt`), otherwise the photos travel into the form one by one.
        if (!manual.adopt(error)) setUnrecognised(withinBatch.map((p) => p.localUri));
        limitReached();
      });
  };
  const picker = usePhotoPicker({ onPicked, onError: () => setNotice({ kind: 'photoFailed' }) });

  const pick = () => {
    if (!online) {
      setNotice({ kind: 'offline' });
      return;
    }
    if (recognition.exhausted) {
      limitReached();
      return;
    }
    const room = BULK_ADD_MAX - queued;
    if (room <= 0) {
      setNotice({ kind: 'overLimit', rejected: 0 });
      return;
    }
    setNotice({ kind: 'none' });
    picker.chooseFromLibrary(room);
  };

  // A piece the user kept in the chooser was already looked at: it starts ticked.
  const isChecked = (draft: ItemDraft) => isDraftComplete(draft) && (overrides[draft.id] ?? (draft.selected || draft.lowConfidence.length === 0));

  const noticeText =
    notice.kind === 'none'
      ? null
      : notice.kind === 'overLimit'
        ? notice.rejected > 0
          ? t('bulkAdd.overLimit', { count: notice.rejected, max: BULK_ADD_MAX })
          : t('bulkAdd.limitReached', { max: BULK_ADD_MAX })
        : notice.kind === 'quotaSkipped'
          ? t('bulkAdd.quotaSkipped', { count: notice.skipped })
          : t(`bulkAdd.${notice.kind}`);
  const quotaNotice = notice.kind === 'recognitionLimit' || notice.kind === 'quotaSkipped';

  const noticeView = noticeText ? (
    <View className="gap-2 rounded-image-lg bg-sand p-3" accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View className="flex-row items-start gap-2">
        <Icon icon={CircleAlert} size={16} tone="danger" />
        <Text variant="caption" className="flex-1">
          {noticeText}
        </Text>
      </View>
      {quotaNotice ? (
        <View className="flex-row flex-wrap gap-2">
          <Button variant="secondary" label={t('bulkAdd.becomeMember')} onPress={openRecognitionPaywall} />
          <Button variant="text" label={t('bulkAdd.manual')} onPress={enterManually} testID="bulk-manual-notice" />
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <Screen>
      <ScreenHeader title={t('bulkAdd.title')} leading="back" />
      <ScreenState query={drafts}>
        {(all) => {
          const list = all.filter(isReviewable);
          const groups = pendingGroups(all);
          const numbers = photoNumbers(all);
          if (list.length === 0 && groups.length === 0) {
            return (
              <View className="flex-1">
                {noticeView ? <View className="gap-3 px-gutter pt-1">{noticeView}</View> : null}
                <StatePanel icon={Images} title={t('bulkAdd.emptyTitle')} body={t('bulkAdd.emptyBody', { max: BULK_ADD_MAX })}>
                  <Button label={t('bulkAdd.pick')} icon={Images} onPress={pick} loading={startDrafts.isPending} testID="bulk-pick" />
                  {/* Always there: a piece can be saved without AI (12c with empty fields). */}
                  <Button variant="text" label={t('bulkAdd.manual')} onPress={enterManually} testID="bulk-manual" />
                </StatePanel>
              </View>
            );
          }

          const progress = draftProgress(list);
          const working = progress.processing > 0;
          const checked = list.filter(isChecked);
          const selectable = list.filter(isDraftComplete);
          const allChecked = selectable.length > 0 && checked.length === selectable.length;

          const addChecked = () => {
            addItems.add(
              checked.map((d) => {
                const fields = toItemFields(formFromDraft(d));
                return { fields, draftId: d.id, preview: d.imageUrl, reviewed: overrides[d.id] !== undefined || d.selected === true || d.lowConfidence.length === 0 };
              }),
              'bulk',
            );
            if (checked.length === list.length && groups.length === 0) router.dismissTo('/wardrobe');
          };

          return (
            <>
              <FlatList
                data={list}
                keyExtractor={(d) => d.id}
                contentContainerClassName="gap-2 px-gutter pb-8 pt-1"
                ListHeaderComponent={
                  <View className="gap-3 pb-2">
                    <View className="gap-2.5 rounded-card border border-line bg-paper p-3.5" accessibilityLiveRegion="polite">
                      <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <Text variant="bodyMedium" className="flex-1">
                          {t(working ? 'bulkAdd.processing' : 'bulkAdd.allDone', { count: progress.total })}
                        </Text>
                        <Text variant="caption" tone="muted">
                          {t('bulkAdd.progress', { done: progress.done, total: progress.total, max: BULK_ADD_MAX })}
                        </Text>
                      </View>
                      <AiProgressBar
                        progress={overallProgress(list, now)}
                        accessibilityLabel={t('bulkAdd.progressA11y', { done: progress.done, total: progress.total })}
                      />
                      <Text variant="caption" tone="muted">
                        {t(working ? 'bulkAdd.explain' : 'bulkAdd.explainDone')}
                      </Text>
                    </View>
                    {noticeView}
                    {working ? <AiBackgroundAction onPress={() => router.dismissTo('/wardrobe')} /> : null}
                    {groups.map((g) => (
                      <GroupCard key={g.id} group={g} photoNumber={numbers.get(g.id) ?? 1} />
                    ))}
                    <View className="flex-row items-center justify-between gap-3 pt-1">
                      <Text variant="h3" className="flex-1">
                        {t('bulkAdd.review')}
                      </Text>
                      {selectable.length > 0 ? (
                        <Button
                          variant="text"
                          label={t(allChecked ? 'bulkAdd.clearAll' : 'bulkAdd.selectAll')}
                          onPress={() => setOverrides(Object.fromEntries(selectable.map((d) => [d.id, !allChecked])))}
                        />
                      ) : null}
                    </View>
                  </View>
                }
                ListFooterComponent={
                  progress.total < BULK_ADD_MAX ? (
                    <View className="pt-2">
                      <Button variant="secondary" icon={Images} label={t('bulkAdd.pickMore')} onPress={pick} loading={startDrafts.isPending} />
                    </View>
                  ) : undefined
                }
                renderItem={({ item, index }) => (
                  <View className="gap-2">
                    {/* The only "Foto N" of a multi-piece photo: its pieces carry their own names. */}
                    {item.groupId && list[index - 1]?.groupId !== item.groupId ? (
                      <Text variant="eyebrow" className="pt-1" accessibilityRole="header">
                        {t('itemDetect.groupHeadingCount', { n: numbers.get(item.id) ?? 1, count: list.filter((d) => d.groupId === item.groupId).length })}
                      </Text>
                    ) : null}
                  <DraftRow
                    draft={item}
                    progress={rowProgress(item, now)}
                    checked={isChecked(item)}
                    onToggle={() => setOverrides((prev) => ({ ...prev, [item.id]: !isChecked(item) }))}
                    onEdit={() => router.push({ pathname: '/item/form', params: { draftId: item.id, from: 'bulk' } })}
                    onRemove={() => discard.discard(item.id)}
                    onRetry={() => retry.mutate(item.id)}
                    retrying={retry.isPending && retry.variables === item.id}
                  />
                  </View>
                )}
              />
              <BottomActionBar>
                <Button size="lg" label={t('bulkAdd.add', { count: checked.length })} disabled={checked.length === 0} onPress={addChecked} testID="bulk-add" />
              </BottomActionBar>
            </>
          );
        }}
      </ScreenState>
      {picker.sheet}
    </Screen>
  );
}
