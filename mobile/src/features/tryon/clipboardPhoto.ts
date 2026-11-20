import * as Clipboard from 'expo-clipboard';
import { Directory, File, Paths } from 'expo-file-system';

import { preparePhoto, type PreparedPhoto } from '@/features/photos/preparePhoto';
import { ulid } from '@/lib/ids';

/**
 * 16c+ "Kopyaladığın fotoğrafı üzerimde dene". Two steps, on purpose:
 * - `clipboardHasImage` only asks whether the clipboard holds an image. It does not read it, so iOS shows no paste
 *   banner and nothing about the content reaches the app.
 * - `readClipboardPhoto` reads the image — only after the user tapped the card (iOS may then show its paste prompt).
 *   It is written to the app's cache and prepared like every picked photo (long edge 2048, JPEG re-encoded).
 */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

export async function readClipboardPhoto(): Promise<PreparedPhoto | null> {
  const image = await Clipboard.getImageAsync({ format: 'jpeg', jpegQuality: 0.95 });
  if (!image?.data) return null;
  const base64 = image.data.replace(/^data:[^,]*,/, '');
  const dir = new Directory(Paths.cache, 'shared');
  dir.create({ intermediates: true, idempotent: true });
  const raw = new File(dir, `clipboard-${ulid()}.jpg`);
  raw.write(base64, { encoding: 'base64' });
  try {
    return await preparePhoto(raw.uri, image.size?.width ?? 0, image.size?.height ?? 0, undefined, 'cache');
  } finally {
    if (raw.exists) raw.delete();
  }
}

/** "×" hides the card until the app next comes back from the background (a new copy is likely by then). */
let dismissed = false;

export const clipboardCardDismissal = {
  isDismissed: () => dismissed,
  dismiss: () => {
    dismissed = true;
  },
  reset: () => {
    dismissed = false;
  },
};
