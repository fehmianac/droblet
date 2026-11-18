import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The invite code from the link that brought the user here, kept on the device until an account
 * exists (the link may be opened before sign-up). Device-wide on purpose: there is no user yet.
 */
const KEY = 'droblet.pendingInvite';

const listeners = new Set<() => void>();

export const inviteStore = {
  async capture(code: string): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, code);
    } catch {
      // Without storage the invite is simply not attributed.
    }
    listeners.forEach((l) => l());
  },
  /** Returns the pending code and clears it, so it is applied at most once. */
  async take(): Promise<string | null> {
    try {
      const code = await AsyncStorage.getItem(KEY);
      if (code) await AsyncStorage.removeItem(KEY);
      return code;
    } catch {
      return null;
    }
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
