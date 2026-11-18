import type {
  ContactHash,
  ContactSalt,
  FeedLook,
  FeedPiece,
  FeedPage,
  FeedStory,
  FollowRequestDirection,
  FollowRequestEntry,
  FollowState,
  InviteLink,
  PersonProfile,
  PersonSuggestion,
  PersonTile,
  PersonTrip,
} from '@/api/contracts/social';
import { ApiError } from '@/api/errors';
import { applyRating } from '@/features/social/feedMath';

/**
 * Typed fixtures for E9 (arkadaş akışı, kişi profili, dolapları keşfet). First names and handles are
 * invented samples — no real people. Looks carry no image (piece collage placeholder): another
 * person's try-on image is never shown.
 */

type Person = PersonProfile & { blocked: boolean; followsMe?: boolean };

type Seed = Omit<PersonProfile, 'followState' | 'requestedYou' | 'closetVisibility'> & { blocked: boolean };

/** Fixture people: a hidden closet is a followers-only account (follow = request); `elif` asked to follow me. */
function withRelations(p: Seed): Person {
  return {
    ...p,
    followState: p.isFollowing ? 'following' : 'none',
    requestedYou: p.handle === 'elif',
    followsMe: p.handle === 'selin',
    closetVisibility: p.closetVisible ? 'public' : 'followers',
  };
}

function seedPeople(): Person[] {
  const seed: Seed[] = [
    { handle: 'selin', displayName: 'Selin', avatarUrl: null, styleTags: ['minimal', 'quiet_luxury', 'office_chic'], itemCount: 142, lookCount: 38, styleMatch: 82, isFollowing: true, closetVisible: true, blocked: false },
    { handle: 'elif', displayName: 'Elif', avatarUrl: null, styleTags: ['classic', 'romantic', 'minimal'], itemCount: 96, lookCount: 21, styleMatch: 88, isFollowing: false, closetVisible: true, blocked: false },
    { handle: 'zeynep', displayName: 'Zeynep', avatarUrl: null, styleTags: ['street', 'sporty', 'colorful'], itemCount: 64, lookCount: 12, styleMatch: 81, isFollowing: false, closetVisible: true, blocked: false },
    { handle: 'ayse', displayName: 'Ayşe', avatarUrl: null, styleTags: ['boho', 'vintage', 'romantic'], itemCount: 58, lookCount: 9, styleMatch: 69, isFollowing: true, closetVisible: true, blocked: false },
    { handle: 'deniz', displayName: 'Deniz', avatarUrl: null, styleTags: ['classic', 'vintage', 'minimal'], itemCount: null, lookCount: null, styleMatch: 74, isFollowing: false, closetVisible: false, blocked: false },
    { handle: 'ornek_stilist', displayName: '@ornek_stilist', avatarUrl: null, styleTags: ['quiet_luxury', 'office_chic', 'classic'], itemCount: 210, lookCount: 64, styleMatch: 77, isFollowing: false, closetVisible: true, blocked: false },
    { handle: 'ornek_editor', displayName: 'Stil editörü', avatarUrl: null, styleTags: ['minimal', 'classic', 'street'], itemCount: 180, lookCount: 52, styleMatch: 72, isFollowing: false, closetVisible: true, blocked: false },
  ];
  return seed.map(withRelations);
}

/** A wardrobe piece of a sample look: no picture, so the collage draws its category on its colour. */
function piece(category: string, color: string): FeedPiece {
  return { slot: category, itemId: null, productId: null, name: '', imageUrl: null, brandName: null, price: null, category, color };
}

type LookRow = Omit<FeedLook, 'author' | 'postedAt'> & { handle: string; hoursAgo: number };

