import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { track } from '@/analytics/track';
import { toast } from '@/components/ui/toast';

import type { Occasion } from '@/api/contracts';
import type { Look } from '@/api/contracts/looks';
import { ulid } from '@/lib/ids';
import { newClientMutation } from '@/sync/clientMutation';

import { slotList, toSlotInputs, type SlotMap } from './logic';
import { lookMutationKeys, type CreateLookVariables, type DeleteLookVariables, type PutLookVariables } from './mutations';

export type LookDraft = { name: string; occasion: Occasion; slots: SlotMap };

/**
 * Look writes (create / update / favourite / delete). All go through the offline queue with a stable
 * `clientMutationId`; ids are ULIDs made when the user acts. The cache is updated optimistically.
 */
export function useLookWrites() {
  const { t } = useTranslation();
  const create = useMutation<Look, unknown, CreateLookVariables>({ mutationKey: lookMutationKeys.create });
  const put = useMutation<Look, unknown, PutLookVariables>({ mutationKey: lookMutationKeys.put });
  const remove = useMutation<void, unknown, DeleteLookVariables>({ mutationKey: lookMutationKeys.remove });

  const createVariables = (draft: LookDraft): CreateLookVariables => {
    const id = ulid();
    const { clientMutationId, occurredAt } = newClientMutation();
    return {
      request: { id, name: draft.name, occasion: draft.occasion, slots: toSlotInputs(draft.slots), clientMutationId },
      optimistic: {
        id,
        name: draft.name,
        occasion: draft.occasion,
        slots: slotList(draft.slots),
        isFavorite: false,
        rating: null,
        ratingCount: 0,
        tryOnImageUrl: null,
        createdAt: occurredAt,
        baseVersion: 0,
      },
    };
  };
  const putVariables = (look: Look, draft: LookDraft): PutLookVariables => ({
    id: look.id,
    request: {
      name: draft.name,
      occasion: draft.occasion,
      slots: toSlotInputs(draft.slots),
      isFavorite: look.isFavorite,
      baseVersion: look.baseVersion,
      clientMutationId: newClientMutation().clientMutationId,
    },
    optimistic: { ...look, name: draft.name, occasion: draft.occasion, slots: slotList(draft.slots) },
  });

  return {
    /** Returns the new look's id immediately (the write may still be queued). */
    create: (draft: LookDraft): string => {
      const variables = createVariables(draft);
      create.mutate(variables);
      track('look_saved', { source: 'editor' });
      return variables.request.id;
    },
    update: (look: Look, draft: LookDraft): void => {
      put.mutate(putVariables(look, draft));
    },
    /**
     * Saves and resolves once the server holds the look (rejects if the write fails). For an AI job on a look just
     * made: started on the queued id alone, the job could reach the server before the look and fail.
     */
    createNow: async (draft: LookDraft): Promise<string> => {
      const variables = createVariables(draft);
      await create.mutateAsync(variables);
      track('look_saved', { source: 'editor' });
      return variables.request.id;
    },
    updateNow: async (look: Look, draft: LookDraft): Promise<void> => {
      await put.mutateAsync(putVariables(look, draft));
    },
    toggleFavorite: (look: Look): void => {
      const { clientMutationId } = newClientMutation();
      put.mutate({
        id: look.id,
        request: {
          name: look.name,
          occasion: look.occasion,
          slots: look.slots.map(({ slot, source, refId }) => ({ slot, source, refId })),
          isFavorite: !look.isFavorite,
          baseVersion: look.baseVersion,
          clientMutationId,
        },
        optimistic: { ...look, isFavorite: !look.isFavorite },
      });
      toast.success(t(look.isFavorite ? 'feedback.lookbook.removed' : 'feedback.lookbook.added'), {
        icon: look.isFavorite ? 'heart' : 'heartFilled',
        testID: 'toast-lookbook',
      });
    },
    remove: (look: Pick<Look, 'id'>): void => {
      remove.mutate({ id: look.id, clientMutationId: newClientMutation().clientMutationId });
    },
  };
}
