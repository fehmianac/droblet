import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasSeenPhotoExplainer, markPhotoExplainerSeen, photoExplainerKey } from './photoExplainer';
import { choiceOrder, highlightedChoice, tryFirstStep } from './tryFirst';

describe('12+ / 16g — "Önce üzerimde dene" or "Parçalarına ayır"', () => {
  it('a camera shot keeps detection as the highlighted default; a gallery pick or a share highlights trying on', () => {
    expect(highlightedChoice('camera')).toBe('split');
    expect(highlightedChoice('gallery')).toBe('tryOn');
    expect(highlightedChoice('share')).toBe('tryOn');
  });

  it('both options are always offered, the highlighted one first', () => {
    expect(choiceOrder('camera')).toEqual(['split', 'tryOn']);
    expect(choiceOrder('gallery')).toEqual(['tryOn', 'split']);
    expect(choiceOrder('share')).toEqual(['tryOn', 'split']);
  });

  it('routing: split → detection; try on → 16d the first time, then straight to the credit confirmation', () => {
    expect(tryFirstStep('split', false)).toBe('detect');
    expect(tryFirstStep('split', true)).toBe('detect');
    expect(tryFirstStep('tryOn', false)).toBe('explainer');
    expect(tryFirstStep('tryOn', true)).toBe('confirm');
  });
});

describe('16d explainer — "seen" flag per user, on the phone', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is unseen until marked, and is kept per user', async () => {
    await expect(hasSeenPhotoExplainer('u1')).resolves.toBe(false);
    await markPhotoExplainerSeen('u1');
    await expect(hasSeenPhotoExplainer('u1')).resolves.toBe(true);
    await expect(AsyncStorage.getItem(photoExplainerKey('u1'))).resolves.toBe('seen');
    // Another account on the same phone sees the explainer once too.
    await expect(hasSeenPhotoExplainer('u2')).resolves.toBe(false);
  });

  it('unreadable storage shows the explainer again rather than failing', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(hasSeenPhotoExplainer('u1')).resolves.toBe(false);
  });
});
