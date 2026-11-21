import { ApiError } from '@/api/errors';
import type { TeenConfig } from '@/api/contracts/teen';
import { toTeenState, type TeenStylistWire, type TeenWire } from '@/api/wire/teen';
import { sessionStore } from '@/auth/session';
import { routeAiStartError } from '@/features/credits/aiErrors';
import { computeRequirements, type RequirementInput } from '@/features/requirements/logic';
import { packErrorState } from '@/features/trips/logic';

import { teenGate, teenGateStop } from './gate';
import { teenRules, teenStylistRules } from './rules';
import { refreshTeenStylist, teenStore } from './store';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));

const ON: TeenConfig = { enabled: true, tryOnEnabled: false, minimumAge: 16, adultAge: 18 };

const ALLOWANCE: TeenStylistWire = {
  enabled: true,
  dailyLimit: 3,
  usedToday: 1,
  remainingToday: 2,
  resetsAt: '2026-11-21T21:00:00Z',
  weekPlanLimit: 1,
  weekPlanUsed: 0,
  weekPlanRemaining: 1,
  weekResetsAt: '2026-11-22T21:00:00Z',
  tripPackLimit: 0,
  tripPackUsed: 0,
  tripPackRemaining: 0,
};

function teen(status: TeenWire['status'], stylist: TeenStylistWire | null = ALLOWANCE) {
  return toTeenState({ ageBand: 'teen', teen: { status, request: { state: 'sent' }, stylist } });
}

const input: RequirementInput = {
  ageConfirmed: true,
  validConsents: [],
  hasBodyPhoto: true,
  hasFacePhoto: true,
  bodyType: 'hourglass',
  hasBodyProfile: true,
  isMember: false,
  creditsRemaining: 0,
  cityId: 'istanbul',
  handle: null,
  itemCount: 10,
};

describe('teen stylist allowance (Teen:Stylist, canvas 18 · 16t–16w)', () => {
  it('maps the server allowance: open, limit reached, off (disabled or 0)', () => {
    const state = teen('active');
    expect(state.teen?.stylist).toMatchObject({ dailyLimit: 3, remainingToday: 2, weekPlanRemaining: 1, tripPackLimit: 0 });
    expect(teenRules(state, ON).stylist).toMatchObject({ outfit: 'open', week: 'open', pack: 'unavailable' });
    expect(teenStylistRules({ ...state.teen!.stylist!, remainingToday: 0, weekPlanRemaining: 0 })).toMatchObject({
      outfit: 'limitReached',
      week: 'limitReached',
    });
    expect(teenStylistRules({ ...state.teen!.stylist!, enabled: false })).toMatchObject({ outfit: 'unavailable', week: 'unavailable', pack: 'unavailable' });
    expect(teenStylistRules({ ...state.teen!.stylist!, dailyLimit: 0 }).outfit).toBe('unavailable');
  });

  it('only approved teens have it; an older server that does not say leaves the decision to the server', () => {
    expect(teenRules(teen('pendingParentalConsent'), ON).stylist).toBeNull();
    expect(teenRules({ ageBand: 'adult', teen: null }, ON).stylist).toBeNull();
    expect(teenRules(teen('active', null), ON).stylist).toEqual({ outfit: 'open', week: 'open', pack: 'open', allowance: null });
  });

  it('the gate: open goes on, limit → 16u / one line, off → the "not available" sentence, pending stays locked', () => {
    const open = teenRules(teen('active'), ON);
    const used = teenRules(teen('active', { ...ALLOWANCE, remainingToday: 0, weekPlanRemaining: 0 }), ON);
    const off = teenRules(teen('active', { ...ALLOWANCE, enabled: false }), ON);
    expect(teenGateStop('stylist', open)).toBeNull();
    expect(teenGateStop('week', open)).toBeNull();
    expect(teenGateStop('pack', open)).toBe('unavailable');
    expect(teenGateStop('stylist', used)).toBe('stylistLimit');
    expect(teenGateStop('week', used)).toBe('weekLimit');
    expect(teenGateStop('stylist', off)).toBe('unavailable');
    expect(teenGateStop('stylist', teenRules(teen('pendingParentalConsent'), ON))).toBe('locked');
  });

  it('no membership step for an approved teen; adults still get it', () => {
    expect(computeRequirements('stylist', { ...input, teenStylist: true }).steps.map((s) => s.kind)).not.toContain('premium');
    expect(computeRequirements('week', { ...input, teenStylist: true }).ready).toBe(true);
    expect(computeRequirements('stylist', input).steps.map((s) => s.kind)).toContain('premium');
  });

  it('packing area: the teen answers are the calm 16w card, never the paywall', () => {
    expect(packErrorState(new ApiError('http', 403, { status: 403, code: 'teen_stylist_unavailable' }))).toBe('teenOff');
    expect(packErrorState(new ApiError('http', 429, { status: 429, code: 'teen_stylist_weekly_limit' }))).toBe('teenLimit');
    expect(packErrorState(new ApiError('http', 403, { status: 403, code: 'premium_required' }))).toBe('paywall');
  });
});

describe('teen allowance answers of a start request', () => {
  beforeEach(() => {
    teenGate.close();
    teenStore.reset();
  });

  it('teen_stylist_daily_limit opens the 16u sheet (not the paywall) and asks for the allowance again', async () => {
    await sessionStore.setFromAuthResponse(
      { userId: 'u1', tenantId: 't1', accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() } as never,
      { name: 'Ece', email: 'ece@example.com', ageConfirmed: true, ageBand: 'teen' },
    );
    teenStore.setState(teen('active'));
    const refreshed = jest.fn();
    const off = teenStore.onRefresh(refreshed);

    const handled = routeAiStartError(new ApiError('http', 429, { status: 429, code: 'teen_stylist_daily_limit', resetsAt: '2026-11-21T21:00:00Z' }), 'stylist');

    expect(handled).toBe(true);
    expect(teenGate.get()?.stop).toBe('stylistLimit');
    expect(refreshed).toHaveBeenCalledTimes(1);
    refreshTeenStylist();
    expect(refreshed).toHaveBeenCalledTimes(2);
    off();
  });

  it('weekly limit and unavailable are one calm line (no sheet); other errors are not taken', () => {
    expect(routeAiStartError(new ApiError('http', 429, { status: 429, code: 'teen_stylist_weekly_limit' }), 'stylist')).toBe(true);
    expect(routeAiStartError(new ApiError('http', 403, { status: 403, code: 'teen_stylist_unavailable' }), 'suitcase')).toBe(true);
    expect(teenGate.get()).toBeNull();
    expect(routeAiStartError(new ApiError('http', 500, { status: 500, code: 'internal_error' }), 'stylist')).toBe(false);
  });
});
