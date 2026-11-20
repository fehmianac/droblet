import { redirectSystemPath } from '@/app/+native-intent';

import { mapIncomingLink } from './deepLinks';

describe('e-mail links (reset password, verify e-mail)', () => {
  it.each([
    ['https://droblet.alatech.co/reset-password/?token=abc123', '/reset-password?token=abc123'],
    ['https://droblet.alatech.co/reset-password?token=abc123', '/reset-password?token=abc123'],
    ['https://droblet.alatech.co/en/reset-password/?token=abc123', '/reset-password?token=abc123'],
    ['droplet://reset-password/?token=abc123', '/reset-password?token=abc123'],
    ['/reset-password/?token=abc123', '/reset-password?token=abc123'],
    ['https://droblet.alatech.co/verify-email/?token=v-9_x', '/verify-email?token=v-9_x'],
    ['https://droblet.alatech.co/verify-email?token=v-9_x', '/verify-email?token=v-9_x'],
    ['https://droblet.alatech.co/en/verify-email/?token=v-9_x', '/verify-email?token=v-9_x'],
    ['/verify-email?token=v-9_x', '/verify-email?token=v-9_x'],
  ])('%s → %s', (input, path) => {
    expect(mapIncomingLink(input)).toEqual({ path, inviteCode: null });
  });

  it('keeps every other query parameter and the token encoding as sent', () => {
    expect(mapIncomingLink('https://droblet.alatech.co/reset-password/?token=a%2Bb&lang=en').path).toBe('/reset-password?token=a%2Bb&lang=en');
  });

  it('leaves deeper paths alone', () => {
    expect(mapIncomingLink('https://droblet.alatech.co/reset-password/extra?token=x').path).toBe('https://droblet.alatech.co/reset-password/extra?token=x');
  });

  it('is what the system link handler hands expo-router', () => {
    expect(redirectSystemPath({ path: 'https://droblet.alatech.co/verify-email/?token=t1', initial: true })).toBe('/verify-email?token=t1');
    expect(redirectSystemPath({ path: 'https://droblet.alatech.co/reset-password/?token=t2', initial: false })).toBe('/reset-password?token=t2');
  });
});

describe('sign-in redirects never become a route', () => {
  it('maps the Google OAuth redirect to the root instead of an unknown screen', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { redirectSystemPath, isAuthRedirect } = require('@/app/+native-intent');
    const google = 'com.googleusercontent.apps.246101741985-hka3auqnqlnlu891bt4g1jcbdr6q212t:/oauthredirect?state=abc&code=xyz';
    expect(isAuthRedirect(google)).toBe(true);
    expect(redirectSystemPath({ path: google, initial: false })).toBe('/');
    expect(isAuthRedirect('droplet://invite/DAMLA24')).toBe(false);
  });
});
