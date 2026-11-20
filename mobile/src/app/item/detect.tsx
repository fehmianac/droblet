import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import {
  chooserState,
  detectedEdits,
  detectedPieces,
  selectedIds,
  resolveSelection,
  useDetectedEditsVersion,
  type ChooserState,
} from '@/features/wardrobe/detect';
import { DetectChooser, type DetectPhase } from '@/features/wardrobe/DetectChooser';
import { useDiscardDraft, useRetryDraft, useSelectDetected } from '@/features/wardrobe/mutations';
import { StatePanel } from '@/features/wardrobe/parts';
import { useItemDrafts } from '@/features/wardrobe/queries';
import { usePhotoTryOn } from '@/features/tryon/usePhotoTryOn';
import { useIsOnline } from '@/sync/network';

/** Where a finished choice goes: back to the bulk list it came from, otherwise to that list (background removal + confirm). */
function toReview(from: string | undefined) {
  if (from === 'bulk' && router.canGoBack()) router.back();
  else router.replace('/item/bulk');
}

/** The part of the screen under the photo for each state; `null` = no photo to show (gone / already chosen). */
function phaseOf(state: ChooserState): DetectPhase | null {
  switch (state) {
    case 'processing':
    case 'single':
      return 'loading';
    case 'choose':
    case 'empty':
    case 'failed':
      return state;
    default:
      return null;
  }
}

/**
 * Parçaları seç — after one photo (12) or for one photo of a bulk batch (13). The photo stays on screen
 * the whole time (canvas 15): while it is analysed the scan line of 12 sweeps over it with calm stage
 * sentences; several pieces → their boxes appear one by one and the choice slides up; nothing found /
 * failed → the reason with retry / manual entry; one piece → the review form (12c), no chooser; already
 * chosen / gone → back to the review list. "N parçayı ekle" sends the choice: kept pieces get their
 * background removed and appear in the review list (13), the others are discarded and cost nothing.
 *
 * From 12 the route carries the local photo (`photo`, `w`, `h`) and when it was sent (`since`), so the
 * same picture and the same wait continue here instead of starting over.
 */
export default function ItemDetectScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ draftId: string; from?: string; photo?: string; w?: string; h?: string; since?: string }>();
  const draftId = params.draftId ?? '';
  const focused = useIsFocused();
  const online = useIsOnline();
  const drafts = useItemDrafts({ enabled: focused });
  const select = useSelectDetected();
  const retry = useRetryDraft();
  const discard = useDiscardDraft();
  const editsVersion = useDetectedEditsVersion();
  // "Ayırmadan üzerimde dene": the same photo (this draft), tried on whole — no need to wait for the detection.
  const wholeTryOn = usePhotoTryOn({ feature: 'tryon_photo_detect' });

  const list = useMemo(() => drafts.data ?? [], [drafts.data]);
  const state = chooserState(list, draftId);
  const source = list.find((d) => d.id === draftId);
  const pieces = useMemo(() => detectedPieces(list, draftId), [list, draftId]);

  // The selection starts with every confident piece ticked; a piece the user edited counts as chosen.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // Read again whenever an edit is saved in 12c (the store bumps `editsVersion`).
  const edited = new Set(editsVersion >= 0 ? pieces.filter((p) => detectedEdits.get(p.id)).map((p) => p.id) : []);
  const selection = resolveSelection(pieces, overrides, edited);

  const [notice, setNotice] = useState<'offline' | 'selectFailed' | null>(null);
  // The wait follows the time since 12 sent the photo; "Tekrar dene" starts it again from now.
  const [since, setSince] = useState(() => Number(params.since) || Date.now());

  // One piece only: no chooser — the review form, as before.
  useEffect(() => {
    if (state === 'single')
      router.replace({
        pathname: '/item/form',
        params: { draftId, ...(params.from ? { from: params.from } : {}) },
      });
  }, [state, draftId, params.from]);

  const manual = () =>
    router.replace({
      pathname: '/item/form',
      params: {
        draftId,
        manual: '1',
        ...(params.from ? { from: params.from } : {}),
      },
    });

  const retryNow = () => {
    setSince(Date.now());
    retry.mutate(draftId);
  };

  const add = () => {
    if (!online) {
      setNotice('offline');
      return;
    }
    setNotice(null);
    select
      .mutateAsync({
        groupId: draftId,
        draftIds: selectedIds(pieces, selection),
      })
      .then(() => toReview(params.from))
      .catch(() => setNotice('selectFailed'));
  };

  const leave = () => {
    discard.discard(draftId);
    detectedEdits.clear(pieces.map((p) => p.id));
    if (router.canGoBack()) router.back();
    else router.replace('/item/add');
  };

  const phase = phaseOf(state);
  // The local file from 12 first (already on screen there, no reload), else the draft's copy.
  const photoUrl = params.photo || source?.imageUrl || null;
  const carriedSize = Number(params.w) > 0 && Number(params.h) > 0 ? { width: Number(params.w), height: Number(params.h) } : null;

  let content;
  if (phase && source) {
    content = (
      <DetectChooser
        phase={phase}
        photoUrl={photoUrl}
        photoSize={source.photoSize ?? carriedSize}
        since={since}
        continued={Boolean(params.since)}
        pieces={pieces}
        selection={selection}
        edited={edited}
        onToggle={(id) => setOverrides((prev) => ({ ...prev, [id]: !selection.has(id) }))}
        onSelectAll={(all) => setOverrides(Object.fromEntries(pieces.map((p) => [p.id, all])))}
        onEdit={(id) =>
          router.push({
            pathname: '/item/form',
            params: { draftId: id, from: 'detect' },
          })
        }
        onAdd={add}
        onDiscard={leave}
        adding={select.isPending}
        notice={notice ? t(`itemDetect.${notice}`) : null}
        onRetry={retryNow}
        onManual={manual}
        retrying={retry.isPending}
        retryDisabled={!online}
        onTryOnWhole={() => wholeTryOn.tryOn({ kind: 'draft', draftId, uri: photoUrl })}
        tryOnBusy={wholeTryOn.busy}
        tryOnNote={wholeTryOn.note}
      />
    );
  } else {
    content = (
      <View className="flex-1" testID="detect-missing">
        <StatePanel title={t('itemDetect.missingTitle')} body={t('itemDetect.missingBody')}>
          <Button label={t('itemDetect.toReview')} onPress={() => toReview(params.from)} />
        </StatePanel>
      </View>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t('itemDetect.title')} leading="back" />
      <ScreenState query={drafts}>{() => content}</ScreenState>
      {wholeTryOn.sheet}
    </Screen>
  );
}
