import { render } from '@testing-library/react-native';

import '@/i18n';

const mockResponse: { current: unknown } = { current: null };
jest.mock('expo-auth-session/providers/google', () => ({
  useIdTokenAuthRequest: () => [{}, mockResponse.current, jest.fn()],
}));
jest.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: jest.fn() }));
jest.mock('@/api/config', () => ({ googleClientIds: () => ({ ios: 'ios-id', android: 'android-id', web: 'web-id' }) }));

// eslint-disable-next-line import/first
import { GoogleSignIn } from './GoogleSignIn';

describe('GoogleSignIn', () => {
  it('sends the id token once, even when the screen re-renders with new callbacks for the same answer', async () => {
    mockResponse.current = { type: 'success', params: { id_token: 'token-1' } };
    const sent: string[] = [];
    const view = await render(<GoogleSignIn onIdToken={(t) => sent.push(t)} onError={jest.fn()} onUnavailable={jest.fn()} loading={false} />);
    // The sign-in mutation re-renders the screen: the callbacks are new functions every time.
    for (let i = 0; i < 5; i++) {
      await view.rerender(<GoogleSignIn onIdToken={(t) => sent.push(t)} onError={jest.fn()} onUnavailable={jest.fn()} loading={i % 2 === 0} />);
    }
    expect(sent).toEqual(['token-1']);
  });
});
