import { router, useIsFocused } from 'expo-router';
import { Check, CircleAlert, Images, RefreshCw, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, View } from 'react-native';

import { BULK_ADD_MAX, type ItemDraft } from '@/api/contracts/wardrobe';
import { AiBackgroundAction, AiProgressBar, AiShimmerImage } from '@/components/ui/ai';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import type { PreparedPhoto } from '@/features/photos/preparePhoto';
import { usePhotoPicker } from '@/features/photos/usePhotoPicker';
import { draftProgress, formFromDraft, isDraftComplete, limitBulkSelection, toItemFields } from '@/features/wardrobe/form';
import { CautionBadge } from '@/features/wardrobe/ItemForm';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useAddItems, useDiscardDraft, useRetryDraft, useStartItemDrafts } from '@/features/wardrobe/mutations';
import { StatePanel } from '@/features/wardrobe/parts';
import { fitToRecognitionQuota, isRecognitionLimitReached, openRecognitionPaywall, useItemRecognition } from '@/features/wardrobe/recognition';
import { useItemDrafts } from '@/features/wardrobe/queries';
import { useManualEntry } from '@/features/wardrobe/useManualEntry';
import { useIsOnline } from '@/sync/network';

type Notice =
  | { kind: 'none' }
  | { kind: 'offline' | 'photoFailed' | 'startFailed' | 'recognitionLimit' }
  | { kind: 'overLimit'; rejected: number }
  | { kind: 'quotaSkipped'; skipped: number };

function BulkSkeleton() {
  return (
    <View className="gap-3 px-gutter pt-2">
      <Skeleton className="h-24 w-full rounded-card" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-[72px] w-full rounded-card" />
      ))}
    </View>
  );
}

type RowProps = {
  draft: ItemDraft;
  index: number;
  checked: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onRetry: () => void;
  retrying: boolean;
};

