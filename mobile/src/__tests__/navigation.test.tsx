import { renderRouter, screen, waitFor } from 'expo-router/testing-library';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

describe('navigation (signed out)', () => {
  it('lands on 01 Hoş geldin and protects tab routes', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await renderRouter('./src/app', { initialUrl: '/' });

    await waitFor(() => expect(screen.getByText('Get started')).toBeTruthy());
    expect(screen.getByText('I already have an account')).toBeTruthy();

    const routeWarnings = [...warn.mock.calls, ...error.mock.calls]
      .map((c) => String(c[0]))
      .filter((m) => /route|screen/i.test(m));
    expect(routeWarnings).toEqual([]);
    warn.mockRestore();
    error.mockRestore();
  });
});
