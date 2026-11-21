import type { AgeBand, ParentalConsentStatus, TeenConfig, TeenState } from '@/api/contracts/teen';

/**
 * Try-on for this account (canvas 18 · 14b / 22t):
 * - `open`: the normal flow (adults; teens with flag + parent box — the teen explainer and own consent come first);
 * - `limited`: parent approval still missing ("Velinin onayıyla açılır", with the status link);
 * - `needsParent`: approved, but the parent did not tick try-on ("Velinin onayıyla açılır" + "Velime yeniden gönder");
 * - `unavailable`: `Teen:TryOnEnabled` is off ("Şu an kullanılamıyor").
 */
export type TryOnAccess = 'open' | 'limited' | 'needsParent' | 'unavailable';

export type TeenRules = {
  /** `unknown` until the server said (Apple / Google before the age step, or an old server): treated as adult. */
  band: AgeBand | 'unknown';
  isTeen: boolean;
  /** `none` for adults. */
  consent: ParentalConsentStatus;
  /** Teen without an approval: photo and AI features are locked (canvas 18 · 06 / 16). */
  limited: boolean;
  /** Teen who never sent the parent e-mail: 02i comes before the app. */
  needsParentEmail: boolean;
  /** Surfaces that are not drawn at all for teens (canvas 18 · "Gizlenen yüzeyler"). */
  hide: {
    social: boolean;
    commerce: boolean;
    paywall: boolean;
    analytics: boolean;
    marketing: boolean;
    outfitPhotoTryOn: boolean;
    sponsored: boolean;
  };
  tryOn: TryOnAccess;
  /** Teen try-on is open but the teen's own `teenTryOn` consent is missing: the 22t explainer asks for it. */
  needsOwnTryOnConsent: boolean;
};

/**
 * The single source of the teen UI. Server values decide (`ageBand`, `teen`, config); the client only hides.
 * `sessionBand` is the band remembered with the session, used until the first answer of this app start.
 */
export function teenRules(state: TeenState | null, config: TeenConfig, sessionBand?: AgeBand | null): TeenRules {
  const band: AgeBand | 'unknown' = state?.ageBand ?? sessionBand ?? 'unknown';
  const isTeen = band === 'teen';
  const teen = isTeen ? (state?.teen ?? null) : null;
  // A teen whose status has not arrived yet stays limited (the server answers 403 anyway).
  const consent: ParentalConsentStatus = isTeen ? (teen?.consent ?? 'pending') : 'none';
  const limited = isTeen && consent !== 'approved';
  const hidden = isTeen;

  let tryOn: TryOnAccess = 'open';
  let needsOwnTryOnConsent = false;
  if (isTeen) {
    const verdict = teen?.tryOn ?? null;
    const reason = verdict?.available ? null : (verdict?.reason ?? null);
    if (limited || reason === 'consent_not_active') tryOn = 'limited';
    else if (verdict) {
      // The server's verdict wins over the (cached) config: it already combines the flag, the parent box and the own consent.
      if (reason === 'feature_off') tryOn = 'unavailable';
      else if (reason === 'parent_not_allowed') tryOn = 'needsParent';
      else needsOwnTryOnConsent = reason === 'own_consent_missing';
    } else if (!config.tryOnEnabled) tryOn = 'unavailable';
    else if (!teen?.parentAllowedTryOn) tryOn = 'needsParent';
    else needsOwnTryOnConsent = !teen.ownTryOnConsent;
  }

  return {
    band,
    isTeen,
    consent,
    limited,
    needsParentEmail: isTeen && consent === 'none',
    hide: {
      social: hidden,
      commerce: hidden,
      paywall: hidden,
      analytics: hidden,
      marketing: hidden,
      outfitPhotoTryOn: hidden,
      sponsored: hidden,
    },
    tryOn,
    needsOwnTryOnConsent,
  };
}
