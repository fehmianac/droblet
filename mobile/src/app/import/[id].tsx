import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Check, RefreshCw, X } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Pressable, Switch, View } from 'react-native';

import type { ImportChoices, ImportPhoto, ImportSession } from '@/api/contracts/outfitImport';
import { AiBackgroundAction, AiProgressBar } from '@/components/ui/ai';
import { BottomActionBar } from '@/components/ui/BottomActionBar';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/IconButton';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import { useCommitImport, useDiscardImport, useImportSession } from '@/features/outfitImport/api';
import { importProgress, isLookOn, isPieceOn, NO_CHOICES, reviewPhotos, reviewSummary, toggleLook, togglePiece } from '@/features/outfitImport/logic';
import { ImportNotice, NoPiecesFound, PieceTag, UploadsPaused } from '@/features/outfitImport/parts';
import { retryUploads, useImportUploads, type PhotoUpload } from '@/features/outfitImport/uploader';
import { ItemThumb } from '@/features/wardrobe/ItemThumb';
import { useAppLanguage } from '@/i18n/useAppLanguage';
import { suffixed } from '@/lib/trSuffix';
import { toDisplayUpper } from '@/lib/upper';
import { useIsOnline } from '@/sync/network';
import { surfaceTones } from '@/theme/tokens';
import { useThemeColors } from '@/theme/useThemeColors';

// ── 31b: uploads and processing ─────────────────────────────────────────────────────────────────────────────

type TileState = 'ready' | 'matching' | 'detecting' | 'queued' | 'uploading' | 'uploadFailed' | 'noPieces';

function tileState(photo: ImportPhoto, upload: PhotoUpload | undefined): TileState {
  switch (photo.status) {
    case 'ready':
      return 'ready';
    case 'failed':
      return 'noPieces';
    case 'detected':
      return 'matching';
    case 'uploaded':
      return 'detecting';
    default:
      return upload?.status === 'failed' ? 'uploadFailed' : upload?.status === 'uploading' ? 'uploading' : 'queued';
  }
}

function PhotoTile({ photo, upload, sessionId }: { photo: ImportPhoto; upload: PhotoUpload | undefined; sessionId: string }) {
  const { t } = useTranslation();
  const state = tileState(photo, upload);
  if (state === 'uploadFailed') {
    return (
      <Pressable
        onPress={() => retryUploads(sessionId, photo.index)}
        accessibilityRole="button"
        accessibilityLabel={t('outfitImport.progress.retryA11y', { n: photo.index })}
        className="h-24 flex-1 items-center justify-center gap-1 rounded-[12px] active:opacity-80"
        style={{ backgroundColor: surfaceTones.caution }}
        testID={`import.tile.${photo.index}.retry`}
      >
        <Icon icon={RefreshCw} size={20} tone="danger" />
        <Text variant="badge" className="text-center">
          {t('outfitImport.progress.uploadFailed')}
          {'\n'}
          {t('outfitImport.progress.retry')}
        </Text>
      </Pressable>
    );
  }
  const label =
    state === 'ready'
      ? t('outfitImport.progress.pieces', { count: photo.pieces.length })
      : state === 'noPieces'
        ? t('outfitImport.progress.noPieces')
        : t(`outfitImport.progress.${state}`);
  const busy = state === 'matching' || state === 'detecting' || state === 'uploading';
  return (
    <View
      className="h-24 flex-1 overflow-hidden rounded-[12px]"
      accessible
      accessibilityLabel={t('outfitImport.progress.photoA11y', { n: photo.index, state: state === 'ready' ? `${t('outfitImport.progress.readyA11y')}, ${label}` : label })}
      accessibilityState={{ busy }}
      testID={`import.tile.${photo.index}`}
    >
      <ImageSlot uri={photo.imageUrl ?? upload?.localUri ?? null} className="h-full w-full" placeholder={{ kind: 'look', pieces: [], seed: `${sessionId}-${photo.index}`, figureHeight: 70 }} />
      {state === 'ready' ? (
        <View className="absolute right-1.5 top-1.5 h-[18px] w-[18px] items-center justify-center rounded-pill bg-ink">
          <Icon icon={Check} size={11} tone="cream" />
        </View>
      ) : null}
      <View className="absolute bottom-1.5 left-1.5 right-1.5 gap-[3px] rounded-[8px] bg-paper/95 px-1.5 py-[3px]">
        <Text variant="badge" tone={state === 'noPieces' ? 'danger' : 'ink'} numberOfLines={1}>
          {label}
        </Text>
        {busy ? <AiProgressBar index={photo.index % 3} /> : null}
      </View>
    </View>
  );
}

