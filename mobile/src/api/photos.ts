import { useMutation } from '@tanstack/react-query';

import type { PhotoKind } from '@/api/contracts';
import { newClientMutation } from '@/sync/clientMutation';
import type { UploadPhotoVariables } from '@/sync/photoUpload';
import { mutationKeys } from '@/sync/queryKeys';

/** Enqueues photo uploads (persisted; survives offline and restarts). */
export function useEnqueuePhotoUpload() {
  const m = useMutation<void, unknown, UploadPhotoVariables>({ mutationKey: mutationKeys.uploadPhoto });
  return (photo: { uploadId: string; kind: PhotoKind; localUri: string }) =>
    m.mutate({ ...photo, ...newClientMutation() });
}
