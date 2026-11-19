/**
 * Açık rıza kayıtları (docs/legal: Açık Rıza Metinleri 1–7) — `GET/PUT v1/tenant/consents`.
 *
 * The server keeps the current state per type plus an append-only history. `valid` = granted on the
 * text version the server currently requires: that is what it enforces (403 `consent_required`
 * with `missing: ConsentType[]`), so a new text version makes it false and the app asks again.
 */
export const CONSENT_TYPES = [
  'bodyPhotoAi',
  'facePhotoPalette',
  'weight',
  'contacts',
  'marketingNotifications',
  'crossBorderTransfer',
  'facePhotoTryOn',
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/**
 * The version of the texts BUNDLED in this app build (`src/i18n/features/{tr,en}/consent.json`,
 * copied from landing/content `legal.docs.consents`). Sent with every grant: the server answers 409
 * `consent_version_outdated` when it requires a newer text than the one the user read.
 */
export const CONSENT_TEXT_VERSION: Record<ConsentType, string> = {
  bodyPhotoAi: '2026-11-19',
  facePhotoPalette: '2026-11-19',
  weight: '2026-11-19',
  contacts: '2026-11-19',
  marketingNotifications: '2026-11-19',
  crossBorderTransfer: '2026-11-19',
  facePhotoTryOn: '2026-11-19',
};

/** Where in the app the decision was taken (stored with the record). */
export type ConsentSource =
  | 'tryon'
  | 'body_photo'
  | 'face_photo'
  | 'palette'
  | 'weight'
  | 'contacts'
  | 'marketing_card'
  | 'notifications'
  | 'settings'
  | 'onboarding'
  | 'requirements'
  | 'server';

export type ConsentRecord = {
  type: ConsentType;
  granted: boolean;
  /** Text version of the last decision; null = never decided. */
  version: string | null;
  currentVersion: string;
  valid: boolean;
  grantedAt: string | null;
  withdrawnAt: string | null;
  locale: string | null;
  source: string | null;
};

/** GET v1/tenant/consents — always all seven types. */
export type ConsentState = { consents: ConsentRecord[] };

/** PUT v1/tenant/consents → `ConsentState`. Granting needs `version === currentVersion` (409 `consent_version_outdated`). */
export type PutConsentsRequest = {
  consents: { type: ConsentType; granted: boolean; version: string }[];
  source: ConsentSource;
  locale: string;
};

/** What each feature needs (the server enforces the same sets). */
export const CONSENTS_FOR = {
  bodyPhoto: ['bodyPhotoAi', 'crossBorderTransfer'],
  tryOn: ['bodyPhotoAi', 'crossBorderTransfer'],
  /** "Üzerimde gör" without a body photo: the face photo + the chosen body type (consent 7, new purpose). */
  tryOnFace: ['facePhotoTryOn', 'crossBorderTransfer'],
  facePhoto: ['facePhotoPalette', 'crossBorderTransfer'],
  palette: ['facePhotoPalette', 'crossBorderTransfer'],
  weight: ['weight'],
  contacts: ['contacts'],
  marketing: ['marketingNotifications'],
} as const satisfies Record<string, readonly ConsentType[]>;

export function isConsentType(value: unknown): value is ConsentType {
  return typeof value === 'string' && (CONSENT_TYPES as readonly string[]).includes(value);
}
