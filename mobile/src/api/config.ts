import Constants from 'expo-constants';

type Extra = {
  apiBaseUrl?: string | null;
  linkDomain?: string | null;
  termsUrl?: string | null;
  privacyUrl?: string | null;
  googleClientIds?: { ios?: string | null; android?: string | null; web?: string | null };
};

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

/** API base URL from Expo config (env `DROBLET_API_BASE_URL`). Never hard-coded. */
export function apiBaseUrl(): string | null {
  const url = extra().apiBaseUrl;
  return url ? url.replace(/\/+$/, '') : null;
}

export function legalUrls(): { terms: string | null; privacy: string | null } {
  return { terms: extra().termsUrl ?? null, privacy: extra().privacyUrl ?? null };
}

export function googleClientIds(): { ios: string | null; android: string | null; web: string | null } {
  const ids = extra().googleClientIds ?? {};
  return { ios: ids.ios ?? null, android: ids.android ?? null, web: ids.web ?? null };
}

/** Domain of shared links (`https://{domain}/l/…`, `/u/…`, `/invite/…`). */
export function linkDomain(): string {
  return extra().linkDomain ?? 'droblet.alatech.co';
}
