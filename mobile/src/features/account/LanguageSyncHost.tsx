import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { MyProfile } from '@/api/contracts/account';
import { currentLanguage, type AppLanguage } from '@/i18n';
import { restoreLanguagePreference } from '@/i18n/preference';

import { useSaveProfileLanguage } from './mutations';
import { useMyProfile } from './queries';

/**
 * The language to write to the profile, or null when nothing has to be written. The device choice
 * wins (owner decision 2026-11-18): whenever the app language differs from the profile's — first
 * sign-in on this phone, a switch in 29, a switch made while the profile was not loaded — the app
 * language is saved, never the other way round.
 */
export function languageToSync(profile: Pick<MyProfile, 'language'> | undefined, appLanguage: AppLanguage): AppLanguage | null {
  if (!profile) return null;
  return profile.language === appLanguage ? null : appLanguage;
}

/**
 * THE writer of the profile language (signed-in users only; mounted once in `AppHosts`).
 * Runs after sign-in / app start once the stored preference is restored, and again on every language
 * change. The write is the queued, versioned `PUT v1/tenant/profile` (partial, `language` only), so
 * it also goes through when the change was made offline.
 */
export function LanguageSyncHost() {
  const { i18n } = useTranslation();
  const profile = useMyProfile();
  const save = useSaveProfileLanguage();
  const [restored, setRestored] = useState(false);
  const lastWrite = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    void restoreLanguagePreference().then(() => {
      if (active) setRestored(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const language = i18n.language;
  const data = profile.data;
  useEffect(() => {
    if (!restored || !data) return;
    const next = languageToSync(data, currentLanguage());
    if (!next) return;
    // One write per (language, profile version): a failed write is not repeated in a loop.
    const attempt = `${next}:${data.baseVersion}`;
    if (lastWrite.current === attempt) return;
    lastWrite.current = attempt;
    save(next, data.baseVersion);
    // `save` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, language, data?.language, data?.baseVersion]);

  return null;
}
