import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n, { isAppLanguage, type AppLanguage } from './index';

const KEY = 'droblet.language';

/** Applies the language the user picked in 29 Gizlilik ve ayarlar (device-wide, kept across sign-outs). */
export async function restoreLanguagePreference(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (isAppLanguage(stored) && stored !== i18n.language) await i18n.changeLanguage(stored);
  } catch {
    // Storage unavailable: the device language stays in effect.
  }
}

/**
 * Switches the app language immediately and remembers the choice on this device. Saving it to the
 * profile (so server content, e-mails and notifications follow) is the caller's queued write.
 */
export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    await AsyncStorage.setItem(KEY, language);
  } catch {
    // The switch still applies for this session.
  }
}