function ProgressView({ session, notices }: { session: ImportSession; notices: string[] }) {
  const { t } = useTranslation();
  const online = useIsOnline();
  const uploads = useImportUploads(session.id);
  const { done, total } = importProgress(session);
  const byIndex = new Map(uploads.map((u) => [u.index, u]));
  const waiting = uploads.filter((u) => u.status === 'queued' || u.status === 'uploading').length;
  const paused = !online && waiting > 0;
  const rows: ImportPhoto[][] = [];
  for (let i = 0; i < session.photos.length; i += 4) rows.push(session.photos.slice(i, i + 4));

  return (
    <>
      <FlatList
        data={rows}
        keyExtractor={(row) => String(row[0]?.index)}
        contentContainerClassName="gap-2 px-gutter pb-8 pt-1"
        ListHeaderComponent={
          <View className="gap-3 pb-1">
            {notices.map((n) => (
              <ImportNotice key={n} text={n} />
            ))}
            {paused ? (
              <UploadsPaused done={session.counters.uploaded} total={session.count} />
            ) : (
              <View className="gap-2.5 rounded-card border border-line bg-paper p-3.5" accessibilityLiveRegion="polite" testID="import.progress">
                <View className="flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Text variant="bodyMedium" className="flex-1">
                    {t('outfitImport.progress.processing', { count: total })}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t('outfitImport.progress.count', { done, total })}
                  </Text>
                </View>
                <AiProgressBar progress={total === 0 ? 0 : done / total} accessibilityLabel={t('outfitImport.progress.countA11y', { done, total })} />
                <View className="flex-row gap-2 pt-0.5">
                  {(['uploaded', 'detected', 'matched'] as const).map((key) => (
                    <View key={key} className="flex-1 gap-0.5">
                      <Text variant="title">{session.counters[key]}</Text>
                      <Text variant="caption" tone="muted">
                        {t(`outfitImport.progress.${key}`)}
                      </Text>
                    </View>
                  ))}
                </View>
                <Text variant="caption" tone="muted">
                  {t('outfitImport.progress.explain')}
                </Text>
              </View>
            )}
            <AiBackgroundAction onPress={() => router.dismissTo('/wardrobe/looks')} />
          </View>
        }
        renderItem={({ item: row }) => (
          <View className="flex-row gap-2">
            {row.map((photo) => (
              <PhotoTile key={photo.index} photo={photo} upload={byIndex.get(photo.index)} sessionId={session.id} />
            ))}
            {Array.from({ length: 4 - row.length }, (_, i) => (
              <View key={`pad-${i}`} className="flex-1" />
            ))}
          </View>
        )}
      />
      <BottomActionBar actionFill>
        <View className="flex-1 gap-1">
          {paused ? (
            <Button label={t('outfitImport.states.retry')} onPress={() => retryUploads(session.id)} />
          ) : (
            <Button label={t('outfitImport.progress.review')} onPress={() => undefined} disabled />
          )}
          <Text variant="caption" tone="muted" className="text-center">
            {t('outfitImport.progress.reviewHint')}
          </Text>
        </View>
      </BottomActionBar>
    </>
  );
}

