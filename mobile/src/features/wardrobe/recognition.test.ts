import { router } from 'expo-router';

import { ApiError } from '@/api/errors';
import { fixtureDb, resetFixtureDb } from '@/fixtures/db';
import { fixtureCreateDrafts, fixtureListDrafts, resetFixtureDrafts, setFixtureItemRecognition } from '@/fixtures/wardrobe';

import { fitToRecognitionQuota, isRecognitionLimitReached, openRecognitionPaywall, recognitionRemaining } from './recognition';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

beforeEach(() => {
  resetFixtureDb();
  resetFixtureDrafts();
});

describe('item recognition quota', () => {
  it('reads the remaining free recognitions from the entitlement', () => {
    expect(recognitionRemaining(undefined)).toBeNull(); // unknown → the server decides
    expect(recognitionRemaining({})).toBeNull(); // older server without the field
    expect(recognitionRemaining({ itemRecognition: { limit: null, used: 40, remaining: null } })).toBeNull(); // member: unlimited
    expect(recognitionRemaining({ itemRecognition: { limit: 10, used: 4, remaining: 6 } })).toBe(6);
    expect(recognitionRemaining({ itemRecognition: { limit: 10, used: 10, remaining: 0 } })).toBe(0);
    expect(recognitionRemaining({ itemRecognition: { limit: 0, used: 0, remaining: 0 } })).toBe(0); // free recognition switched off
    expect(recognitionRemaining({ itemRecognition: { limit: 10, used: 12, remaining: -2 } })).toBe(0);
  });

  it('the member fixture is unlimited; the free fixture carries the server shape', () => {
    expect(fixtureDb.entitlement.itemRecognition).toEqual({ limit: null, used: 0, remaining: null });
    setFixtureItemRecognition(5, 3);
    expect(fixtureDb.entitlement).toMatchObject({ tier: 'free', itemRecognition: { limit: 5, used: 3, remaining: 2 } });
  });

  it('recognises the 402 problem code only', () => {
    expect(isRecognitionLimitReached(new ApiError('http', 402, { status: 402, code: 'item_recognition_limit_reached' }))).toBe(true);
    // Limit configured as 0 (members only) reads exactly like an exhausted allowance: paywall + manual entry.
    expect(isRecognitionLimitReached(new ApiError('http', 403, { status: 403, code: 'premium_required' }))).toBe(true);
    expect(isRecognitionLimitReached(new ApiError('http', 402, { code: 'monthly_limit_reached' }))).toBe(false);
    expect(isRecognitionLimitReached(new ApiError('network', null, null))).toBe(false);
    expect(isRecognitionLimitReached(new Error('x'))).toBe(false);
  });

  it('bulk add processes what fits the quota and counts the rest as skipped', () => {
    const photos = ['a', 'b', 'c', 'd'];
    expect(fitToRecognitionQuota(photos, null)).toEqual({ accepted: photos, skipped: 0 });
    expect(fitToRecognitionQuota(photos, 10)).toEqual({ accepted: photos, skipped: 0 });
    expect(fitToRecognitionQuota(photos, 3)).toEqual({ accepted: ['a', 'b', 'c'], skipped: 1 });
    expect(fitToRecognitionQuota(photos, 0)).toEqual({ accepted: [], skipped: 4 });
  });

  it('the fixture server answers 402 when nothing is left and starts no draft', () => {
    setFixtureItemRecognition(3, 3);
    let thrown: unknown;
    try {
      fixtureCreateDrafts({ requestId: 'q1', photoKeys: ['file://1.jpg'] });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(402);
    expect(isRecognitionLimitReached(thrown)).toBe(true);
    expect(fixtureListDrafts()).toHaveLength(0);
  });

  it('the fixture server starts the part of a batch that fits and reports the rest', () => {
    setFixtureItemRecognition(5, 3);
    const res = fixtureCreateDrafts({ requestId: 'q2', photoKeys: ['file://1.jpg', 'file://2.jpg', 'file://3.jpg'] });
    expect(res.draftIds).toHaveLength(2);
    expect(res.skippedCount).toBe(1);
    expect(fixtureDb.entitlement.itemRecognition).toEqual({ limit: 5, used: 5, remaining: 0 });
  });

  it('opens the paywall for the recognition quota', () => {
    openRecognitionPaywall();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/paywall', params: { from: 'item_recognition' } });
  });
});
