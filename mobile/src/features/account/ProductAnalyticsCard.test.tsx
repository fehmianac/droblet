import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { setFirebaseClientForTests, type FirebaseAnalyticsClient } from '@/analytics/firebase';
import { resetProductAnalyticsForTests, restoreProductAnalytics } from '@/analytics/preference';
import { resetAnalytics } from '@/analytics/track';
import i18n from '@/i18n';

import { ProductAnalyticsCard } from './ProductAnalyticsCard';

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn(async () => ({ type: 'opened' })) }));

describe('29d Ürün analitiği', () => {
  const collection: boolean[] = [];
  const client: FirebaseAnalyticsClient = {
    setCollectionEnabled: async (enabled) => {
      collection.push(enabled);
    },
    logEvent: async () => undefined,
    setUserId: async () => undefined,
    setUserProperties: async () => undefined,
  };

  beforeEach(async () => {
    collection.length = 0;
    resetAnalytics();
    resetProductAnalyticsForTests();
    setFirebaseClientForTests(client);
    await AsyncStorage.clear();
    await i18n.changeLanguage('tr');
  });

  it('is on by default and switches Firebase off (and back on), remembered on the phone', async () => {
    await restoreProductAnalytics();
    await render(<ProductAnalyticsCard />);
    const toggle = screen.getByTestId('settings.productAnalytics');
    expect(screen.getByText('Ürün analitiği')).toBeTruthy();
    expect(toggle.props.accessibilityState).toEqual({ checked: true });

    await act(async () => {
      fireEvent.press(toggle);
    });
    await waitFor(() => expect(screen.getByTestId('settings.productAnalytics').props.accessibilityState).toEqual({ checked: false }));
    expect(collection.at(-1)).toBe(false);
    expect(await AsyncStorage.getItem('droblet.productAnalytics')).toBe('0');

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings.productAnalytics'));
    });
    await waitFor(() => expect(collection.at(-1)).toBe(true));
  });

  it('links to the privacy notice', async () => {
    await render(<ProductAnalyticsCard />);
    await fireEvent.press(screen.getByTestId('settings.privacyNotice'));
    expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(expect.stringMatching(/\/privacy\/?$/));
  });
});
