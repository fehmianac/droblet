import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasTriedOn, LOW_BALANCE_AFTER, markTriedOn, needsSpendConfirm, triedOnKey } from './spendConfirm';

const base = { cost: 1, remaining: 11, isMember: true, triedBefore: true };

describe('07b Kredi onayı — when "Üzerimde gör" asks before spending (canvas n_ux1 C)', () => {
  it('a single try-on with credits to spare starts at once', () => {
    expect(needsSpendConfirm(base)).toBe(false);
    expect(needsSpendConfirm({ ...base, remaining: LOW_BALANCE_AFTER + 2 })).toBe(false);
  });

  it('the first try-on ever asks', () => {
    expect(needsSpendConfirm({ ...base, triedBefore: false })).toBe(true);
  });

  it('asks when the balance after the spend would be 2 or less', () => {
    expect(needsSpendConfirm({ ...base, remaining: 3 })).toBe(true);
    expect(needsSpendConfirm({ ...base, remaining: 2 })).toBe(true);
    expect(needsSpendConfirm({ ...base, remaining: 1 })).toBe(true);
  });

  it('an action costing more than one credit always asks (07 hafta "· 7 kredi")', () => {
    expect(needsSpendConfirm({ ...base, cost: 2, remaining: 30 })).toBe(true);
    expect(needsSpendConfirm({ ...base, cost: 7, remaining: 30 })).toBe(true);
  });

  it('asks whenever the sheet has more to say: not a member, unknown or too small a balance', () => {
    expect(needsSpendConfirm({ ...base, isMember: false })).toBe(true);
    expect(needsSpendConfirm({ ...base, remaining: null })).toBe(true);
    expect(needsSpendConfirm({ ...base, remaining: 0 })).toBe(true);
  });
});

describe('"tried on" flag — per user, on the phone', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('is off until a try-on was started, then stays on for that user only', async () => {
    expect(await hasTriedOn('u1')).toBe(false);
    await markTriedOn('u1');
    expect(await hasTriedOn('u1')).toBe(true);
    expect(await AsyncStorage.getItem(triedOnKey('u1'))).toBe('yes');
    expect(await hasTriedOn('u2')).toBe(false);
  });

  it('signed out: never remembered, always asks', async () => {
    await markTriedOn(null);
    expect(await hasTriedOn(null)).toBe(false);
  });
});