// ── 31c: review ─────────────────────────────────────────────────────────────────────────────────────────────

function Checkbox({ checked, onPress, label }: { checked: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }} hitSlop={10} className="h-icon-btn w-8 items-center justify-center">
      <View className={`h-[22px] w-[22px] items-center justify-center rounded-[5px] border ${checked ? 'border-ink bg-ink' : 'border-muted bg-paper'}`}>
        {checked ? <Icon icon={Check} size={15} tone="cream" /> : null}
      </View>
    </Pressable>
  );
}

function LookCard({ photo, choices, onChange }: { photo: ImportPhoto; choices: ImportChoices; onChange: (next: ImportChoices) => void }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const colors = useThemeColors();
  if (photo.status === 'failed') {
    return (
      <View className="flex-row items-center gap-3 rounded-[18px] border border-line bg-paper p-3 opacity-60" testID={`import.look.${photo.index}`}>
        <ImageSlot uri={photo.imageUrl} className="h-16 w-12 rounded-[12px]" placeholder={{ kind: 'look', pieces: [], seed: photo.lookId, figureHeight: 50 }} />
        <View className="flex-1 gap-[3px]">
          <Text variant="eyebrow">{toDisplayUpper(t('outfitImport.review.photoN', { n: photo.index }), language)}</Text>
          <Text variant="caption" tone="danger">
            {t('outfitImport.review.noPieces')}
          </Text>
        </View>
      </View>
    );
  }
  const on = isLookOn(choices, photo.index);
  const newCount = photo.pieces.filter((p) => p.kind === 'new').length;
  const matchedCount = photo.pieces.length - newCount;
  const alsoIn = (list: number[]) => {
    const head = list.slice(0, -1).join(', ');
    const last = list[list.length - 1] ?? 0;
    const tail = suffixed(last, 'locative', language);
    return head ? `${head} ${t('outfitImport.review.and')} ${tail}` : tail;
  };
  return (
    <View className={`gap-2.5 rounded-[18px] border border-line bg-paper p-3 ${on ? '' : 'opacity-55'}`} testID={`import.look.${photo.index}`}>
      <View className="flex-row items-start gap-3">
        <ImageSlot uri={photo.imageUrl} className="h-24 w-[72px] rounded-[12px]" placeholder={{ kind: 'look', pieces: [], seed: photo.lookId, figureHeight: 80 }} />
        <View className="flex-1 gap-1 pt-0.5">
          <Text variant="eyebrow">{toDisplayUpper(t('outfitImport.review.photoN', { n: photo.index }), language)}</Text>
          <Text variant="bodyMedium">{t('outfitImport.review.lookPieces', { count: photo.pieces.length })}</Text>
          <Text variant="caption" tone="muted">
            {t('outfitImport.review.lookMix', { newCount, matchedCount })}
          </Text>
        </View>
        <Switch
          value={on}
          onValueChange={() => onChange(toggleLook(choices, photo.index))}
          accessibilityLabel={t('outfitImport.review.lookSwitchA11y', { n: photo.index })}
          trackColor={{ false: colors.line, true: colors.ink }}
          thumbColor={colors.paper}
          ios_backgroundColor={colors.line}
          testID={`import.look.${photo.index}.switch`}
        />
      </View>
      <View className="gap-0.5 border-t border-sand pt-1.5">
        {photo.pieces.map((piece) => {
          const name = piece.name?.trim() || t('outfitImport.review.pieceFallback');
          const checked = on && isPieceOn(choices, piece.ref);
          return (
            <View key={piece.ref} className="min-h-icon-btn flex-row items-center gap-2.5" testID={`import.piece.${piece.ref}`}>
              <ItemThumb category={piece.category} color={piece.color} uri={piece.imageUrl} className="h-10 w-[34px] rounded-[8px]" glyphSize={20} />
              <View className="min-w-0 flex-1 gap-[3px]">
                <Text variant="segment" numberOfLines={1}>
                  {name}
                </Text>
                <View className="flex-row flex-wrap items-center gap-1.5">
                  <PieceTag kind={piece.kind} />
                  {piece.kind === 'new' && piece.alsoIn.length > 0 ? (
                    <Text variant="caption" tone="muted">
                      {t('outfitImport.review.alsoIn', { list: alsoIn(piece.alsoIn) })}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Checkbox checked={checked} label={t('outfitImport.review.pieceA11y', { name })} onPress={() => onChange(togglePiece(on ? choices : toggleLook(choices, photo.index), piece.ref))} />
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ReviewView({ session, onDiscard, discarding }: { session: ImportSession; onDiscard: () => void; discarding: boolean }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const [choices, setChoices] = useState<ImportChoices>(NO_CHOICES);
  const commit = useCommitImport(session);
  const summary = reviewSummary(session, choices);
  const photos = reviewPhotos(session);
  const failed = session.photos.filter((p) => p.status === 'failed').length;
  const everything = choices.looksOff.length === 0 && choices.piecesOff.length === 0;

  return (
    <>
      <ScreenHeader
        title={t('outfitImport.review.title')}
        leading="back"
        right={<Button variant="text" label={t('outfitImport.review.discard')} onPress={onDiscard} disabled={discarding || commit.isPending} testID="import.discard" />}
      />
      <FlatList
        data={photos}
        keyExtractor={(p) => String(p.index)}
        contentContainerClassName="gap-3 px-gutter pb-8 pt-1"
        ListHeaderComponent={
          <View className="gap-3">
            <View className="gap-1">
              <Text variant="display" accessibilityRole="header">
                {t('outfitImport.review.heading', { count: summary.looks })}
              </Text>
              <Text variant="caption" tone="muted">
                {t('outfitImport.review.summary', { newCount: summary.newPieces, matchedCount: summary.matched })}
              </Text>
            </View>
            {commit.isError ? <ImportNotice text={t('outfitImport.review.commitFailed')} tone="warm" /> : null}
            <View className="flex-row items-center justify-between">
              <Text variant="eyebrow">{toDisplayUpper(t('outfitImport.review.photos', { count: session.photos.length, failed }), language)}</Text>
              <Button variant="text" label={t('outfitImport.review.selectAll')} onPress={() => setChoices(NO_CHOICES)} disabled={everything} />
            </View>
          </View>
        }
        renderItem={({ item }) => <LookCard photo={item} choices={choices} onChange={setChoices} />}
      />
      <BottomActionBar actionFill>
        <View className="flex-1 gap-1">
          <Button
            label={t('outfitImport.review.approve', { looks: summary.looks, newCount: summary.newPieces })}
            onPress={() => commit.mutate(choices)}
            loading={commit.isPending}
            disabled={summary.looks === 0 && summary.newPieces === 0}
            testID="import.approve"
          />
          <Text variant="caption" tone="muted" className="text-center">
            {t('outfitImport.review.approveHint')}
          </Text>
        </View>
      </BottomActionBar>
    </>
  );
}

// ── 31d: done ───────────────────────────────────────────────────────────────────────────────────────────────

function DoneView({ session }: { session: ImportSession }) {
  const { t } = useTranslation();
  const language = useAppLanguage();
  const result = session.result;
  const looks = result?.createdLookCount ?? 0;
  const items = result?.createdItemCount ?? 0;
  const created = new Set(result?.looks.filter((l) => l.outcome === 'created').map((l) => l.photoIndex) ?? []);
  const covers = session.photos.filter((p) => created.has(p.index)).slice(0, 3);
  return (
    <View className="flex-1" testID="import.done">
      <View className="h-12 flex-row items-center justify-end px-gutter">
        <IconButton icon={X} variant="plain" onPress={() => router.dismissTo('/wardrobe/looks')} accessibilityLabel={t('a11y.close')} className="-mr-2.5" />
      </View>
      <View className="flex-1 items-center gap-5 px-6 pt-4" accessibilityLiveRegion="polite">
        <View className="h-16 w-16 items-center justify-center rounded-pill bg-ink">
          <Icon icon={Check} size={30} tone="cream" />
        </View>
        <View className="items-center gap-2">
          <Text variant="eyebrow">{toDisplayUpper(t('outfitImport.done.eyebrow'), language)}</Text>
          <Text variant="display" className="text-center" accessibilityRole="header">
            {t('outfitImport.done.title', { count: looks })}
          </Text>
          <Text variant="body" tone="muted" className="text-center">
            {items > 0 ? t('outfitImport.done.body', { count: items }) : t('outfitImport.done.bodyNoItems')}
          </Text>
        </View>
        {covers.length > 0 ? (
          <View className="w-full flex-row gap-2" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {covers.map((p) => (
              <ImageSlot key={p.index} uri={p.imageUrl} className="h-[150px] flex-1 rounded-image-lg" placeholder={{ kind: 'look', pieces: [], seed: p.lookId, figureHeight: 80 }} />
            ))}
          </View>
        ) : null}
        <Text variant="caption" tone="muted" className="text-center">
          {t('outfitImport.done.coverNote')}
        </Text>
      </View>
      <View className="gap-2 px-gutter pb-6 pt-3">
        <Button label={t('outfitImport.done.looks')} onPress={() => router.dismissTo('/wardrobe/looks')} testID="import.done.looks" />
        <Button variant="secondary" size="lg" label={t('outfitImport.done.items')} onPress={() => router.dismissTo('/wardrobe')} />
      </View>
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One import: 31b while photos are uploaded and processed (the screen can be left; polling stops off focus),
 * 31c to review and approve, 31d once committed, 31e A when no photo gave a piece. Opened from 31, from the
 * "Kombinlerin hazır" notification and when the import entry finds a running session.
 */
export default function ImportSessionScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string; over?: string; skipped?: string; max?: string }>();
  const focused = useIsFocused();
  const session = useImportSession(params.id, { enabled: focused });
  const discard = useDiscardImport();

  const notices: string[] = [];
  const over = Number(params.over ?? 0);
  const skipped = Number(params.skipped ?? 0);
  if (over > 0 && params.max) notices.push(t('outfitImport.states.overLimit', { max: Number(params.max) }));
  if (skipped > 0 && session.data) notices.push(t('outfitImport.states.quotaSkipped', { left: session.data.count, skipped }));

  const confirmDiscard = () =>
    Alert.alert(t('outfitImport.review.discardTitle'), t('outfitImport.review.discardBody'), [
      { text: t('outfitImport.review.discardKeep'), style: 'cancel' },
      { text: t('outfitImport.review.discardConfirm'), style: 'destructive', onPress: () => discard.mutate(params.id, { onSuccess: () => router.back() }) },
    ]);

  return (
    <Screen>
      <ScreenState query={session}>
        {(data) => {
          if (data.status === 'committed') return <DoneView session={data} />;
          if (data.status === 'ready') return <ReviewView session={data} onDiscard={confirmDiscard} discarding={discard.isPending} />;
          if (data.status === 'failed') {
            return (
              <>
                <ScreenHeader title={t('outfitImport.title')} leading="back" />
                <NoPiecesFound
                  busy={discard.isPending}
                  onPickOther={() => discard.mutate(data.id, { onSuccess: () => router.replace('/import') })}
                  onCancel={() => discard.mutate(data.id, { onSuccess: () => router.back() })}
                />
              </>
            );
          }
          return (
            <>
              <ScreenHeader title={t('outfitImport.title')} leading="back" />
              <ProgressView session={data} notices={notices} />
            </>
          );
        }}
      </ScreenState>
    </Screen>
  );
}
