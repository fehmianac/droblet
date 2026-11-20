import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { useSession } from '@/auth/session';

/**
 * 16d "Kombin fotoğrafı" is an explainer the first time only (canvas 16, n_paylas): afterwards a picked photo goes
 * straight to the choice and the credit confirmation over the photo (16d′). The "seen" flag is per user and stays on
 * this phone — nothing is sent anywhere.
 */
export const photoExplainerKey = (userId: string) => `droblet.tryonPhotoExplainer.${userId}`;

export async function hasSeenPhotoExplainer(userId: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(photoExplainerKey(userId))) === 'seen';
  } catch {
    // Without storage the explainer simply shows again; nothing is lost.
    return false;
  }
}

export async function markPhotoExplainerSeen(userId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(photoExplainerKey(userId), 'seen');
  } catch {
    // Shown again next time; nothing is lost.
  }
}

/** Whether the signed-in user has seen 16d: `null` while it is being read (or signed out). */
export function usePhotoExplainerSeen(): boolean | null {
  const session = useSession();
  const userId = session.status === 'signedIn' ? session.user.id : null;
  const [state, setState] = useState<{ userId: string; seen: boolean } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    void hasSeenPhotoExplainer(userId).then((seen) => alive && setState({ userId, seen }));
    return () => {
      alive = false;
    };
  }, [userId]);
  return userId && state?.userId === userId ? state.seen : null;
}
