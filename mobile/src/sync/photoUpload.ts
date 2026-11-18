import { File, UploadType } from 'expo-file-system';

import { apiRequest } from '@/api/client';
import type { PhotoKind, PhotoUploadUrlRequest } from '@/api/contracts';
import { ApiError } from '@/api/errors';
import type { ActivatePhotoWire, PhotoWire, PresignedPostWire } from '@/api/wire/core';
import { deleteLocalPhoto } from '@/features/photos/preparePhoto';

import type { ClientMutationMeta } from './clientMutation';

export type UploadPhotoVariables = ClientMutationMeta & {
  uploadId: string;
  kind: PhotoKind;
  localUri: string;
};

/**
 * Sends a local file to a presigned S3 **POST**: a multipart form with every entry of `fields`
 * first and the file last, as the field `file`. S3 answers 204 (or 201). Shared by profile photos
 * and garment photos (`v1/tenant/item/upload-url`).
 */
export async function postToPresigned(localUri: string, target: Pick<PresignedPostWire, 'url' | 'fields'>): Promise<number> {
  const result = await new File(localUri).upload(target.url, {
    httpMethod: 'POST',
    uploadType: UploadType.MULTIPART,
    fieldName: 'file',
    mimeType: target.fields['Content-Type'] ?? 'image/jpeg',
    parameters: target.fields,
  });
  return result.status;
}

async function sendToStorage(variables: UploadPhotoVariables) {
  const request: PhotoUploadUrlRequest = { kind: variables.kind, contentType: 'image/jpeg' };
  // The presigned form is requested at send time, not at enqueue time — it expires.
  const target = await apiRequest<PresignedPostWire>('v1/tenant/photo/upload-url', { method: 'POST', body: request });
  return { target, status: await postToPresigned(variables.localUri, target) };
}

/**
 * Queued photo upload: get the presigned form → POST to S3 → activate. A 403 (expired form) gets
 * one fresh form. The local copy is deleted only after the server confirmed the photo.
 */
export async function uploadPhoto(variables: UploadPhotoVariables): Promise<void> {
  let attempt = await sendToStorage(variables);
  if (attempt.status === 403) attempt = await sendToStorage(variables);
  if (attempt.status < 200 || attempt.status >= 300) {
    throw new ApiError('http', attempt.status, null);
  }
  const confirm: ActivatePhotoWire = {
    uploadId: attempt.target.uploadId,
    clientMutationId: variables.clientMutationId,
  };
  await apiRequest<PhotoWire>(`v1/tenant/photo/${variables.kind}`, { method: 'PUT', body: confirm });
  deleteLocalPhoto(variables.localUri);
}
