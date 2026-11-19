import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { ImageOff, ScanSearch } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { AiDropPulse, AiProgressLines, AiShimmerImage } from '@/components/ui/ai';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Text } from '@/components/ui/Text';
import {
  chooserState,
  detectedEdits,
  detectedPieces,
  selectedIds,
  resolveSelection,
  useDetectedEditsVersion,
} from '@/features/wardrobe/detect';
import { DetectChooser } from '@/features/wardrobe/DetectChooser';
import { useDiscardDraft, useRetryDraft, useSelectDetected } from '@/features/wardrobe/mutations';
import { StatePanel } from '@/features/wardrobe/parts';
import { useItemDrafts } from '@/features/wardrobe/queries';
import { useIsOnline } from '@/sync/network';

/** Where a finished choice goes: back to the bulk list it came from, otherwise to that list (background removal + confirm). */
function toReview(from: string | undefined) {
  if (from === 'bulk' && router.canGoBack()) router.back();
  else router.replace('/item/bulk');
}

/**
 * Parçaları seç — after one photo (12) or for one photo of a bulk batch (13). States: the photo is still
 * analysed ("Parçalar ayırt ediliyor…", the AI loading language), nothing found ("Bu fotoğrafta parça
 * bulamadık": retry / manual entry), failed, one piece (→ review form 12c, no chooser), several pieces
 * (the chooser), already chosen / gone. "N parçayı ekle" sends the choice: kept pieces get their
 * background removed and appear in the review list (13), the others are discarded and cost nothing.
 */
export default function ItemDetectScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ draftId: string; from?: string }>();
  const draftId = params.draftId ?? '';
  const focused = useIsFocused();
  const online = useIsOnline();
  const drafts = useItemDrafts({ enabled: focused });
  const select = useSelectDetected();
  const retry = useRetryDraft();
  const discard = useDiscardDraft();
  const editsVersion = useDetectedEditsVersion();

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

  let content;
  if (state === 'choose' && source) {
    content = (
      <DetectChooser
        photoUrl={source.imageUrl}
        photoSize={source.photoSize ?? null}
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
      />
    );
  } else if (state === 'processing' || state === 'single') {
    content = (
      <View className="flex-1 gap-5 px-gutter pt-1" accessibilityLiveRegion="polite" testID="detect-processing">
        <View className="items-center">
          <AiShimmerImage className="aspect-[3/4] w-full max-w-[260px] rounded-image-lg" />
        </View>
        <View className="flex-row items-center gap-3">
          <AiDropPulse height={22} />
          <View className="flex-1">
            <AiProgressLines size="compact" lines={[t('itemDetect.analysing'), t('itemDetect.analysingSmall'), t('itemDetect.analysingFields')]} />
          </View>
        </View>
        <Text variant="body" tone="muted">
          {t('itemDetect.analysingBody')}
        </Text>
      </View>
    );
  } else if (state === 'empty') {
    content = (
      <View className="flex-1" testID="detect-empty">
        <StatePanel icon={ScanSearch} title={t('itemDetect.emptyTitle')} body={t('itemDetect.emptyBody')}>
          <Button label={t('itemDetect.retry')} onPress={() => retry.mutate(draftId)} loading={retry.isPending} disabled={!online} testID="detect-retry" />
          <Button variant="secondary" label={t('itemDetect.manual')} onPress={manual} testID="detect-manual" />
        </StatePanel>
      </View>
    );
  } else if (state === 'failed') {
    content = (
      <View className="flex-1" testID="detect-failed">
        <StatePanel icon={ImageOff} title={t('itemDetect.failedTitle')} body={t('itemDetect.failedBody')}>
          <Button label={t('itemDetect.retry')} onPress={() => retry.mutate(draftId)} loading={retry.isPending} disabled={!online} testID="detect-retry" />
          <Button variant="secondary" label={t('itemDetect.manual')} onPress={manual} testID="detect-manual" />
        </StatePanel>
      </View>
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
    </Screen>
  );
}
