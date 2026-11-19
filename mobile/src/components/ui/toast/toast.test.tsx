import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '@/i18n';

import { hideToast, showToast, toastDuration } from './store';
import { ToastHost } from './ToastHost';

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(async () => undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const host = () => render(<SafeAreaProvider initialMetrics={METRICS}><ToastHost /></SafeAreaProvider>);

beforeEach(() => {
  hideToast();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('13b toast', () => {
  it('shows one toast at a time with its action; the action runs and hides it', async () => {
    await host();
    const onPress = jest.fn();
    await act(async () => {
      showToast({ message: 'First', tone: 'info' });
      showToast({ message: "Added to Tuesday 24 November", action: { label: 'See calendar', onPress } });
    });
    expect(screen.getByTestId('toast-message').props.children).toBe('Added to Tuesday 24 November');
    expect(screen.queryByText('First')).toBeNull();
    await fireEvent.press(screen.getByTestId('toast-action'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('goes away by itself after its duration', async () => {
    jest.useFakeTimers();
    await host();
    await act(async () => {
      showToast({ message: 'Saved to your looks' });
    });
    expect(screen.getByTestId('toast')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(toastDuration('success', false) + 10);
    });
    expect(screen.queryByTestId('toast')).toBeNull();
  });

  it('gives success a light success haptic, errors a warning, info none', () => {
    const notify = Haptics.notificationAsync as jest.Mock;
    notify.mockClear();
    act(() => {
      showToast({ message: 'ok' });
      showToast({ message: 'nope', tone: 'error' });
      showToast({ message: 'fyi', tone: 'info' });
    });
    expect(notify.mock.calls).toEqual([['success'], ['warning']]);
  });

  it('durations: errors stay longest, an action adds time', () => {
    expect(toastDuration('error', true)).toBeGreaterThan(toastDuration('success', true));
    expect(toastDuration('success', true)).toBeGreaterThan(toastDuration('success', false));
  });
});