function seedLooks(): LookRow[] {
  return [
    {
      lookId: 'flook_1',
      handle: 'selin',
      occasion: 'wedding',
      hoursAgo: 2,
      imageUrl: null,
      pieces: [
        piece('dress', 'navy'),
        piece('outerwear', 'cream'),
        piece('shoes', 'beige'),
        piece('bag', 'black'),
      ],
      myRating: null,
      averageRating: 4.7,
      ratingCount: 12,
      saved: false,
    },
    {
      lookId: 'flook_2',
      handle: 'ayse',
      occasion: 'weekend',
      hoursAgo: 9,
      imageUrl: null,
      pieces: [
        piece('top', 'white'),
        piece('bottom', 'blue'),
        piece('shoes', 'brown'),
      ],
      myRating: 4,
      averageRating: 4.2,
      ratingCount: 5,
      saved: true,
    },
    {
      lookId: 'flook_3',
      handle: 'selin',
      occasion: 'office',
      hoursAgo: 30,
      imageUrl: null,
      pieces: [
        piece('outerwear', 'navy'),
        piece('top', 'white'),
        piece('bottom', 'black'),
        piece('bag', 'brown'),
      ],
      myRating: null,
      averageRating: null,
      ratingCount: 0,
      saved: false,
    },
  ];
}

let people = seedPeople();
let looks = seedLooks();

/** Test helper: back to the seeded state. */
export function resetSocialFixtures(): void {
  people = seedPeople();
  looks = seedLooks();
}

/** Category / colour of the placeholder closet tiles (26). */
const TILE_CATEGORIES = ['top', 'bottom', 'outerwear', 'dress', 'shoes', 'bag'] as const;
const TILE_COLORS = ['white', 'navy', 'beige', 'black', 'brown', 'cream', 'grey'] as const;

function notFound(): never {
  throw new ApiError('http', 404, { status: 404, code: 'not_found' });
}

function person(handle: string): Person {
  const found = people.find((p) => p.handle === handle && !p.blocked);
  return found ?? notFound();
}

function visiblePerson(handle: string): Person {
  const p = person(handle);
  return p.closetVisible ? p : notFound();
}

const ref = ({ handle, displayName, avatarUrl }: Person) => ({ handle, displayName, avatarUrl });

const card = (p: Person): PersonSuggestion => ({
  ...ref(p),
  styleMatch: p.styleMatch,
  isFollowing: p.followState === 'following',
  followState: p.followState,
  requestedYou: p.requestedYou,
});

const setState = (handle: string, patch: Partial<Person>) => {
  people = people.map((p) => (p.handle === handle ? { ...p, ...patch } : p));
};

const REQUEST_AT = '2026-11-18T09:00:00.000Z';

