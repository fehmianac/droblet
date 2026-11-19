import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Linking } from 'react-native';

import { creditSheetStore } from '@/features/credits/creditSheetStore';
import i18n from '@/i18n';
import { purchaseFlow } from '@/purchases/purchaseFlow';

const mockSession = {
  accessToken: 'a',
  refreshToken: 'r',
  expiresAt: Date.now() + 3_600_000,
  user: { id: 'u1', name: 'Damla', email: 'damla@example.com' },
};

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => JSON.stringify(mockSession)),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

type MockQuery = { data: unknown; status: string; fetchStatus: string; error: unknown; isRefetching: boolean; isPending: boolean; isError: boolean; refetch: jest.Mock };
const member = { tier: 'member', credits: { monthlyAllowance: 30, remaining: 12, resetsAt: '2026-12-01T00:00:00.000Z' } };
const mockRefetch = jest.fn();
let mockQuery: MockQuery;
const success = (data: unknown): MockQuery => ({ data, status: 'success', fetchStatus: 'idle', error: null, isRefetching: false, isPending: false, isError: false, refetch: mockRefetch });
jest.mock('@/entitlement/useEntitlement', () => ({ useEntitlement: () => mockQuery }));

const WAIT = { timeout: 5000 };

async function open(url: string) {
  await AsyncStorage.setItem('droblet.onboarding.u1', 'done');
  await renderRouter('./src/app', { initialUrl: url });
}

beforeEach(async () => {
  jest.clearAllMocks();
  creditSheetStore.close();
  mockQuery = success(member);
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

describe('/subscription — Üyelik yönetimi', () => {
  it('member: plan, renewal date, credit balance; "Top up credits" opens the 05b sheet', async () => {
    await open('/subscription');
    await waitFor(() => expect(screen.getByText('Manage membership')).toBeTruthy(), WAIT);
    expect(screen.getByText('CURRENT PLAN')).toBeTruthy();
    expect(screen.getByText('Droblet Membership')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByLabelText(/^Renewal date: .*2026$/)).toBeTruthy();
    expect(screen.getByText('12 of 30 images left')).toBeTruthy();
    expect(screen.getByText('18 / 30 used')).toBeTruthy();
    // Detail screen: no bottom menu.
    expect(screen.queryByText('Wardrobe')).toBeNull();

    await fireEvent.press(screen.getByTestId('subscription-top-up'));
    expect(creditSheetStore.get()).toBe('topUp');
    await waitFor(() => expect(screen.getByText('Get extra AI images')).toBeTruthy(), WAIT);
    await waitFor(() => expect(screen.getByText('₺79,99 · Get the pack')).toBeTruthy(), WAIT);
    expect(screen.getByText('Not now')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('credit-pack-close'));
    expect(creditSheetStore.get()).toBeNull();
  });

  it('opens the store subscription settings and restores purchases through the store', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const restore = jest.spyOn(purchaseFlow, 'restore').mockResolvedValue(undefined);
    await open('/subscription');
    await waitFor(() => expect(screen.getByText('Manage subscription in the store')).toBeTruthy(), WAIT);

    await fireEvent.press(screen.getByTestId('subscription-manage'));
    expect(openURL).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/(apps\.apple\.com\/account\/subscriptions|play\.google\.com\/store\/account\/subscriptions)$/));

    await fireEvent.press(screen.getByTestId('subscription-restore'));
    await waitFor(() => expect(restore).toHaveBeenCalled(), WAIT);
    openURL.mockRestore();
    restore.mockRestore();
  });

  it('free: shows the free plan and leads to the paywall; no credit card', async () => {
    mockQuery = success({ ...member, tier: 'free' });
    await open('/subscription');
    await waitFor(() => expect(screen.getByText('Free plan')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('subscription-credits')).toBeNull();
    await fireEvent.press(screen.getByText('See membership'));
    await waitFor(() => expect(screen).toHavePathname('/paywall'), WAIT);
  });

  it('error: one sentence and "Try again"', async () => {
    mockQuery = { ...success(undefined), status: 'error', isError: true, error: new Error('boom') };
    await open('/subscription');
    await waitFor(() => expect(screen.getByText('Try again')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('loading: skeleton boxes, no spinner', async () => {
    mockQuery = { ...success(undefined), status: 'pending', fetchStatus: 'fetching', isPending: true };
    await open('/subscription');
    await waitFor(() => expect(screen.getByLabelText('Loading')).toBeTruthy(), WAIT);
  });
});

describe('05 Üyelik', () => {
  it('free: headline, benefits, plan cards from the store products, footer links', async () => {
    mockQuery = success({ ...member, tier: 'free' });
    await open('/paywall');
    await waitFor(() => expect(screen.getByText('An outfit ready every morning. A suitcase ready for every trip.')).toBeTruthy(), WAIT);
    expect(screen.getByText('DROBLET MEMBERSHIP')).toBeTruthy();
    expect(screen.getByText('30 AI images a month')).toBeTruthy();
    expect(screen.getByTestId('paywall.close')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('₺1.499,99 / year')).toBeTruthy(), WAIT);
    expect(screen.getByText('₺199,99 / month')).toBeTruthy();
    expect(screen.getAllByText('7 days free')).toHaveLength(2);
    expect(screen.getByText('Try free for 7 days')).toBeTruthy();
    // Store review: price and period, auto-renewal unless cancelled 24 h before the period ends, where to cancel.
    expect(
      screen.getByText(
        /^After the free trial you pay ₺1\.499,99 a year\. The subscription renews automatically at the same price unless cancelled at least 24 hours before the end of the period\. Manage or cancel it in your (App Store|Google Play) account settings\.$/,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Restore purchases')).toBeTruthy();
    expect(screen.getByText('Terms of Use')).toBeTruthy();
    expect(screen.getByText('Privacy Policy')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('plan-month'));
    await waitFor(() => expect(screen.getByText(/^After the free trial you pay ₺199,99 a month\./)).toBeTruthy(), WAIT);
    expect(screen.getByTestId('plan-month').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('member: says the membership is active and links to its management', async () => {
    await open('/paywall');
    await waitFor(() => expect(screen.getByText('Your Droblet Membership is active.')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('paywall-purchase')).toBeNull();
    await fireEvent.press(screen.getByText('Manage membership'));
    await waitFor(() => expect(screen).toHavePathname('/subscription'), WAIT);
  });
});
