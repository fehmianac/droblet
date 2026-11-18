import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';

import i18n from '@/i18n';
import { resetLanguagePreferenceForTests, setAppLanguage } from '@/i18n/preference';

import { LanguageSyncHost, languageToSync } from './LanguageSyncHost';

const mockSave = jest.fn();
const mockProfile: { data: { language: string | null; baseVersion: number } | undefined } = { data: undefined };

jest.mock('./mutations', () => ({ useSaveProfileLanguage: () => mockSave }));
jest.mock('./queries', () => ({ useMyProfile: () => mockProfile }));

beforeEach(async () => {
  mockSave.mockClear();
  mockProfile.data = undefined;
  resetLanguagePreferenceForTests();
  await AsyncStorage.clear();
  await i18n.changeLanguage('tr');
});

afterAll(async () => {
  await i18n.changeLanguage('tr');
});

describe('languageToSync', () => {
  it('writes the app language whenever the profile differs (the device choice wins)', () => {
    expect(languageToSync(undefined, 'tr')).toBeNull(); // profile not loaded yet
    expect(languageToSync({ language: 'tr' }, 'tr')).toBeNull();
    expect(languageToSync({ language: null }, 'tr')).toBe('tr'); // never stored: first sign-in
    expect(languageToSync({ language: 'en' }, 'tr')).toBe('tr');
    expect(languageToSync({ language: 'tr' }, 'en')).toBe('en');
  });
});

describe('LanguageSyncHost', () => {
  it('on start, the stored device language wins over the profile and is written to it', async () => {
    await AsyncStorage.setItem('droblet.language', 'en');
    mockProfile.data = { language: 'tr', baseVersion: 4 };
    await render(<LanguageSyncHost />);
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('en', 4));
    expect(i18n.language).toBe('en');
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the profile already has the app language', async () => {
    mockProfile.data = { language: 'tr', baseVersion: 2 };
    await render(<LanguageSyncHost />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('writes every later language change', async () => {
    mockProfile.data = { language: 'tr', baseVersion: 2 };
    await render(<LanguageSyncHost />);
    await act(async () => {
      await setAppLanguage('en');
    });
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('en', 2));
    expect(await AsyncStorage.getItem('droblet.language')).toBe('en');
  });

  it('waits for the profile, then writes once per profile version', async () => {
    await AsyncStorage.setItem('droblet.language', 'en');
    const view = await render(<LanguageSyncHost />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSave).not.toHaveBeenCalled();
    mockProfile.data = { language: null, baseVersion: 1 };
    await view.rerender(<LanguageSyncHost />);
    await waitFor(() => expect(mockSave).toHaveBeenCalledWith('en', 1));
    await view.rerender(<LanguageSyncHost />);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });
});
