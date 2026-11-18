import { ApiError } from '@/api/errors';
import { mapIncomingLink } from '@/features/social/deepLinks';
import { isFinalInviteAnswer } from '@/features/social/mutations';
import { withShareUrl } from '@/features/social/share';

import {
  fromReportReason,
  storiesFromLooks,
  toFeedLook,
  toFeedPage,
  toInviteLink,
  toItemTile,
  toLookTile,
  followStateOf,
  toFollowRequest,
  toPersonProfile,
  toPersonSuggestion,
  type PersonProfileWire,
  type SocialLookWire,
} from './social';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  AFTER_FIRST_UNLOCK: 0,
}));

const NOW = Date.parse('2026-11-18T12:00:00Z');

const look = (over: Partial<SocialLookWire> = {}): SocialLookWire => ({
  id: '01LOOK',
  ownerHandle: 'ayse',
  ownerDisplayName: 'Ayşe',
  name: 'Ofis',
  occasion: 'office',
  createdAt: '2026-11-18T09:00:00Z',
  pieces: [
    { slot: 'top', itemId: 'i1', productId: null, name: 'Beyaz gömlek', imageUrl: null, product: null },
    {
      slot: 'bagAccessory',
      itemId: null,
      productId: 'lx-bag',
      name: 'Deri El Çantası',
      imageUrl: 'https://cdn.example/bag.jpg',
      product: {
        id: 'lx-bag',
        brandId: 'vakko',
        brandName: 'Vakko',
        name: 'Deri El Çantası',
        description: null,
        category: 'bag',
        slot: 'bag',
        colors: ['black'],
        sizes: [],
        priceMinor: 1250000,
        currency: 'TRY',
        previousPriceMinor: null,
        priceBand: 'luxuryTouch',
        images: ['https://cdn.example/bag.jpg'],
        available: true,
        createdAt: '2026-11-01T00:00:00Z',
      },
    },
  ],
  rating: { average: 4.6, count: 12, myScore: 5 },
  saved: false,
  ...over,
});

describe('social wire mappers', () => {
  it('maps a SocialLookDto to a feed look: first piece image as the cover, app slot names, rating summary', () => {
    const mapped = toFeedLook(look());
    expect(mapped).toMatchObject({
      lookId: '01LOOK',
      name: 'Ofis',
      author: { handle: 'ayse', displayName: 'Ayşe', avatarUrl: null, isFollowing: true },
      occasion: 'office',
      postedAt: '2026-11-18T09:00:00Z',
      imageUrl: 'https://cdn.example/bag.jpg',
      myRating: 5,
      averageRating: 4.6,
      ratingCount: 12,
      saved: false,
    });
    expect(mapped.pieces?.[1]).toEqual({
      slot: 'accessory',
      itemId: null,
      productId: 'lx-bag',
      name: 'Deri El Çantası',
      imageUrl: 'https://cdn.example/bag.jpg',
      brandName: 'Vakko',
      price: { amountMinor: 1250000, currency: 'TRY' },
    });
  });

  it('reads an unrated look as "no average"', () => {
    const mapped = toFeedLook(look({ rating: { average: null, count: 0, myScore: null } }));
    expect(mapped).toMatchObject({ myRating: null, averageRating: null, ratingCount: 0 });
    expect(toFeedLook(look({ rating: null })).ratingCount).toBe(0);
  });

  it('derives the story ring from the authors of the first page only', () => {
    const wire = {
      items: [look(), look({ id: '02', createdAt: '2026-11-10T09:00:00Z' }), look({ id: '03', ownerHandle: 'elif', ownerDisplayName: null, createdAt: '2026-11-01T09:00:00Z' })],
      pageToken: 'next',
    };
    const first = toFeedPage(wire, true);
    expect(first.nextPageToken).toBe('next');
    expect(first.items).toHaveLength(3);
    expect(storiesFromLooks(first.items, NOW)).toEqual([
      { handle: 'ayse', displayName: 'Ayşe', avatarUrl: null, hasNew: true },
      { handle: 'elif', displayName: '@elif', avatarUrl: null, hasNew: false },
    ]);
    expect(toFeedPage({ items: wire.items, pageToken: null }, false)).toMatchObject({ stories: [], nextPageToken: null });
  });

  it('maps person cards and profiles (camelCase tags, locked closet, no avatar)', () => {
    const profile: PersonProfileWire = {
      handle: 'ayse',
      displayName: 'Ayşe',
      styleTags: ['minimal', 'quietLuxury', 'officeChic'],
      styleMatchPercent: 50,
      isSelf: false,
      isFollowing: false,
      followsYou: true,
      closetVisibility: 'followersOnly',
      closetLocked: true,
      itemCount: null,
      lookCount: null,
      followerCount: 12,
      followingCount: 30,
    };
    expect(toPersonProfile(profile)).toEqual({
      handle: 'ayse',
      displayName: 'Ayşe',
      avatarUrl: null,
      styleTags: ['minimal', 'quiet_luxury', 'office_chic'],
      itemCount: null,
      lookCount: null,
      styleMatch: 50,
      isFollowing: false,
      followState: 'none',
      requestedYou: false,
      closetVisibility: 'followers',
      closetVisible: false,
      isSelf: false,
      followsYou: true,
      followerCount: 12,
      followingCount: 30,
    });
    expect(toPersonSuggestion({ handle: 'b', displayName: null, styleTags: [], styleMatchPercent: 20, isFollowing: true, followsYou: false })).toMatchObject({
      handle: 'b',
      displayName: '@b',
      styleMatch: 20,
      isFollowing: true,
      followState: 'following',
    });
  });

  it('maps the follow state: a pending request is not following', () => {
    const card = { handle: 'elif', displayName: 'Elif', styleTags: [], styleMatchPercent: 0, isFollowing: false, followsYou: false };
    expect(toPersonSuggestion({ ...card, followState: 'requested', requestedYou: true })).toMatchObject({
      followState: 'requested',
      isFollowing: false,
      requestedYou: true,
    });
    expect(followStateOf({ isFollowing: false })).toBe('none');
    expect(followStateOf({ isFollowing: true })).toBe('following');
    expect(toFollowRequest({ person: { ...card, requestedYou: true }, createdAt: '2026-11-18T09:00:00Z' })).toEqual({
      person: expect.objectContaining({ handle: 'elif', followState: 'none', requestedYou: true }),
      createdAt: '2026-11-18T09:00:00Z',
    });
    expect(
      toPersonProfile({
        ...card,
        followState: 'requested',
        isSelf: false,
        closetVisibility: 'private',
        closetLocked: true,
        itemCount: null,
        lookCount: null,
        followerCount: 0,
        followingCount: 0,
      }),
    ).toMatchObject({ followState: 'requested', isFollowing: false, closetVisibility: 'private', closetVisible: false });
  });

  it('maps profile tiles, the invite link and report reasons', () => {
    expect(toLookTile(look())).toEqual({ id: '01LOOK', name: 'Ofis', imageUrl: 'https://cdn.example/bag.jpg' });
    expect(toItemTile({ id: 'i1', name: 'Beyaz tişört', category: 'top', colors: ['white'], imageUrl: null })).toEqual({
      id: 'i1',
      name: 'Beyaz tişört',
      imageUrl: null,
    });
    expect(toInviteLink({ code: 'ABCDEFGH', url: 'https://droblet.alatech.co/i/ABCDEFGH', invitedCount: 1 })).toEqual({
      code: 'ABCDEFGH',
      url: 'https://droblet.alatech.co/i/ABCDEFGH',
      invitedCount: 1,
    });
    expect(fromReportReason('minor_safety')).toBe('minorSafety');
    expect(fromReportReason('spam')).toBe('spam');
  });
});

