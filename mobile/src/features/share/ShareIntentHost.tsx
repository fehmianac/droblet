import { router, usePathname } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';

import { showToast } from '@/components/ui/toast/store';
import { preparePhoto } from '@/features/photos/preparePhoto';

import { firstSharedImage, sharedPhotoStore, shareStep, useSharedPhoto } from './sharedPhoto';

const MAX_EDGE = 2048;

/**
 * Share › Droblet. Receives the image another app shared — cold start (the app was closed) and warm start (it was in
 * the background) alike, through expo-share-intent (iOS: the Share Extension hands the file over through the App Group;
 * Android: ACTION_SEND / ACTION_SEND_MULTIPLE `image/*`, the first image) — prepares it into the cache, and opens 16g
 * once the user is signed in and onboarded. Signed out, the photo waits ("Fotoğrafın hazır", 16h) and 16g opens right
 * after sign-in. No network here: nothing leaves the phone until the user chooses on 16g.
 */
export function ShareIntentHost({ signedIn, ready }: { signedIn: boolean; ready: boolean }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ resetOnBackground: false, disabled: Platform.OS === 'web' });
  const pending = useSharedPhoto();
  const handling = useRef(false);

  useEffect(() => {
    void sharedPhotoStore.hydrate();
  }, []);

  // A new share: keep the first image in the cache, then clear the native side so it is not handled twice.
  useEffect(() => {
    if (!hasShareIntent || handling.current) return;
    handling.current = true;
    const file = firstSharedImage(shareIntent.files);
    void (async () => {
      try {
        if (!file?.path) {
          showToast({ message: t('shareIn.notImage'), tone: 'error' });
          return;
        }
        const photo = await preparePhoto(file.path, file.width ?? 0, file.height ?? 0, MAX_EDGE, 'cache');
        await sharedPhotoStore.capture({ uri: photo.localUri, width: photo.width, height: photo.height, receivedAt: Date.now() });
        if (!signedIn) showToast({ message: `${t('shareIn.waitTitle')}. ${t('shareIn.waitBody')}` });
      } catch {
        showToast({ message: t('shareIn.failed'), tone: 'error' });
      } finally {
        resetShareIntent();
        handling.current = false;
      }
    })();
  }, [hasShareIntent, shareIntent, resetShareIntent, signedIn, t]);

  // Signed in and onboarded (also right after a sign-in): open 16g with the waiting photo.
  const step = shareStep({ pending: pending !== null, ready, atShare: pathname === '/share' });
  useEffect(() => {
    if (step === 'open') router.push('/share');
  }, [step]);

  return null;
}
