/**
 * Teen mode (16–17 with verified parental consent; docs/api/teen.md, canvas 18). The age band is separate from the
 * clothing segment ("reyon"): a teen has women's or men's content with the teen rules on top.
 */
export type AgeBand = 'adult' | 'teen';

/**
 * The parent's approval, in the app's words. `none` = no e-mail sent yet (the teen must enter one), `pending` = sent,
 * waiting (also an expired link: `requestState` says which), `approved` lifts limited mode, `declined` / `withdrawn`
 * keep it (a new request may be sent).
 */
export type ParentalConsentStatus = 'none' | 'pending' | 'approved' | 'declined' | 'withdrawn';

/** Why try-on is closed for a teen right now (server `teen.tryOn.reason`). */
export type TeenTryOnReason = 'feature_off' | 'consent_not_active' | 'parent_not_allowed' | 'own_consent_missing';

export type TeenAccount = {
  consent: ParentalConsentStatus;
  /** State of the e-mailed link: never sent, sent (7 days), expired. */
  requestState: 'none' | 'sent' | 'expired';
  /** "a***@g***.com" — the app never sees the full parent address after sending. */
  parentEmailMasked: string | null;
  /** When "Tekrar gönder" opens again (1 per minute on the server). */
  resendAvailableAt: string | null;
  /** The parent ticked the separate try-on box. */
  parentAllowedTryOn: boolean;
  /** The teen's own `teenTryOn` consent. */
  ownTryOnConsent: boolean;
  /** Text version to send with the `teenTryOn` grant (server's current). */
  ownTryOnConsentVersion: string | null;
  /** Server verdict on try-on (flag + parent box + own consent); null = the server did not say. */
  tryOn: { available: boolean; reason: TeenTryOnReason | null } | null;
  /** The day the account becomes adult (YYYY-MM-DD). */
  adultFrom: string | null;
  /** The free-tier stylist allowance of an approved teen (`Teen:Stylist`, §4.2); null = the server did not say. */
  stylist: TeenStylistAllowance | null;
};

/**
 * `teen.stylist` (docs/api/teen.md §4.2). Days and weeks are Europe/Istanbul; `resetsAt` / `weekResetsAt` are UTC
 * instants. A limit of 0 (or `enabled: false`) = that part of the stylist is off for teens. `used*` include running jobs.
 */
export type TeenStylistAllowance = {
  enabled: boolean;
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
  resetsAt: string | null;
  weekPlanLimit: number;
  weekPlanUsed: number;
  weekPlanRemaining: number;
  weekResetsAt: string | null;
  tripPackLimit: number;
  tripPackRemaining: number;
};

/** `GET v1/tenant/teen` and the profile's `ageBand` + `teen`. `ageBand: null` = not given yet (Apple / Google before the age step). */
export type TeenState = { ageBand: AgeBand | null; teen: TeenAccount | null };

/** `GET v1/config` → `teen`. Absent on older servers: teen sign-up closed, try-on off. */
export type TeenConfig = { enabled: boolean; tryOnEnabled: boolean; minimumAge: number; adultAge: number };

export const DEFAULT_TEEN_CONFIG: TeenConfig = { enabled: false, tryOnEnabled: false, minimumAge: 16, adultAge: 18 };
