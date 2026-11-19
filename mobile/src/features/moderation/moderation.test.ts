import { toNotification } from '@/api/wire/notifications';
import { toModeration } from '@/api/wire/wardrobe';
import { targetOf } from '@/features/notifications/logic';
import { routeForPush } from '@/notify/routes';

import { isModerationOnlyChange } from './logic';

const hidden = { hidden: true as const, reason: 'inappropriate' };

describe('content_removed inbox row', () => {
  it('is kept (not dropped as unknown) with its target and reason', () => {
    const n = toNotification({
      id: 'n1',
      type: 'content_removed',
      createdAt: '2026-11-19T09:00:00Z',
      readAt: null,
      data: { targetKind: 'look', targetId: 'look_1', reason: 'inappropriate' },
    });
    expect(n).toEqual({
      id: 'n1',
      kind: 'content_removed',
      createdAt: '2026-11-19T09:00:00Z',
      readAt: null,
      data: { targetKind: 'look', targetId: 'look_1', reason: 'inappropriate' },
    });
  });

  it('drops an unknown target kind but keeps the row', () => {
    const n = toNotification({ id: 'n2', type: 'content_removed', createdAt: '2026-11-19T09:00:00Z', readAt: null, data: { targetKind: 'trip' } });
    expect(n?.data).toEqual({});
  });

  it('opens the removed look, the removed piece, or Profili düzenle', () => {
    const at = '2026-11-19T09:00:00Z';
    expect(targetOf({ id: 'a', kind: 'content_removed', createdAt: at, readAt: null, data: { targetKind: 'look', targetId: 'L1' } })).toEqual({
      pathname: '/look/[id]',
      params: { id: 'L1' },
    });
    expect(targetOf({ id: 'b', kind: 'content_removed', createdAt: at, readAt: null, data: { targetKind: 'item', targetId: 'I1' } })).toEqual({
      pathname: '/item/[id]',
      params: { id: 'I1' },
    });
    expect(targetOf({ id: 'c', kind: 'content_removed', createdAt: at, readAt: null, data: { targetKind: 'profile' } })).toBe('/edit-profile');
    expect(routeForPush({ type: 'content_removed', targetKind: 'look' })).toBe('/wardrobe/looks');
    expect(routeForPush({ type: 'content_removed', targetKind: 'item', targetId: '../x' })).toBe('/');
  });
});

describe('moderation on LookDto / ItemDto', () => {
  it('maps the owner-only field', () => {
    expect(toModeration(null)).toBeNull();
    expect(toModeration(undefined)).toBeNull();
    expect(toModeration({ hidden: false })).toBeNull();
    expect(toModeration({ hidden: true })).toEqual({ hidden: true, reason: null });
    expect(toModeration({ hidden: true, reason: 'spam' })).toEqual({ hidden: true, reason: 'spam' });
  });

  it('treats a 409 whose current record only switched moderation as the moderator’s version bump', () => {
    expect(isModerationOnlyChange({ moderation: null }, { moderation: hidden })).toBe(true);
    expect(isModerationOnlyChange({ moderation: hidden }, { moderation: null })).toBe(true);
    expect(isModerationOnlyChange({ moderation: null }, { moderation: null })).toBe(false);
    expect(isModerationOnlyChange({ moderation: hidden }, { moderation: hidden })).toBe(false);
    expect(isModerationOnlyChange(undefined, { moderation: hidden })).toBe(false);
  });
});
