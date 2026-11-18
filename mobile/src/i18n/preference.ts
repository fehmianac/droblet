import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n, { isSupportedLanguage, type AppLanguage } from './index';

const KEY = 'droblet.language';

let restoring: Promise<void> | null = null;

async function restore(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (isSupportedLanguage(stored) && stored !== i18n.language) await i18n.changeLanguage(stored);
  } catch {
    // Storage unavailable: the device language stays in effect.
  }
}

/**
 * Applies the language the user picked in 29 Gizlilik ve ayarlar (device-wide, kept across sign-outs).
 * Without a stored choice (first launch) the phone's language stays — when the app supports it, else
 * Turkish (`detectLanguage`). Runs once per app start; later calls await the same restore, so callers
 * (the profile sync) can wait until the app language is final.
 */
export function restoreLanguagePreference(): Promise<void> {
  restoring ??= restore();
  return restoring;
}

/**
 * Switches the app language immediately and remembers the choice on this device. Writing it to the
 * profile (so server content, e-mails and notifications follow) is done by `LanguageSyncHost`, which
 * reacts to every language change with a queued write.
 */
export async function setAppLanguage(language: AppLanguage): Promise<void> {
  await i18n.changeLanguage(language);
  try {
    await AsyncStorage.setItem(KEY, language);
  } catch {
    // The switch still applies for this session.
  }
}

/** Tests only: forget that the preference was restored. */
export function resetLanguagePreferenceForTests(): void {
  restoring = null;
}
