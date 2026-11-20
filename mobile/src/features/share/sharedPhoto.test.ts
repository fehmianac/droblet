import AsyncStorage from '@react-native-async-storage/async-storage';

import { redirectSystemPath } from '@/app/+native-intent';

import { firstSharedImage, isShareExtensionLink, SHARED_PHOTO_TTL_MS, sharedPhotoStore, shareStep } from './sharedPhoto';

describe('Share › Droblet — which image', () => {
  it('takes the first image (ACTION_SEND_MULTIPLE / several photos: the first one)', () => {
    expect(
      firstSharedImage([
        { path: 'file:///a.mov', mimeType: 'video/quicktime' },
        { path: 'file:///b.jpg', mimeType: 'image/jpeg', width: 800, height: 1000 },
        { path: 'file:///c.png', mimeType: 'image/png' },
      ]),
    ).toEqual({ path: 'file:///b.jpg', mimeType: 'image/jpeg', width: 800, height: 1000 });
  });

  it('text, links, videos and empty shares are not images', () => {
    expect(firstSharedImage(null)).toBeNull();
    expect(firstSharedImage([])).toBeNull();
    expect(firstSharedImage([{ path: 'file:///a.mp4', mimeType: 'video/mp4' }])).toBeNull();
    expect(firstSharedImage([{ path: null, mimeType: 'image/jpeg' }])).toBeNull();
  });
});

describe('Share › Droblet — when 16g opens', () => {
  it('opens once signed in and onboarded; waits otherwise; nothing when 16g is open or nothing waits', () => {
    expect(shareStep({ pending: true, ready: true, atShare: false })).toBe('open');
    expect(shareStep({ pending: true, ready: false, atShare: false })).toBe('wait');
    expect(shareStep({ pending: true, ready: true, atShare: true })).toBe('none');
    expect(shareStep({ pending: false, ready: true, atShare: false })).toBe('none');
  });

  it('the iOS extension link is routed to 16g, not treated as a screen', () => {
    expect(isShareExtensionLink('droplet://dataUrl=dropletShareKey?nonce=1#media')).toBe(true);
    expect(isShareExtensionLink('droplet://u/damla')).toBe(false);
    expect(redirectSystemPath({ path: 'droplet://dataUrl=dropletShareKey?nonce=1#media', initial: true })).toBe('/share');
  });
});

describe('Share › Droblet — the waiting photo survives a sign-in', () => {
  const photo = { uri: 'file:///cache/shared/a.jpg', width: 1200, height: 1600, receivedAt: 1_000 };

  beforeEach(async () => {
    sharedPhotoStore.reset();
    await AsyncStorage.clear();
  });

  it('is kept on the device and read back after an app restart', async () => {
    await sharedPhotoStore.capture(photo);
    expect(sharedPhotoStore.get()).toEqual(photo);
    // A social sign-in restarted the app: memory is empty, storage is not.
    sharedPhotoStore.reset();
    expect(sharedPhotoStore.get()).toBeNull();
    await sharedPhotoStore.hydrate(2_000);
    expect(sharedPhotoStore.get()).toEqual(photo);
  });

  it('an old share is dropped instead of opening out of context', async () => {
    await sharedPhotoStore.capture(photo);
    sharedPhotoStore.reset();
    await sharedPhotoStore.hydrate(photo.receivedAt + SHARED_PHOTO_TTL_MS + 1);
    expect(sharedPhotoStore.get()).toBeNull();
    await expect(AsyncStorage.getItem('droblet.sharedPhoto')).resolves.toBeNull();
  });

  it('clear() forgets it everywhere', async () => {
    await sharedPhotoStore.capture(photo);
    await sharedPhotoStore.clear();
    expect(sharedPhotoStore.get()).toBeNull();
    await expect(AsyncStorage.getItem('droblet.sharedPhoto')).resolves.toBeNull();
  });
});
