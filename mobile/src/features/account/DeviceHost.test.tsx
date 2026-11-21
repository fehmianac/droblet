import { render } from '@testing-library/react-native';

const mockSync = jest.fn().mockResolvedValue(true);
jest.mock('@/notify/push', () => ({ syncPushRegistration: (...args: unknown[]) => mockSync(...args) }));
jest.mock('./device', () => ({ registerDevice: jest.fn().mockResolvedValue(undefined) }));

// eslint-disable-next-line import/first
import { DeviceHost } from './DeviceHost';

describe('DeviceHost', () => {
  it('asks for the notification permission at app start (the OS shows it only while never answered)', async () => {
    await render(<DeviceHost />);
    expect(mockSync).toHaveBeenCalledWith({ ask: true });
  });
});