export const socialFixtures = {
  feed: (pageToken: string | null): FeedPage => {
    const following = people.filter((p) => p.isFollowing && !p.blocked);
    const stories: FeedStory[] = following.map((p) => ({ ...ref(p), hasNew: looks.some((l) => l.handle === p.handle && l.hoursAgo < 24) }));
    const items: FeedLook[] = looks
      .filter((l) => following.some((p) => p.handle === l.handle))
      .map(({ handle, hoursAgo, ...rest }) => {
        const author = person(handle);
        return {
          ...rest,
          author: { ...ref(author), isFollowing: author.isFollowing },
          postedAt: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
        };
      });
    return { stories: pageToken ? [] : stories, items: pageToken ? [] : items, nextPageToken: null };
  },
  rate: (lookId: string, score: number): void => {
    looks = looks.map((l) => (l.lookId === lookId ? { ...l, ...applyRating(l, score) } : l));
  },
  save: (lookId: string, saved: boolean): void => {
    looks = looks.map((l) => (l.lookId === lookId ? { ...l, saved } : l));
  },
  /** Public closets are followed at once, the others get a request (like the server). */
  follow: (handle: string, follow: boolean): FollowState => {
    const p = person(handle);
    const followState: FollowState = !follow ? 'none' : p.closetVisibility === 'public' ? 'following' : 'requested';
    setState(handle, { followState, isFollowing: followState === 'following' });
    return followState;
  },
  block: (handle: string): void => {
    setState(handle, { blocked: true, isFollowing: false, followState: 'none', requestedYou: false, followsMe: false });
  },
  followRequests: (direction: FollowRequestDirection): FollowRequestEntry[] =>
    people
      .filter((p) => !p.blocked && (direction === 'incoming' ? p.requestedYou : p.followState === 'requested'))
      .map((p) => ({ person: card(p), createdAt: REQUEST_AT })),
  answerRequest: (handle: string, action: 'approve' | 'decline' | 'cancel'): void => {
    if (action === 'cancel') setState(handle, { followState: 'none', isFollowing: false });
    else setState(handle, { requestedYou: false, ...(action === 'approve' ? { followsMe: true } : {}) });
  },
  removeFollower: (handle: string): void => setState(handle, { followsMe: false }),
  contactSalt: (): ContactSalt => ({
    saltId: 'salt_1',
    salt: 'c2FsdA',
    prefixLength: 3,
    maxHashes: 1000,
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  }),
  /** Fixture matching: every upload finds the two sample friends that are not followed yet. */
  matchContacts: (hashes: ContactHash[]): PersonSuggestion[] =>
    hashes.length === 0 ? [] : people.filter((p) => !p.blocked && ['zeynep', 'deniz'].includes(p.handle)).map(card),

  profile: (handle: string): PersonProfile => {
    const { blocked: _blocked, followsMe: _followsMe, ...profile } = person(handle);
    void _blocked;
    void _followsMe;
    return profile;
  },
  looks: (handle: string): PersonTile[] => {
    const p = visiblePerson(handle);
    return Array.from({ length: Math.min(p.lookCount ?? 0, 6) }, (_, i) => ({ id: `${handle}_look_${i + 1}`, name: `Look ${i + 1}`, imageUrl: null }));
  },
  items: (handle: string): PersonTile[] => {
    const p = visiblePerson(handle);
    return Array.from({ length: Math.min(p.itemCount ?? 0, 9) }, (_, i) => ({
      id: `${handle}_item_${i + 1}`,
      name: `Parça ${i + 1}`,
      imageUrl: null,
      category: TILE_CATEGORIES[i % TILE_CATEGORIES.length],
      color: TILE_COLORS[i % TILE_COLORS.length],
    }));
  },
  trips: (handle: string): PersonTrip[] => {
    visiblePerson(handle);
    return handle === 'selin'
      ? [
          { id: 'trip_1', city: 'Roma', month: '2026-09' },
          { id: 'trip_2', city: 'Bodrum', month: '2026-07' },
        ]
      : [];
  },

  search: (q: string): PersonSuggestion[] => {
    const needle = q.replace(/^@/, '').toLowerCase().trim();
    if (needle === '') return [];
    return people
      .filter((p) => !p.blocked && p.handle.startsWith(needle))
      .map(card);
  },
  suggested: (): PersonSuggestion[] =>
    people
      .filter((p) => !p.blocked && !p.isFollowing && p.closetVisible && !p.handle.startsWith('ornek_'))
      .sort((a, b) => b.styleMatch - a.styleMatch)
      .map(card),

  savedLooks: (): FeedLook[] => socialFixtures.feed(null).items.filter((l) => l.saved),
  followers: (): PersonSuggestion[] => people.filter((p) => !p.blocked && p.followsMe).map((p) => ({ ...card(p), followsYou: true })),
  following: (): PersonSuggestion[] => people.filter((p) => !p.blocked && p.followState === 'following').map(card),
  blocked: (): PersonSuggestion[] => people.filter((p) => p.blocked).map((p) => ({ ...card(p), isFollowing: false, followState: 'none' })),
  unblock: (handle: string): void => setState(handle, { blocked: false }),

  inviteLink: (): InviteLink => ({ url: 'https://droblet.alatech.co/i/DAMLA24A', code: 'DAMLA24A', invitedCount: 0 }),
};
