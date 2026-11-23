import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/api/errors';
import i18n from '@/i18n';

import { TestPushRow } from './TestPushRow';

const mockConfig: { data?: { testPush: boolean } } = {};
jest.mock('@/api/appConfig', () => ({ useAppConfig: () => mockConfig }));
const mockRequest = jest.fn();
jest.mock('@/api/client', () => ({ apiRequest: (...a: unknown[]) => mockRequest(...a) }));
const mockToast = { success: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('@/components/ui/toast/store', () => ({
  toast: { success: (m: string) => mockToast.success(m), info: (m: string) => mockToast.info(m), error: (m: string) => mockToast.error(m) },
}));

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('TestPushRow', () => {
  it('is not shown unless the server offers the test tool (prod, old servers, config not loaded)', async () => {
    mockConfig.data = undefined;
    const view = await render(<TestPushRow />);
    expect(screen.queryByTestId('profile.testPush')).toBeNull();
    mockConfig.data = { testPush: false };
    await view.rerender(<TestPushRow />);
    expect(screen.queryByTestId('profile.testPush')).toBeNull();
  });

  it('sends one test notification and tells what happened', async () => {
    mockConfig.data = { testPush: true };
    await render(<TestPushRow />);

    mockRequest.mockResolvedValueOnce({ devices: 2, sent: 2, results: [] });
    await fireEvent.press(screen.getByTestId('profile.testPush'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Test notification sent · 2 devices'));
    expect(mockRequest).toHaveBeenCalledWith('v1/tenant/notification/test-push', { method: 'POST' });

    mockRequest.mockResolvedValueOnce({ devices: 0, sent: 0, results: [] });
    await fireEvent.press(screen.getByTestId('profile.testPush'));
    await waitFor(() => expect(mockToast.info).toHaveBeenCalledWith('No device on this account can receive notifications. Allow notifications first.'));

    mockRequest.mockResolvedValueOnce({ devices: 1, sent: 0, results: [{ platform: 'ios', result: 'NotConfigured' }] });
    await fireEvent.press(screen.getByTestId('profile.testPush'));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The notification could not be sent (NotConfigured).'));

    mockRequest.mockRejectedValueOnce(Object.assign(Object.create(ApiError.prototype), { status: 429 }));
    await fireEvent.press(screen.getByTestId('profile.testPush'));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Too many tries. Try again in a minute.'));

    mockRequest.mockRejectedValueOnce(new Error('offline'));
    await fireEvent.press(screen.getByTestId('profile.testPush'));
    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('The test notification could not be sent. Try again.'));
  });
});
