import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { Dimensions } from 'react-native';

import type { AppConfig } from '@/api/contracts';
import { isCompactWelcome, welcomeHero } from '@/features/welcome/heroImage';
import i18n from '@/i18n';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const mockTrack = jest.fn();
jest.mock('@/analytics/track', () => ({ ...jest.requireActual('@/analytics/track'), track: (...a: unknown[]) => mockTrack(...a) }));

// `GET v1/config` as the screen sees it: answered, failed, or still on its way.
type ConfigState = { data?: AppConfig; isError: boolean; failureCount: number; fetchStatus: 'idle' | 'fetching' | 'paused' };
const mockConfig: { state: ConfigState } = { state: { isError: false, failureCount: 0, fetchStatus: 'idle' } };
jest.mock('@/api/appConfig', () => ({ useAppConfig: () => mockConfig.state }));

function answered(available: AppConfig['availableSegments']): ConfigState {
  return { data: { availableSegments: available, teen: { enabled: false } } as unknown as AppConfig, isError: false, failureCount: 0, fetchStatus: 'idle' };
}

const WAIT = { timeout: 4000 };
// The photo is decorative (hidden from screen readers).
const HIDDEN = { includeHiddenElements: true };
const window0 = Dimensions.get('window');

function setWindowHeight(height: number) {
  Dimensions.set({ window: { ...window0, height }, screen: { ...window0, height } });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
  setWindowHeight(844);
  mockConfig.state = answered(['women', 'men']);
});
afterAll(() => Dimensions.set({ window: window0, screen: window0 }));

describe('welcomeHero (canvas 20 · A)', () => {
  it.each([
    [['women', 'men'], 'mixed'],
    [['women'], 'women'],
    [['men'], 'men'],
    [undefined, 'women'],
    [[], 'women'],
  ] as const)('segments %j → %s on a regular phone', (segments, hero) => {
    expect(welcomeHero(segments as never, 844)).toBe(hero);
  });

  it('SE-class height (667) shows the group only when both segments are open; women-only never shows a man', () => {
    expect(isCompactWelcome(667)).toBe(true);
    expect(isCompactWelcome(844)).toBe(false);
    expect(welcomeHero(['women', 'men'], 667)).toBe('group');
    expect(welcomeHero(['women'], 667)).toBe('women');
    expect(welcomeHero(['men'], 667)).toBe('men');
    expect(welcomeHero(undefined, 667)).toBe('women');
  });
});

describe('01 Hoş geldin — editorial photo', () => {
  it('both segments open: the couple, headline, value line and the two entry points (20a)', async () => {
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('welcome.hero.mixed', HIDDEN)).toBeTruthy(), WAIT);
    expect(screen.getByText('Try everything on before you wear it.')).toBeTruthy();
    expect(screen.getByText('Wardrobe, AI stylist and packing in one app.')).toBeTruthy();
    expect(screen.getByText('Get started')).toBeTruthy();
    expect(screen.getByText('I already have an account')).toBeTruthy();
  });

  it.each([
    [['women'], 'women'],
    [['men'], 'men'],
  ] as const)('only %j open → the %s photo (20b / 20c)', async (available, hero) => {
    mockConfig.state = answered([...available]);
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId(`welcome.hero.${hero}`, HIDDEN)).toBeTruthy(), WAIT);
  });

  it('config failed → the woman photo', async () => {
    mockConfig.state = { isError: true, failureCount: 1, fetchStatus: 'idle' };
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('welcome.hero.women', HIDDEN)).toBeTruthy(), WAIT);
  });

  it('config still on its way → no photo yet, the buttons already work', async () => {
    mockConfig.state = { isError: false, failureCount: 0, fetchStatus: 'fetching' };
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByText('Get started')).toBeTruthy(), WAIT);
    expect(screen.queryByTestId(/^welcome\.hero\./, HIDDEN)).toBeNull();
  });

  it('SE-class phone: the group, headline 32, no value line (20d)', async () => {
    setWindowHeight(667);
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('welcome.hero.group', HIDDEN)).toBeTruthy(), WAIT);
    expect(screen.queryByTestId('welcome.value')).toBeNull();
    expect(screen.getByTestId('welcome.headline').props.className).toContain('text-[32px]');
  });

  it('"Get started" opens registration', async () => {
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('welcome.start')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('welcome.start'));
    await waitFor(() => expect(screen.getByText('Create your account')).toBeTruthy(), WAIT);
    expect(screen).toHavePathname('/start');
    expect(mockTrack).toHaveBeenCalledWith('signup_step', { step: 'welcome' });
  });

  it('"I already have an account" opens sign-in', async () => {
    await renderRouter('./src/app', { initialUrl: '/' });
    await waitFor(() => expect(screen.getByTestId('welcome.login')).toBeTruthy(), WAIT);
    await fireEvent.press(screen.getByTestId('welcome.login'));
    await waitFor(() => expect(screen.getByText('Welcome back')).toBeTruthy(), WAIT);
  });
});
