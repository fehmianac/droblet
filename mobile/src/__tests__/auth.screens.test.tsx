import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import i18n from '@/i18n';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const mockForgot = jest.fn();
const mockReset = jest.fn();
jest.mock('@/api/auth', () => {
  const idle = { mutate: jest.fn(), isPending: false, isSuccess: false, isError: false };
  return {
    ...jest.requireActual('@/api/auth'),
    useForgotPassword: () => ({
      ...idle,
      mutate: (body: { email: string }, options?: { onSuccess?: () => void }) => {
        mockForgot(body);
        options?.onSuccess?.();
      },
    }),
    useResetPassword: () => ({ ...idle, mutate: (body: unknown) => mockReset(body) }),
  };
});

const WAIT = { timeout: 4000 };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
});

describe('02 Kayıt / giriş', () => {
  it('register: no eyebrow, the ink switch, the e-mail divider and the field error under the password', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await waitFor(() => expect(screen.getByText('Create your account')).toBeTruthy(), WAIT);
    expect(screen.queryByText('CREATE ACCOUNT')).toBeNull();
    expect(screen.getByText('OR EMAIL')).toBeTruthy();
    expect(screen.getByTestId('auth.tab.register').props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('Continue with Google')).toBeTruthy();
    expect(screen.queryByText('Forgot password')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('auth.name'), 'Damla');
    await fireEvent.changeText(screen.getByTestId('auth.email'), 'damla@example.com');
    await fireEvent.changeText(screen.getByTestId('auth.password'), '1234567');
    await fireEvent.press(screen.getByTestId('auth.submit'));
    await waitFor(() => expect(screen.getByText(i18n.t('errors.passwordTooShort'))).toBeTruthy(), WAIT);
  });

  it('login: the switch changes the title and the submit label, "Forgot password" opens 02b with the e-mail', async () => {
    await renderRouter('./src/app', { initialUrl: '/start?mode=register' });
    await waitFor(() => expect(screen.getByText('Create your account')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('auth.tab.login'));
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('auth.submit').props.accessibilityLabel).toBe('Sign in');
    expect(screen.queryByTestId('auth.name')).toBeNull();

    await fireEvent.changeText(screen.getByTestId('auth.email'), 'damla@example.com');
    await fireEvent.press(screen.getByTestId('auth.forgot'));
    await waitFor(() => expect(screen.getByText('Forgot your password?')).toBeTruthy(), WAIT);
    expect(screen.getByTestId('forgot.email').props.value).toBe('damla@example.com');
  });
});

describe('02b Şifremi unuttum → 02c Bağlantı gönderildi', () => {
  it('shows the note, validates the address, then the sent state with the countdown', async () => {
    await renderRouter('./src/app', { initialUrl: '/forgot-password' });
    await waitFor(() => expect(screen.getByText('PASSWORD RESET')).toBeTruthy(), WAIT);
    expect(screen.getByText(/The link works once/)).toBeTruthy();
    expect(screen.getByText('Back to sign in')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('forgot.email'), 'not-an-email');
    await fireEvent.press(screen.getByTestId('forgot.submit'));
    await waitFor(() => expect(screen.getByText(i18n.t('errors.emailInvalid'))).toBeTruthy(), WAIT);
    expect(mockForgot).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('forgot.email'), ' damla@example.com ');
    await fireEvent.press(screen.getByTestId('forgot.submit'));
    await waitFor(() => expect(screen.getByText('Check your email')).toBeTruthy(), WAIT);
    expect(mockForgot).toHaveBeenCalledWith({ email: 'damla@example.com' });
    expect(screen.getByText('damla@example.com')).toBeTruthy();
    expect(screen.getByText("If the email hasn't arrived, check your junk folder.")).toBeTruthy();
    expect(screen.getByText('Open email app')).toBeTruthy();
    // Resend is locked while the countdown runs.
    const resend = screen.getByTestId('forgot-resend');
    expect(resend.props.accessibilityLabel).toMatch(/^Send again · [01]:\d\d$/);
    expect(resend.props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('02d Yeni şifre', () => {
  it('needs two matching passwords before the reset is sent', async () => {
    await renderRouter('./src/app', { initialUrl: '/reset-password?token=tok_1&email=damla%40example.com' });
    await waitFor(() => expect(screen.getByText('Set a new password')).toBeTruthy(), WAIT);
    expect(screen.getByText('Choose a new password for damla@example.com.')).toBeTruthy();
    expect(screen.getByLabelText('Close')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('reset.password'), 'sonbahar2026');
    await fireEvent.changeText(screen.getByTestId('reset.repeat'), 'sonbahar202');
    await fireEvent.press(screen.getByTestId('reset.submit'));
    await waitFor(() => expect(screen.getByText("The passwords don't match.")).toBeTruthy(), WAIT);
    expect(mockReset).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('reset.repeat'), 'sonbahar2026');
    await fireEvent.press(screen.getByTestId('reset.submit'));
    expect(mockReset).toHaveBeenCalledWith({ token: 'tok_1', newPassword: 'sonbahar2026' });
  });

  it('without a token it explains that the link is invalid', async () => {
    await renderRouter('./src/app', { initialUrl: '/reset-password' });
    await waitFor(() => expect(screen.getByText('Request a new link')).toBeTruthy(), WAIT);
  });
});
