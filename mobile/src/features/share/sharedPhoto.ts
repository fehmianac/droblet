import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

/**
 * The image shared to Droblet from another app (Share › Droblet: Instagram, Pinterest, Safari, Photos…), prepared on the
 * device (long edge 2048, JPEG re-encoded — the same as every picked photo) and kept in the app's cache until the user
 * chooses what to do with it on 16g. Nothing is uploaded before that choice.
 *
 * Device-wide, not per user, on purpose: the share may arrive signed out ("Fotoğrafın hazır", 16h). The file path is
 * persisted so a sign-in that restarts the app (social sign-in) still finds it.
 */
export type SharedPhoto = { uri: string; width: number; height: number; receivedAt: number };

const KEY = 'droblet.sharedPhoto';
/** A shared photo older than this is dropped instead of opening out of context the next day. */
export const SHARED_PHOTO_TTL_MS = 6 * 60 * 60 * 1000;

let current: SharedPhoto | null = null;
let hydrated = false;
const listeners = new Set<() => void>();

function emit(next: SharedPhoto | null) {
  current = next;
  listeners.forEach((l) => l());
}

function fresh(photo: SharedPhoto | null, now: number): SharedPhoto | null {
  return photo && now - photo.receivedAt < SHARED_PHOTO_TTL_MS ? photo : null;
}

export const sharedPhotoStore = {
  get: (): SharedPhoto | null => current,
  isHydrated: () => hydrated,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Reads a share kept from an earlier run (signed out → sign-in restarted the app). */
  async hydrate(now: number = Date.now()): Promise<void> {
    if (hydrated) return;
    hydrated = true;
    if (current) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const stored = fresh(raw ? (JSON.parse(raw) as SharedPhoto) : null, now);
      if (stored && !current) emit(stored);
      else if (raw && !stored) await AsyncStorage.removeItem(KEY);
    } catch {
      // Unreadable: nothing to resume.
    }
  },
  async capture(photo: SharedPhoto): Promise<void> {
    emit(photo);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(photo));
    } catch {
      // Kept for this run only.
    }
  },
  /** The user chose (or closed 16g): the share is handled. The file stays in the cache for the next screen. */
  async clear(): Promise<void> {
    emit(null);
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Nothing stored.
    }
  },
  /** Tests. */
  reset() {
    current = null;
    hydrated = false;
    listeners.clear();
  },
};

export function useSharedPhoto(): SharedPhoto | null {
  return useSyncExternalStore(sharedPhotoStore.subscribe, sharedPhotoStore.get, sharedPhotoStore.get);
}

/** One file of a share intent (expo-share-intent's `ShareIntentFile`, only what is read here). */
export type IncomingShareFile = { path: string | null; mimeType: string | null; width?: number | null; height?: number | null };

/**
 * The image to use from a share: the first image file (Android ACTION_SEND_MULTIPLE / several photos on iOS: the first
 * one). Text, links and videos are not images: `null`.
 */
export function firstSharedImage(files: IncomingShareFile[] | null | undefined): IncomingShareFile | null {
  return files?.find((f) => Boolean(f.path) && (f.mimeType ?? '').toLowerCase().startsWith('image/')) ?? null;
}

/**
 * What to do with a waiting shared photo:
 * - `none`: nothing waiting, or 16g is already open;
 * - `wait`: signed out / onboarding not finished — the photo waits on the device ("Fotoğrafın hazır", 16h);
 * - `open`: open 16g.
 */
export type ShareStep = 'none' | 'wait' | 'open';

export function shareStep({ pending, ready, atShare }: { pending: boolean; ready: boolean; atShare: boolean }): ShareStep {
  if (!pending || atShare) return 'none';
  return ready ? 'open' : 'wait';
}

/** iOS: the share extension opens the app with `droplet://dataUrl=<scheme>ShareKey…`; it is not a screen. */
export function isShareExtensionLink(path: string): boolean {
  return /(^|[/:])dataUrl=/i.test(path);
}