describe('share and invite links from the server', () => {
  it('opens the server share link on the right screen and keeps the invite code', () => {
    expect(mapIncomingLink('https://droblet.alatech.co/i/ABCDEFGH')).toEqual({ path: '/friends/find', inviteCode: 'ABCDEFGH' });
    expect(mapIncomingLink('https://droblet.alatech.co/i/ABCDEFGH?t=look&id=01LOOK&u=ayse')).toEqual({
      path: '/friends/feed?look=01LOOK',
      inviteCode: 'ABCDEFGH',
    });
    expect(mapIncomingLink('https://droblet.alatech.co/i/ABCDEFGH?t=profile&u=ayse')).toEqual({ path: '/u/ayse', inviteCode: 'ABCDEFGH' });
    expect(mapIncomingLink('droplet://i/ABCDEFGH?t=product&id=hs-white-shirt').path).toBe('/shop/product/hs-white-shirt');
  });

  it('puts the server link into the message, or keeps the device link when there is none', () => {
    const local = 'https://droblet.alatech.co/l/01LOOK?invite=ABCDEFGH';
    expect(withShareUrl(`Bak: ${local}`, local, 'https://droblet.alatech.co/i/ABCDEFGH?t=look&id=01LOOK')).toEqual({
      url: 'https://droblet.alatech.co/i/ABCDEFGH?t=look&id=01LOOK',
      message: 'Bak: https://droblet.alatech.co/i/ABCDEFGH?t=look&id=01LOOK',
    });
    expect(withShareUrl(`Bak: ${local}`, local, null)).toEqual({ url: local, message: `Bak: ${local}` });
  });

  it('treats 404 / 409 / 422 of the invite attribution as final', () => {
    expect(isFinalInviteAnswer(new ApiError('http', 409, { code: 'invite_already_attributed' }))).toBe(true);
    expect(isFinalInviteAnswer(new ApiError('http', 404, { code: 'invite_code_not_found' }))).toBe(true);
    expect(isFinalInviteAnswer(new ApiError('http', 422, { code: 'invite_window_closed' }))).toBe(true);
    expect(isFinalInviteAnswer(new ApiError('http', 500, null))).toBe(false);
    expect(isFinalInviteAnswer(new ApiError('network', null, null))).toBe(false);
  });
});
