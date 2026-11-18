import { router } from 'expo-router';

import { creditSheetStore } from './creditSheetStore';
import { openCreditTopUp } from './useAiCredits';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

describe('openCreditTopUp', () => {
  afterEach(() => {
    creditSheetStore.close();
    jest.clearAllMocks();
  });

  it('opens the 05b credit pack sheet for a member', () => {
    openCreditTopUp(true);
    expect(creditSheetStore.get()).toBe('topUp');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('sends a non-member to the paywall', () => {
    openCreditTopUp(false);
    expect(creditSheetStore.get()).toBeNull();
    expect(router.push).toHaveBeenCalledWith('/paywall');
  });
});
