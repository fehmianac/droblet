import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { ulid } from '@/lib/ids';

const MAX_EDGE = 2048;

export type PreparedPhoto = { uploadId: string; localUri: string; width: number; height: number };

/**
 * Downscales and re-encodes the picked image as JPEG (re-encoding drops EXIF, including location —
 * it never leaves the device), then copies it into the app's own `documents/uploads/` folder so the
 * queued upload survives even if the user deletes the original from their library.
 *
 * `folder: 'cache'` keeps it in `cache/shared/` instead — an image shared to Droblet from another app stays there until
 * the user chooses what to do with it (canvas 16g); nothing is uploaded before that. When the size is not known (0) the
 * image is rendered once to read it, so the long edge is still capped.
 */
export async function preparePhoto(
  sourceUri: string,
  width: number,
  height: number,
  maxEdge: number = MAX_EDGE,
  folder: 'documents' | 'cache' = 'documents',
): Promise<PreparedPhoto> {
  let w = width;
  let h = height;
  if (!(w > 0) || !(h > 0)) {
    const probe = await ImageManipulator.manipulate(sourceUri).renderAsync();
    w = probe.width;
    h = probe.height;
  }
  const context = ImageManipulator.manipulate(sourceUri);
  const longest = Math.max(w, h);
  if (longest > maxEdge) {
    context.resize(w >= h ? { width: maxEdge } : { height: maxEdge });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });

  const dir = folder === 'cache' ? new Directory(Paths.cache, 'shared') : new Directory(Paths.document, 'uploads');
  dir.create({ intermediates: true, idempotent: true });
  const uploadId = ulid();
  const target = new File(dir, `${uploadId}.jpg`);
  new File(result.uri).moveSync(target);
  return { uploadId, localUri: target.uri, width: result.width, height: result.height };
}

/** Edge of the profile photo. The server does not resample: it refuses anything longer than 1024 px. */
export const AVATAR_EDGE = 512;

/**
 * The profile photo: the centre square, resized to 512 × 512 and re-encoded as JPEG (no EXIF leaves the
 * device). Kept in the cache folder: it is uploaded at once (online-only), never queued.
 */
export async function prepareAvatar(sourceUri: string, width: number, height: number): Promise<{ localUri: string }> {
  const context = ImageManipulator.manipulate(sourceUri);
  const side = Math.min(width, height);
  if (side > 0 && width !== height) {
    context.crop({ originX: Math.floor((width - side) / 2), originY: Math.floor((height - side) / 2), width: side, height: side });
  }
  context.resize({ width: AVATAR_EDGE, height: AVATAR_EDGE });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  return { localUri: result.uri };
}

export function deleteLocalPhoto(localUri: string): void {
  const file = new File(localUri);
  if (file.exists) file.delete();
}
