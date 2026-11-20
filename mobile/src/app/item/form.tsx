import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ItemFields } from '@/api/contracts/wardrobe';
import { AiChipReveal, AiFailure, AiProgressLines, AiShimmerImage } from '@/components/ui/ai';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { detectedEdits } from '@/features/wardrobe/detect';
import { EMPTY_FORM, formFromDraft, formFromItem } from '@/features/wardrobe/form';
import { ItemForm } from '@/features/wardrobe/ItemForm';
import { useAddItems, useRetryDraft, useUpdateItem } from '@/features/wardrobe/mutations';
import { useItemDetail, useItemDrafts } from '@/features/wardrobe/queries';

/** Where the form returns to: back to the bulk review list, otherwise to the wardrobe grid. */
function leave(from: string | undefined) {
  if (from === 'bulk' && router.canGoBack()) router.back();
  else router.dismissTo('/wardrobe');
}

function EditForm({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const query = useItemDetail(itemId);
  const update = useUpdateItem();
  return (
    <ScreenState query={query} notFound={{ message: t('itemDetail.goneTitle'), actionLabel: t('itemDetail.goneAction'), onAction: () => router.dismissTo('/wardrobe') }}>
      {(item) => (
        <ItemForm
          key={item.id}
          mode="edit"
          initial={formFromItem(item)}
          imageUrl={item.imageUrl}
          originalImageUrl={item.originalImageUrl}
          hasOriginalImage={item.hasOriginalImage}
          onSubmit={(fields: ItemFields) => {
            update.update(item, fields);
            if (router.canGoBack()) router.back();
            else router.replace({ pathname: '/item/[id]', params: { id: item.id } });
          }}
        />
      )}
    </ScreenState>
  );
}

function DraftForm({ draftId, from, startManual }: { draftId: string; from: string | undefined; startManual: boolean }) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const drafts = useItemDrafts({ enabled: focused });
  const addItems = useAddItems();
  const retry = useRetryDraft();
  // "Elle doldur": stop waiting for the AI and type the fields in.
  const [manual, setManual] = useState(startManual);
  const draftGone = { message: t('itemForm.draftGone'), actionLabel: t('itemDetail.goneAction'), onAction: () => router.dismissTo('/wardrobe') };

  return (
    <ScreenState query={drafts} notFound={draftGone}>
      {(list) => {
        const draft = list.find((d) => d.id === draftId);
        if (!draft) {
          return <StateMessage testID="state-not-found" role="status" {...draftGone} />;
        }
        const submit = (fields: ItemFields) => {
          addItems.add([{ fields, draftId: draft.id, preview: fields.useOriginalImage ? draft.originalImageUrl : draft.imageUrl, reviewed: true }], 'photo');
          leave(from);
        };

        // A piece found in a multi-item photo, not chosen yet: the form only edits it; the chooser adds it.
        if (draft.status === 'detected') {
          const saved = detectedEdits.get(draft.id);
          return (
            <ItemForm
              key={`${draft.id}-detected`}
              mode="draft"
              initial={saved ? formFromItem(saved) : formFromDraft(draft)}
              imageUrl={draft.imageUrl}
              originalImageUrl={draft.originalImageUrl}
              lowConfidence={saved ? [] : draft.lowConfidence}
              submitLabel={t('itemDetect.saveEdit')}
              onSubmit={(fields) => {
                detectedEdits.set(draft.id, fields);
                if (router.canGoBack()) router.back();
              }}
            />
          );
        }

        if (draft.status === 'ready' || manual) {
          return (
            <ItemForm
              key={`${draft.id}-${draft.status === 'ready' ? 'ai' : 'manual'}`}
              mode={draft.status === 'ready' ? 'draft' : 'manual'}
              initial={draft.status === 'ready' ? formFromDraft(draft) : EMPTY_FORM}
              imageUrl={draft.imageUrl}
              originalImageUrl={draft.originalImageUrl}
              lowConfidence={draft.lowConfidence}
              onSubmit={submit}
            />
          );
        }

        if (draft.status === 'failed') {
          return (
            <View className="flex-1 px-gutter">
              <AiFailure creditRefunded={false} onRetry={() => retry.mutate(draft.id)} retrying={retry.isPending} />
              <View className="gap-2 pb-8">
                <Text variant="caption" tone="muted" className="text-center">
                  {t('itemForm.failedManual')}
                </Text>
                <Button variant="secondary" label={t('itemForm.manual')} onPress={() => setManual(true)} />
              </View>
            </View>
          );
        }

        // Processing: the AI loading language (no spinner) — shimmer on the photo, tags appearing.
        return (
          <View className="flex-1 gap-5 px-gutter pt-1">
            <View className="flex-row gap-4">
              <AiShimmerImage className="h-[164px] w-[132px] rounded-image-lg" />
              <View className="flex-1 justify-center gap-2.5">
                <AiProgressLines size="compact" lines={[t('ai.tagging'), t('itemForm.processingClean'), t('itemForm.processingFields')]} />
                <AiChipReveal labels={[t('itemForm.type'), t('itemForm.color'), t('itemForm.fabric')]} />
              </View>
            </View>
            <Text variant="body" tone="muted">
              {t('itemForm.processingBody')}
            </Text>
            <View className="gap-2.5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-btn-primary w-full rounded-field" />
              ))}
            </View>
            <View className="flex-1" />
            <View className="pb-8">
              <Button variant="secondary" label={t('itemForm.manual')} onPress={() => setManual(true)} />
            </View>
          </View>
        );
      }}
    </ScreenState>
  );
}

/**
 * 12c Parça bilgisi (route). `draftId` → review an AI draft (waits with the AI loading language while
 * it is processing); `itemId` → edit an existing piece; neither → manual entry — with `photoUri` when a photo
 * was already taken (free AI recognition used up), so it is saved with the piece.
 */
export default function ItemFormScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ draftId?: string; itemId?: string; from?: string; photoUri?: string; manual?: string }>();
  // A photo taken before the free AI recognition ran out (402) travels with the manual entry.
  const photoUri = params.photoUri || null;
  const addItems = useAddItems();

  let content;
  if (params.itemId) content = <EditForm itemId={params.itemId} />;
  else if (params.draftId) content = <DraftForm draftId={params.draftId} from={params.from} startManual={params.manual === '1'} />;
  else {
    content = (
      <>
        <ItemForm
          mode="manual"
          initial={EMPTY_FORM}
          imageUrl={photoUri}
          originalImageUrl={photoUri}
          unprocessedPhoto={photoUri !== null}
          onSubmit={(fields) => {
            addItems.add([{ fields: photoUri ? { ...fields, useOriginalImage: true } : fields, draftId: null, photoUri, preview: photoUri }], 'manual');
            leave(params.from);
          }}
        />
      </>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={t(params.itemId ? 'itemForm.titleEdit' : 'itemForm.titleNew')} leading="back" />
      {content}
    </Screen>
  );
}
