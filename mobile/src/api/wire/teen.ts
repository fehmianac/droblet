import {
  DEFAULT_TEEN_CONFIG,
  type AgeBand,
  type ParentalConsentStatus,
  type TeenAccount,
  type TeenConfig,
  type TeenState,
  type TeenTryOnReason,
} from '../contracts/teen';

/** docs/api/teen.md §5 — `teen` on the profile and on `GET v1/tenant/teen`; null for adults. */
export type TeenWire = {
  status: 'pendingParentalConsent' | 'active' | 'declined' | 'withdrawn';
  request?: {
    state: 'none' | 'sent' | 'expired';
    parentEmailMasked?: string | null;
    sentAt?: string | null;
    expiresAt?: string | null;
    resendAvailableAt?: string | null;
  } | null;
  approvedAt?: string | null;
  parentAllowedTryOn?: boolean;
  ownTryOnConsent?: boolean;
  /** The current text version of the teen's own `teenTryOn` consent (sent back with the grant). */
  ownTryOnConsentVersion?: string | null;
  tryOn?: { available: boolean; reason?: TeenTryOnReason | null } | null;
  adultFrom?: string | null;
  restrictions?: string[];
};

/** `GET v1/tenant/teen`, `POST v1/tenant/teen/parental-consent(/resend)` (202). */
export type TeenStateWire = { ageBand: AgeBand | null; teen: TeenWire | null };

/** `GET v1/config` → `teen` (§2). */
export type TeenConfigWire = { enabled?: boolean; minimumAge?: number; adultAge?: number; tryOnEnabled?: boolean } | null;

export function toTeenAccount(wire: TeenWire): TeenAccount {
  const requestState = wire.request?.state ?? 'none';
  const consent: ParentalConsentStatus =
    wire.status === 'active'
      ? 'approved'
      : wire.status === 'declined'
        ? 'declined'
        : wire.status === 'withdrawn'
          ? 'withdrawn'
          : requestState === 'none'
            ? 'none'
            : 'pending';
  return {
    consent,
    requestState,
    parentEmailMasked: wire.request?.parentEmailMasked ?? null,
    resendAvailableAt: wire.request?.resendAvailableAt ?? null,
    parentAllowedTryOn: wire.parentAllowedTryOn ?? false,
    ownTryOnConsent: wire.ownTryOnConsent ?? false,
    ownTryOnConsentVersion: wire.ownTryOnConsentVersion ?? null,
    tryOn: wire.tryOn ? { available: wire.tryOn.available, reason: wire.tryOn.reason ?? null } : null,
    adultFrom: wire.adultFrom ?? null,
  };
}

export function toTeenState(wire: TeenStateWire): TeenState {
  const ageBand = wire.ageBand === 'teen' || wire.ageBand === 'adult' ? wire.ageBand : null;
  return { ageBand, teen: ageBand === 'teen' && wire.teen ? toTeenAccount(wire.teen) : null };
}

export function toTeenConfig(wire: TeenConfigWire | undefined): TeenConfig {
  if (!wire) return DEFAULT_TEEN_CONFIG;
  return {
    enabled: wire.enabled ?? false,
    tryOnEnabled: wire.tryOnEnabled ?? false,
    minimumAge: wire.minimumAge ?? DEFAULT_TEEN_CONFIG.minimumAge,
    adultAge: wire.adultAge ?? DEFAULT_TEEN_CONFIG.adultAge,
  };
}
