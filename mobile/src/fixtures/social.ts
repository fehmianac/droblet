import type {
  FeedLook,
  FeedPage,
  FeedStory,
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

type Person = PersonProfile & { blocked: boolean };

function seedPeople(): Person[] {
  return [
    { handle: 'selin', displayName: 'Selin', avatarUrl: null, styleTags: ['minimal', 'quiet_luxury', 'office_chic'], itemCount: 142, lookCount: 38, styleMatch: 82, isFollowing: true, closetVisible: true, blocked: false },
    { handle: 'elif', displayName: 'Elif', avatarUrl: null, styleTags: ['classic', 'romantic', 'minimal'], itemCount: 96, lookCount: 21, styleMatch: 88, isFollowing: false, closetVisible: true, blocked: false },
    { handle: 'zeynep', displayName: 'Zeynep', avatarUrl: null, styleTags: ['street', 'sporty', 'colorful'], itemCount: 64, lookCount: 12, styleMatch: 81, isFollowing: false, closetVisible: true, blocked: false },
    { handle: 'ayse', displayName: 'Ayşe', avatarUrl: null, styleTags: ['boho', 'vintage', 'romantic'], itemCount: 58, lookCount: 9, styleMatch: 69, isFollowing: true, closetVisible: true, blocked: false },
    { handle: 'deniz', displayName: 'Deniz', avatarUrl: null, styleTags: ['classic', 'vintage', 'minimal'], itemCount: null, lookCount: null, styleMatch: 74, isFollowing: false, closetVisible: false, blocked: false },
    { handle: 'ornek_stilist', displayName: '@ornek_stilist', avatarUrl: null, styleTags: ['quiet_luxury', 'office_chic', 'classic'], itemCount: 210, lookCount: 64, styleMatch: 77, isFollowing: false, closetVisible: true, blocked: false },
    { handle: 'ornek_editor', displayName: 'Stil editörü', avatarUrl: null, styleTags: ['minimal', 'classic', 'street'], itemCount: 180, lookCount: 52, styleMatch: 72, isFollowing: false, closetVisible: true, blocked: false },
  ];
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
        { category: 'dress', color: 'navy' },
        { category: 'outerwear', color: 'cream' },
        { category: 'shoes', color: 'beige' },
        { category: 'bag', color: 'black' },
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
        { category: 'top', color: 'white' },
        { category: 'bottom', color: 'blue' },
        { category: 'shoes', color: 'brown' },
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
        { category: 'outerwear', color: 'navy' },
        { category: 'top', color: 'white' },
        { category: 'bottom', color: 'black' },
        { category: 'bag', color: 'brown' },
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
  follow: (handle: string, follow: boolean): void => {
    people = people.map((p) => (p.handle === handle ? { ...p, isFollowing: follow } : p));
  },
  block: (handle: string): void => {
    people = people.map((p) => (p.handle === handle ? { ...p, blocked: true, isFollowing: false } : p));
  },

  profile: (handle: string): PersonProfile => {
    const { blocked: _blocked, ...profile } = person(handle);
    void _blocked;
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
      .map((p) => ({ ...ref(p), styleMatch: p.styleMatch, isFollowing: p.isFollowing }));
  },
  suggested: (): PersonSuggestion[] =>
    people
      .filter((p) => !p.blocked && !p.isFollowing && p.closetVisible && !p.handle.startsWith('ornek_'))
      .sort((a, b) => b.styleMatch - a.styleMatch)
      .map((p) => ({ ...ref(p), styleMatch: p.styleMatch, isFollowing: p.isFollowing })),

  inviteLink: (): InviteLink => ({ url: 'https://droblet.alatech.co/invite/DAMLA24', code: 'DAMLA24' }),
};
