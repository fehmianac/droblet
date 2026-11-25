import AsyncStorage from '@react-native-async-storage/async-storage';

import { apiRequest } from '@/api/client';
import { ApiError } from '@/api/errors';

import { onboardingStore } from './onboarding';

jest.mock('@/api/client', () => ({ apiRequest: jest.fn() }));
const api = apiRequest as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('onboarding record on a device that has none (app installed again while signed in)', () => {
  it('an account with a style profile opens the app, and the answer is kept', async () => {
    api.mockResolvedValueOnce({});
    await onboardingStore.load('re-1');
    expect(api).toHaveBeenCalledWith('v1/tenant/style-profile');
    expect(onboardingStore.get('re-1')).toBe('done');
    expect(await AsyncStorage.getItem('droblet.onboarding.re-1')).toBe('done');
  });

  it('an account without a style profile runs onboarding', async () => {
    api.mockRejectedValueOnce(new ApiError('http', 404, null));
    await onboardingStore.load('re-2');
    expect(onboardingStore.get('re-2')).toBe('pending');
    expect(await AsyncStorage.getItem('droblet.onboarding.re-2')).toBe('pending');
  });

  it('no answer from the server: onboarding for now, nothing kept so the next start asks again', async () => {
    api.mockRejectedValueOnce(new Error('offline'));
    await onboardingStore.load('re-3');
    expect(onboardingStore.get('re-3')).toBe('pending');
    expect(await AsyncStorage.getItem('droblet.onboarding.re-3')).toBeNull();
  });

  it('a stored record never asks the server', async () => {
    await AsyncStorage.setItem('droblet.onboarding.re-4', 'pending');
    await onboardingStore.load('re-4');
    expect(api).not.toHaveBeenCalled();
    expect(onboardingStore.get('re-4')).toBe('pending');
  });
});
