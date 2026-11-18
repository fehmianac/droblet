import { ApiError, isConsentRequired, missingConsents } from '@/api/errors';
import { toNotificationList } from '@/api/wire/notifications';
import { consentFixtures, resetConsentFixtures } from '@/fixtures/consents';

import { invalidOf } from './api';
import { consentRequests, ensureConsents } from './store';

beforeEach(() => {
  resetConsentFixtures({ granted: [] });
  consentRequests.settle(false);
});

describe('403 consent_required', () => {
  it('reads the missing consent types and drops unknown ones', () => {
    const error = new ApiError('http', 403, { status: 403, code: 'consent_required', missing: ['bodyPhotoAi', 'crossBorderTransfer', 'somethingNew'] });
    expect(isConsentRequired(error)).toBe(true);
    expect(missingConsents(error)).toEqual(['bodyPhotoAi', 'crossBorderTransfer']);
  });

  it('is nothing for other errors', () => {
    expect(missingConsents(new ApiError('http', 403, { status: 403, code: 'premium_required' }))).toEqual([]);
    expect(missingConsents(new Error('x'))).toEqual([]);
    expect(isConsentRequired(new ApiError('http', 409, { code: 'consent_required' }))).toBe(false);
  });
});

describe('consent gate', () => {
  it('passes at once when every consent is valid', async () => {
    resetConsentFixtures();
    await expect(ensureConsents(['bodyPhotoAi', 'crossBorderTransfer'], 'tryon')).resolves.toBe(true);
    expect(consentRequests.get()).toBeNull();
  });

  it('asks only for the missing ones and resolves with the answer', async () => {
    resetConsentFixtures({ granted: ['crossBorderTransfer'] });
    const answer = ensureConsents(['facePhotoPalette', 'crossBorderTransfer'], 'palette');
    await new Promise((r) => setTimeout(r, 500));
    expect(consentRequests.get()).toEqual({ types: ['facePhotoPalette'], source: 'palette' });
    consentRequests.settle(false);
    await expect(answer).resolves.toBe(false);
    expect(consentRequests.get()).toBeNull();
  });

  it('a second request for the same consents joins the open one; a different one replaces it', async () => {
    const first = consentRequests.request(['weight'], 'weight');
    expect(consentRequests.request(['weight'], 'settings')).toBe(first);
    const other = consentRequests.request(['contacts'], 'contacts');
    await expect(first).resolves.toBe(false);
    consentRequests.settle(true);
    await expect(other).resolves.toBe(true);
  });

  it('a text version the server no longer requires is not valid (re-prompt)', () => {
    const state = consentFixtures.get();
    const outdated = { consents: state.consents.map((c) => ({ ...c, granted: true, version: '2025-01-01', valid: false })) };
    expect(invalidOf(outdated, ['weight'])).toEqual(['weight']);
    expect(invalidOf(undefined, ['weight', 'contacts'])).toEqual(['weight', 'contacts']);
  });

  it('a grant with an older text version is refused (409 consent_version_outdated)', () => {
    expect(() =>
      consentFixtures.put({ consents: [{ type: 'weight', granted: true, version: '2025-01-01' }], source: 'weight', locale: 'tr' }),
    ).toThrow(expect.objectContaining({ code: 'consent_version_outdated' }));
  });
});

describe('notification inbox wire', () => {
  it('maps the page, keeps the server unread count and drops types the app cannot phrase', () => {
    const list = toNotificationList({
      items: [
        { id: 'n1', type: 'follow_request', createdAt: '2026-11-19T08:00:00Z', readAt: null, data: { handle: 'selin' } },
        { id: 'n2', type: 'brand_new_type', createdAt: '2026-11-19T07:00:00Z', readAt: null, data: {} },
        { id: 'n3', type: 'weekly_edit', createdAt: '2026-11-18T07:00:00Z', readAt: '2026-11-18T09:00:00Z', data: null },
      ],
      pageToken: 'next',
      unreadCount: 7,
    });
    expect(list.items.map((n) => [n.id, n.kind, n.data])).toEqual([
      ['n1', 'follow_request', { handle: 'selin' }],
      ['n3', 'weekly_edit', {}],
    ]);
    expect(list.unreadCount).toBe(7);
    expect(list.pageToken).toBe('next');
  });
});
