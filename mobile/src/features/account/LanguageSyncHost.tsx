import { useMutationState } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import type { MyProfile, PutProfileLanguageRequest } from '@/api/contracts/account';
import type { AppLanguage } from '@/i18n';
import { restoreLanguagePreference } from '@/i18n/preference';
import { useAppLanguage } from '@/i18n/useAppLanguage';

import { accountMutationKeys, useSaveProfileLanguage } from './mutations';
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
  const profile = useMyProfile();
  const save = useSaveProfileLanguage();
  const [restored, setRestored] = useState(false);
  const lastWrite = useRef<string | null>(null);
  // The language of the newest queued write: a write still waiting is not queued a second time (the
  // profile answer of an earlier write may briefly carry the earlier language).
  const pending = useMutationState({
    filters: { mutationKey: accountMutationKeys.putLanguage, status: 'pending' },
    select: (m) => (m.state.variables as PutProfileLanguageRequest | undefined)?.language ?? null,
  });
  const queuedLanguage = pending.length > 0 ? pending[pending.length - 1] : null;

  useEffect(() => {
    let active = true;
    void restoreLanguagePreference().then(() => {
      if (active) setRestored(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const language = useAppLanguage();
  const data = profile.data;
  useEffect(() => {
    if (!restored || !data) return;
    const next = languageToSync(data, language);
    if (!next || next === queuedLanguage) return;
    // One write per (language, profile version): a failed write is not repeated in a loop.
    const attempt = `${next}:${data.baseVersion}`;
    if (lastWrite.current === attempt) return;
    lastWrite.current = attempt;
    save(next, data.baseVersion);
    // `save` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restored, language, data?.language, data?.baseVersion, queuedLanguage]);

  return null;
}
