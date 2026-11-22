import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Look'unu Akışta paylaş" is confirmed once per account on this phone (canvas 14b · Akışta paylaş, decision 17):
 * the first share shows the sheet with its four sentences, later looks are shared straight from the switch.
 */
export const feedShareConfirmedKey = (userId: string) => `droblet.feedShare.confirmed.${userId}`;

export async function hasConfirmedFeedShare(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await AsyncStorage.getItem(feedShareConfirmedKey(userId))) === '1';
  } catch {
    // Without storage the sheet simply shows again.
    return false;
  }
}

export async function markFeedShareConfirmed(userId: string | null): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(feedShareConfirmedKey(userId), '1');
  } catch {
    // The sheet shows once more next time; nothing else is lost.
  }
}