function DraftRow({ draft, index, checked, onToggle, onEdit, onRemove, onRetry, retrying }: RowProps) {
  const { t } = useTranslation();
  const s = draft.suggestion;
  const name = s?.name?.trim() || t('bulkAdd.photoN', { n: index + 1 });
  const complete = isDraftComplete(draft);

  if (draft.status === 'processing') {
    return (
      <View className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5" accessible accessibilityLabel={t('bulkAdd.rowProcessing', { name })} accessibilityState={{ busy: true }}>
        <AiShimmerImage className="h-[62px] w-[52px] rounded-thumb" />
        <View className="flex-1 gap-1.5">
          <Text variant="bodyMedium" numberOfLines={1}>
            {name}
          </Text>
          <AiProgressBar index={index % 3} />
        </View>
      </View>
    );
  }

  if (draft.status === 'failed') {
    return (
      <View className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5">
        <ItemThumb category="top" uri={draft.imageUrl} className="h-[62px] w-[52px] rounded-thumb" glyphSize={30} />
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

  const meta = [s?.category ? t(`itemCategory.${s.category}`) : null, s?.color ? t(`itemColor.${s.color}`) : null].filter(Boolean).join(' · ');
  return (
    <View className="flex-row items-center gap-3 rounded-menu border border-line bg-paper p-2.5">
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={t('bulkAdd.editA11y', { name })}
        className="min-h-icon-btn flex-1 flex-row items-center gap-3 active:opacity-80"
      >
        <ItemThumb category={s?.category ?? 'top'} color={s?.color ?? 'other'} uri={draft.imageUrl} className="h-[62px] w-[52px] rounded-thumb" glyphSize={30} />
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

/**
 * 13 Toplu ekle — up to 30 photos at once. Each photo becomes an AI draft; the screen shows the
 * batch progress from the drafts' status, then the "Kontrol et" list where every draft can be
 * edited, unchecked or removed. Low-confidence drafts are flagged and left unchecked. Nothing enters
 * the wardrobe before "N parçayı gardıroba ekle". Drafts live on the server, so leaving the screen
 * ("Arka planda devam et") and coming back shows them again.
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

  const [splitOutfit, setSplitOutfit] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState<Notice>({ kind: 'none' });
  /** Picked photos the free AI recognition did not cover: each "Elle gir" takes the next one into the manual form. */
  const [unrecognised, setUnrecognised] = useState<string[]>([]);

  const queued = drafts.data?.length ?? 0;

  const recognition = useItemRecognition();

  // Free AI recognition used up: the paywall opens; this screen stays underneath with "Elle gir".
  const limitReached = () => {
    setNotice({ kind: 'recognitionLimit' });
    void recognition.refresh();
    openRecognitionPaywall();
  };
  // "Elle gir" (no AI, no allowance), then form 12c: a manual draft a refused recognition left behind, else the
  // next unrecognised photo of the pick, else a photo picked now.
  const manual = useManualEntry({ from: 'bulk', onError: () => setNotice({ kind: 'photoFailed' }) });
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
    startDrafts
      .start(
        accepted.map((p) => p.localUri),
        splitOutfit,
      )
      .then((res) => {
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

  const isChecked = (draft: ItemDraft) => isDraftComplete(draft) && (overrides[draft.id] ?? draft.lowConfidence.length === 0);

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

  // Canvas: a two-segment switch on the sand track (padding 3, segments 38 high, chip-size text) — not chips.
  const modeChips = (
    <View className="flex-row gap-[3px] rounded-pill bg-sand p-[3px]" accessibilityRole="radiogroup" accessibilityLabel={t('bulkAdd.modeA11y')}>
      {([false, true] as const).map((split) => {
        const selected = splitOutfit === split;
        const label = t(split ? 'bulkAdd.modeSplit' : 'bulkAdd.modeSingle');
        return (
          <Pressable
            key={String(split)}
            onPress={() => setSplitOutfit(split)}
            accessibilityRole="radio"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            hitSlop={{ top: 3, bottom: 3 }}
            className={`h-[38px] flex-1 items-center justify-center rounded-pill px-2 ${selected ? 'bg-paper shadow-sm' : ''}`}
          >
            <Text variant="chip" tone={selected ? 'ink' : 'muted'} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Screen>
      <ScreenHeader title={t('bulkAdd.title')} leading="back" />
      <ScreenState query={drafts} skeleton={<BulkSkeleton />}>
        {(list) => {
          if (list.length === 0) {
            return (
              <View className="flex-1">
                <View className="gap-3 px-gutter pt-1">
                  {modeChips}
                  {noticeView}
                </View>
                <StatePanel icon={Images} title={t('bulkAdd.emptyTitle')} body={t(splitOutfit ? 'bulkAdd.emptyBodySplit' : 'bulkAdd.emptyBody', { max: BULK_ADD_MAX })}>
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
                return { fields, draftId: d.id, preview: d.imageUrl, reviewed: overrides[d.id] !== undefined || d.lowConfidence.length === 0 };
              }),
            );
            if (checked.length === list.length) router.dismissTo('/wardrobe');
          };

          return (
            <>
              <FlatList
                data={list}
                keyExtractor={(d) => d.id}
                contentContainerClassName="gap-2 px-gutter pb-8 pt-1"
                ListHeaderComponent={
                  <View className="gap-3 pb-2">
                    {modeChips}
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
                        progress={progress.total === 0 ? 0 : progress.done / progress.total}
                        accessibilityLabel={t('bulkAdd.progressA11y', { done: progress.done, total: progress.total })}
                      />
                      <Text variant="caption" tone="muted">
                        {t(working ? 'bulkAdd.explain' : 'bulkAdd.explainDone')}
                      </Text>
                    </View>
                    {noticeView}
                    {working ? <AiBackgroundAction onPress={() => router.dismissTo('/wardrobe')} /> : null}
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
                  <DraftRow
                    draft={item}
                    index={index}
                    checked={isChecked(item)}
                    onToggle={() => setOverrides((prev) => ({ ...prev, [item.id]: !isChecked(item) }))}
                    onEdit={() => router.push({ pathname: '/item/form', params: { draftId: item.id, from: 'bulk' } })}
                    onRemove={() => discard.discard(item.id)}
                    onRetry={() => retry.mutate(item.id)}
                    retrying={retry.isPending && retry.variables === item.id}
                  />
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
      {manual.sheet}
    </Screen>
  );
}
