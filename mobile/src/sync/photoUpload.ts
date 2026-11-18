import { File, UploadType } from 'expo-file-system';

import { apiRequest } from '@/api/client';
import type { ConfirmPhotoRequest, PhotoKind, PhotoUploadUrlRequest, PhotoUploadUrlResponse } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import { deleteLocalPhoto } from '@/features/photos/preparePhoto';

import type { ClientMutationMeta } from './clientMutation';

export type UploadPhotoVariables = ClientMutationMeta & {
  uploadId: string;
  kind: PhotoKind;
  localUri: string;
};

async function putToStorage(variables: UploadPhotoVariables) {
  const request: PhotoUploadUrlRequest = { kind: variables.kind, contentType: 'image/jpeg' };
  // The presigned URL is requested at send time, not at enqueue time — it expires.
  const target = await apiRequest<PhotoUploadUrlResponse>('v1/tenant/photo/upload-url', {
    method: 'POST',
    body: request,
  });
  const result = await new File(variables.localUri).upload(target.uploadUrl, {
    httpMethod: 'PUT',
    uploadType: UploadType.BINARY_CONTENT,
    headers: { 'Content-Type': 'image/jpeg' },
  });
  return { target, status: result.status };
}

/**
 * Queued photo upload: get URL → PUT to S3 → confirm. A 403 (expired URL) gets one fresh URL.
 * The local copy is deleted only after the server confirmed the photo.
 */
export async function uploadPhoto(variables: UploadPhotoVariables): Promise<void> {
  let attempt = await putToStorage(variables);
  if (attempt.status === 403) attempt = await putToStorage(variables);
  if (attempt.status < 200 || attempt.status >= 300) {
    throw new ApiError('http', attempt.status, null);
  }
  const confirm: ConfirmPhotoRequest = {
    photoId: attempt.target.photoId,
    clientMutationId: variables.clientMutationId,
  };
  await apiRequest<void>(`v1/tenant/photo/${variables.kind}`, { method: 'PUT', body: confirm });
  deleteLocalPhoto(variables.localUri);
}
