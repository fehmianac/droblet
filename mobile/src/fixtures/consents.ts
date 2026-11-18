import { CONSENT_TEXT_VERSION, CONSENT_TYPES, type ConsentRecord, type ConsentState, type ConsentType, type PutConsentsRequest } from '@/api/contracts/consents';
import { ApiError } from '@/api/errors';

/**
 * In-memory stand-in for `v1/tenant/consents`. The sample account has given every consent (so the
 * other screens' tests run without the just-in-time sheet); tests of the gates start from
 * `resetConsentFixtures({ granted: [] })`.
 */

const GIVEN_AT = '2026-11-19T09:00:00.000Z';

type State = Record<ConsentType, ConsentRecord>;

function record(type: ConsentType, granted: boolean): ConsentRecord {
  const version = CONSENT_TEXT_VERSION[type];
  return {
    type,
    granted,
    version: granted ? version : null,
    currentVersion: version,
    valid: granted,
    grantedAt: granted ? GIVEN_AT : null,
    withdrawnAt: null,
    locale: granted ? 'tr' : null,
    source: granted ? 'onboarding' : null,
  };
}

function initialState(granted: readonly ConsentType[] = CONSENT_TYPES): State {
  return Object.fromEntries(CONSENT_TYPES.map((type) => [type, record(type, granted.includes(type))])) as State;
}

let state: State = initialState();
let failNext = false;
const log: PutConsentsRequest[] = [];

/** Test helper: which consents are valid (default: all). `failNext`: the next PUT fails like a network error. */
export function resetConsentFixtures(options: { granted?: readonly ConsentType[] } = {}): void {
  state = initialState(options.granted ?? CONSENT_TYPES);
  failNext = false;
  log.length = 0;
}

export const consentFixtures = {
  get: (): ConsentState => ({ consents: CONSENT_TYPES.map((type) => state[type]) }),
  put: (request: PutConsentsRequest): ConsentState => {
    if (failNext) {
      failNext = false;
      throw new ApiError('network', null, null);
    }
    log.push(request);
    const now = new Date().toISOString();
    for (const decision of request.consents) {
      const previous = state[decision.type];
      if (decision.granted && decision.version !== previous.currentVersion) {
        throw new ApiError('http', 409, { status: 409, code: 'consent_version_outdated' });
      }
      state[decision.type] = {
        ...previous,
        granted: decision.granted,
        version: decision.version,
        valid: decision.granted,
        grantedAt: decision.granted ? now : previous.grantedAt,
        withdrawnAt: decision.granted ? null : now,
        locale: request.locale,
        source: request.source,
      };
    }
    return consentFixtures.get();
  },
  isValid: (type: ConsentType): boolean => state[type].valid,
  failNextPut: () => {
    failNext = true;
  },
  /** Every PUT body received, oldest first. */
  requests: (): readonly PutConsentsRequest[] => log,
};
