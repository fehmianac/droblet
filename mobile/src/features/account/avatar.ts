import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';
import type { PresignedPostWire, ProfileWire } from '@/api/wire/core';
import { deleteLocalPhoto, prepareAvatar } from '@/features/photos/preparePhoto';
import { ulid } from '@/lib/ids';
import { postToPresigned } from '@/sync/photoUpload';

/** A photo picked on "Profili düzenle" (the picker's prepared copy and its size). */
export type PickedAvatar = { localUri: string; width: number; height: number };

/**
 * Profile photo, kept apart from the private body / face photos (`v1/tenant/profile/avatar`):
 * 512 × 512 JPEG made on the device → presigned POST (`upload-url`) → `PUT` makes it the photo
 * (the server strips metadata and checks the size) → the profile with the new `avatarUrl`.
 * Interactive and online-only, like the rest of the edit form.
 */
export async function uploadAvatar(picked: PickedAvatar): Promise<ProfileWire> {
  const square = await prepareAvatar(picked.localUri, picked.width, picked.height);
  try {
    const target = await apiRequest<PresignedPostWire>('v1/tenant/profile/avatar/upload-url', {
      method: 'POST',
      body: { contentType: 'image/jpeg' },
    });
    const status = await postToPresigned(square.localUri, target);
    if (status < 200 || status >= 300) throw new ApiError('http', status, null);
    return await apiRequest<ProfileWire>('v1/tenant/profile/avatar', {
      method: 'PUT',
      body: { uploadId: target.uploadId, clientMutationId: ulid() },
    });
  } finally {
    deleteLocalPhoto(square.localUri);
  }
}

/** `DELETE v1/tenant/profile/avatar` → 204: back to the initial. */
export function removeAvatar(): Promise<void> {
  return apiRequest<void>('v1/tenant/profile/avatar', { method: 'DELETE' });
}
