import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ItemFields } from '@/api/contracts/wardrobe';
import { AiChipReveal, AiFailure, AiProgressLines, AiShimmerImage } from '@/components/ui/ai';
import { Button } from '@/components/ui/Button';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { Screen } from '@/components/ui/Screen';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { ScreenState } from '@/components/ui/ScreenState';
import { Skeleton } from '@/components/ui/Skeleton';
import { StateMessage } from '@/components/ui/StateMessage';
import { Text } from '@/components/ui/Text';
import { EMPTY_FORM, formFromDraft, formFromItem } from '@/features/wardrobe/form';
import { ItemForm } from '@/features/wardrobe/ItemForm';
import { useAddItems, useRetryDraft, useUpdateItem } from '@/features/wardrobe/mutations';
import { useItemDetail, useItemDrafts } from '@/features/wardrobe/queries';

function FormSkeleton() {
  return (
    <View className="gap-5 px-gutter pt-1">
      <View className="flex-row gap-4">
        <Skeleton className="h-[164px] w-[132px] rounded-image-lg" />
        <View className="flex-1 justify-center gap-2">
          <Skeleton className="h-3 w-32 rounded-field" />
          <Skeleton className="h-7 w-40 rounded-pill" />
        </View>
      </View>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} className="gap-1.5">
          <Skeleton className="h-3 w-20 rounded-field" />
          <Skeleton className="h-btn-primary w-full rounded-field" />
        </View>
      ))}
    </View>
  );
}

/** Where the form returns to: back to the bulk review list, otherwise to the wardrobe grid. */
function leave(from: string | undefined) {
  if (from === 'bulk' && router.canGoBack()) router.back();
  else router.dismissTo('/wardrobe');
}

function EditForm({ itemId }: { itemId: string }) {
  const query = useItemDetail(itemId);
  const update = useUpdateItem();
  return (
    <ScreenState query={query} skeleton={<FormSkeleton />}>
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

function DraftForm({ draftId, from }: { draftId: string; from: string | undefined }) {
  const { t } = useTranslation();
  const focused = useIsFocused();
  const drafts = useItemDrafts({ enabled: focused });
  const addItems = useAddItems();
  const retry = useRetryDraft();
  // "Elle doldur": stop waiting for the AI and type the fields in.
  const [manual, setManual] = useState(false);

  return (
    <ScreenState query={drafts} skeleton={<FormSkeleton />}>
      {(list) => {
        const draft = list.find((d) => d.id === draftId);
        if (!draft) {
          return <StateMessage message={t('itemForm.draftGone')} actionLabel={t('itemDetail.goneAction')} onAction={() => router.dismissTo('/wardrobe')} />;
        }
        const submit = (fields: ItemFields) => {
          addItems.add([{ fields, draftId: draft.id, preview: fields.useOriginalImage ? draft.originalImageUrl : draft.imageUrl, reviewed: true }]);
          leave(from);
        };

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
  const params = useLocalSearchParams<{ draftId?: string; itemId?: string; from?: string; photoUri?: string }>();
  // A photo taken before the free AI recognition ran out (402) travels with the manual entry.
  const photoUri = params.photoUri || null;
  const addItems = useAddItems();

  let content;
  if (params.itemId) content = <EditForm itemId={params.itemId} />;
  else if (params.draftId) content = <DraftForm draftId={params.draftId} from={params.from} />;
  else {
    content = (
      <>
        <OfflineBanner />
        <ItemForm
          mode="manual"
          initial={EMPTY_FORM}
          imageUrl={photoUri}
          originalImageUrl={photoUri}
          unprocessedPhoto={photoUri !== null}
          onSubmit={(fields) => {
            addItems.add([{ fields: photoUri ? { ...fields, useOriginalImage: true } : fields, draftId: null, photoUri, preview: photoUri }]);
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
