import type { EditorStory, FeedLookMode, FeedPiece, FeedPost, FeedPostPage, FeedProduct, FeedTab } from '@/api/contracts/feed';
import { FEED_LOOK_MIN_PIECES, FEED_PAGE_SIZE } from '@/api/contracts/feed';
import type { Occasion } from '@/api/contracts';
import { LOOK_SLOTS, SLOT_CATEGORIES, type Look, type LookSlot, type LookSlotKind } from '@/api/contracts/looks';
import { ITEM_CATEGORIES, ITEM_SEASONS, type Item, type ItemCategory } from '@/api/contracts/wardrobe';
import type { ReportReason } from '@/api/contracts/social';
import type { ProductSummary } from '@/api/contracts/store';
import { ApiError } from '@/api/errors';
import { FEED_INVITE_OCCASIONS, feedTabOccasions } from '@/api/wire/feed';
import { currentTeenRules } from '@/features/teen/store';
import i18n from '@/i18n';

import { clone, fixtureDb, onFixtureSeed } from './db';
import { L } from './showcase';
import { productsFixture } from './store';
import { showcaseImage, showcaseImages, type ShowcaseImage } from './showcaseImages';

/**
 * Typed fixtures for Akış F1 (canvas 06″): editorial posts and stories. Author names are placeholders
 * ("Droblet Edit", "@ornek_stilist") — no real people. Photos are left out (`images: []` or unreachable
 * sample keys), so the look placeholder is drawn; real photos come from the admin panel through the API.
 * The module keeps a small in-memory state (likes, saves) reset with `resetFixtureDb`.
 *
 * Akış F2: two looks shared by members ("@ornek_kullanici", "@ornek_dolap" — placeholders) sit between the editor
 * posts (never more than one in three); "Bunu gösterme" and a report take a post out of this user's feed. Teen
 * accounts get editor posts only, as from the server.
 */

const HOUR = 60 * 60_000;

function product(id: string, ownedSimilar = false, ownedItemId: string | null = null): FeedProduct {
  const found = productsFixture.find((p) => p.id === id);
  if (!found) throw new Error(`fixture product ${id}`);
  return { ...found, name: L(found.name), ownedSimilar, ownedItemId };
}

function summary(id: string): ProductSummary {
  const found = productsFixture.find((p) => p.id === id);
  if (!found) throw new Error(`fixture product ${id}`);
  return { ...found, name: L(found.name) };
}

const EDIT = { kind: 'edit' as const, name: 'Droblet Edit', handle: null, imageUrl: null, verified: true };
const member = (handle: string) => ({ kind: 'user' as const, name: `@${handle}`, handle, imageUrl: null, verified: false });
const STYLIST = { kind: 'stylist' as const, name: '@ornek_stilist', handle: 'ornek_stilist', imageUrl: null, verified: false };

type Seed = {
  title: string;
  note: string | null;
  occasion: Occasion;
  edit: boolean;
  hoursAgo: number;
  imageCount: number;
  products: FeedProduct[];
  /** A photograph without products: the pieces cut out of it. */
  pieces?: FeedPiece[];
  likeCount: number;
};

function seeds(): Seed[] {
  return [
    {
      title: L('Ofiste bordo & camel'),
      note: L('Camel kaban bordoyu yumuşatır; siyah pantolon ve loafer ofise taşır.'),
      occasion: 'office',
      edit: true,
      hoursAgo: 3,
      imageCount: 4,
      // Two owned pieces are known wardrobe items: "Kendi parçalarımla kur" shows.
      products: [product('prod_011', true, 'item_beige_trench'), product('prod_022', true, 'item_cream_knit'), product('prod_004'), product('prod_015')],
      likeCount: 1284,
    },
    {
      title: L('Hafta sonuna krem tonlar'),
      note: L('Pazar kahvaltısı için krem katmanlar.'),
      occasion: 'weekend',
      edit: false,
      hoursAgo: 5,
      imageCount: 1,
      products: [],
      likeCount: 846,
    },
    {
      title: L('Davette saten'),
      note: L('Bordo saten elbise, siyah clutch ve topuklu bot.'),
      occasion: FEED_INVITE_OCCASIONS[0]!,
      edit: true,
      hoursAgo: 9,
      imageCount: 2,
      products: [product('prod_008'), product('prod_034'), product('prod_031', true)],
      likeCount: 412,
    },
    {
      title: L('Gri flanel, beyaz gömlek'),
      note: null,
      occasion: 'office',
      edit: false,
      hoursAgo: 20,
      imageCount: 3,
      products: [product('prod_019'), product('prod_001', true)],
      likeCount: 233,
    },
    {
      title: L('Jean ve trençkot'),
      note: L('Bej trençkot her jean ile çalışır.'),
      occasion: 'weekend',
      edit: true,
      hoursAgo: 26,
      imageCount: 2,
      // A photograph without products: the piece strip (picture + kind) stands where the product strip is.
      products: [],
      pieces: [piece('outerwear'), piece('bottom'), piece('shoes')],
      likeCount: 978,
    },
    ...Array.from({ length: 8 }, (_, i): Seed => ({
      title: L('Ofis için katmanlar') + ` ${i + 1}`,
      note: null,
      occasion: i % 2 === 0 ? 'office' : 'weekend',
      edit: i % 3 !== 0,
      hoursAgo: 30 + i * 6,
      imageCount: 1 + (i % 3),
      products: [product('prod_005'), product('prod_006', i % 2 === 0)],
      likeCount: 120 + i * 17,
    })),
  ];
}

type UserSeed = { id: string; handle: string; title: string; occasion: Occasion; hoursAgo: number; pieces: FeedPiece[]; hasSimilar: boolean; likeCount: number; similar: string[] };

const piece = (category: string): FeedPiece => ({ category, imageUrl: null });

/** Looks shared by members, and the editor post each one follows in the list. */
function userSeeds(): { after: number; seed: UserSeed }[] {
  return [
    {
      after: 1,
      seed: {
        id: 'upost_001',
        handle: 'ornek_kullanici',
        title: L('Desenli kazak'),
        occasion: 'weekend',
        hoursAgo: 1,
        pieces: [piece('top'), piece('bottom'), piece('shoes'), piece('bag')],
        hasSimilar: true,
        likeCount: 38,
        similar: ['prod_022', 'prod_020', 'prod_015'],
      },
    },
    {
      after: 4,
      seed: {
        id: 'upost_002',
        handle: 'ornek_dolap',
        title: L('Siyah ve bej'),
        occasion: 'office',
        hoursAgo: 14,
        pieces: [piece('outerwear'), piece('bottom'), piece('shoes')],
        hasSimilar: false,
        likeCount: 7,
        similar: [],
      },
    },
  ];
}

function buildUser(now: number, s: UserSeed): FeedPost {
  return {
    id: s.id,
    kind: 'user',
    author: member(s.handle),
    occasion: s.occasion,
    publishedAt: new Date(now - s.hoursAgo * HOUR).toISOString(),
    title: s.title,
    note: null,
    images: [showcaseImage(USER_COVERS[s.id]) ?? `fixture://feed/${s.id}/cover`],
    products: [],
    pieces: s.pieces,
    hasSimilar: s.hasSimilar,
    canTryOn: false,
    buyableCount: 0,
    likeCount: s.likeCount,
    liked: false,
    saved: false,
  };
}

function build(now: number): FeedPost[] {
  const editor = buildEditor(now);
  const out: FeedPost[] = [];
  const users = userSeeds();
  editor.forEach((post, index) => {
    out.push(post);
    for (const u of users) if (u.after === index + 1) out.push(buildUser(now, u.seed));
  });
  return out;
}

/** Showcase pictures of the first editor posts (by position), the shared looks and the stories; the rest keep their placeholders. */
const POST_IMAGES: readonly (readonly ShowcaseImage[])[] = [
  ['feed-office', 'story-winter'],
  ['feed-weekend'],
  ['feed-invite'],
  [],
  ['story-trench'],
];
const USER_COVERS: Record<string, ShowcaseImage | undefined> = { upost_001: 'cover-friend-weekend', upost_002: 'cover-cream-layers' };
const STORY_IMAGES: Record<string, ShowcaseImage | undefined> = { story_001: 'feed-office', story_002: 'feed-weekend', story_003: 'story-winter' };

/** `count` picture addresses of a post: its showcase pictures first, placeholders ("fixture://…", never loads) for the rest. */
function postImages(index: number, id: string, count: number): string[] {
  const real = showcaseImages(POST_IMAGES[index] ?? []);
  return Array.from({ length: count }, (_, i) => real[i] ?? `fixture://feed/${id}/${i + 1}`);
}

function buildEditor(now: number): FeedPost[] {
  return seeds().map((s, index) => {
    const id = `post_${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      kind: 'editor' as const,
      author: s.edit ? EDIT : STYLIST,
      occasion: s.occasion,
      publishedAt: new Date(now - s.hoursAgo * HOUR).toISOString(),
      title: s.title,
      note: s.note,
      images: postImages(index, id, s.imageCount),
      products: s.products,
      pieces: s.pieces ?? [],
      hasSimilar: false,
      canTryOn: true,
      buyableCount: s.products.filter((p) => !p.ownedSimilar && p.available !== false).length,
      likeCount: s.likeCount,
      liked: false,
      saved: false,
    };
  });
}

function buildStories(now: number): EditorStory[] {
  const at = (h: number) => new Date(now - h * HOUR).toISOString();
  const story = (id: string, name: string, headline: string, productId: string | null, hoursAgo: number): EditorStory => ({
    id,
    author: { name, imageUrl: null },
    imageUrl: showcaseImage(STORY_IMAGES[id]) ?? `fixture://feed/story/${id}`,
    headline,
    product: productId ? product(productId) : null,
    publishedAt: at(hoursAgo),
  });
  return [
    story('story_001', 'Droblet Edit', L('Ofiste bordo & camel'), 'prod_004', 2),
    story('story_002', '@ornek_stilist', L('Hafta sonuna krem tonlar'), 'prod_020', 6),
    story('story_003', L('Kış edit\'i'), L('Kaşmir ve yün'), 'prod_030', 12),
  ];
}

type FeedReport = { postId: string; reason: ReportReason; note: string | null };

const state: {
  posts: FeedPost[];
  stories: EditorStory[];
  savedOrder: string[];
  failNext: boolean;
  hidden: string[];
  reports: FeedReport[];
  /** "Looklarıma ekle": `${postId}:${mode}` → the look made of it. */
  lookOf: Record<string, string>;
  failNextLook: { status: number; code: string } | null;
} = {
  posts: [],
  stories: [],
  savedOrder: [],
  failNext: false,
  hidden: [],
  reports: [],
  lookOf: {},
  failNextLook: null,
};

export function resetFeedFixtures(options: { empty?: boolean } = {}): void {
  const now = Date.now();
  state.posts = options.empty ? [] : build(now);
  state.stories = options.empty ? [] : buildStories(now);
  state.savedOrder = [];
  state.failNext = false;
  state.hidden = [];
  state.reports = [];
  state.lookOf = {};
  state.failNextLook = null;
}

onFixtureSeed((_db, { empty }) => resetFeedFixtures({ empty }));

/** Test switches. */
export const feedFixtureOptions = {
  /** The next feed read fails with a final answer (no retry), so the error state shows at once. */
  failNextRead() {
    state.failNext = true;
  },
  setPosts(posts: FeedPost[]) {
    state.posts = posts;
  },
  /** The next "Looklarıma ekle" fails with this server answer (final, no retry). */
  failNextSaveAsLook(status: number, code: string) {
    state.failNextLook = { status, code };
  },
};

/** The slot a piece of this category takes when a rule builds the look (the server's default slot; a dress fills "top"). */
function slotOf(category: string): LookSlotKind | null {
  return LOOK_SLOTS.find((slot) => (SLOT_CATEGORIES[slot] as readonly string[]).includes(category)) ?? null;
}

/**
 * POST v1/tenant/feed-post/{id}/look with the server's rules: an editor post with pieces only; as inspiration the look
 * has no pieces and the post's photograph as its cover; with its pieces every piece becomes a wardrobe item (colour
 * "other", every season, named after its kind) and the look takes one piece per slot (the first keeps a contested slot, a
 * dress closes the bottom) — at least two, or 422 `look_not_savable`. The same post + mode again answers the same look.
 */
function saveAsLook(postId: string, mode: FeedLookMode, requestId: string): Look {
  const failure = state.failNextLook;
  if (failure) {
    state.failNextLook = null;
    throw new ApiError('http', failure.status, { status: failure.status, code: failure.code });
  }
  const post = find(postId);
  if (post.kind !== 'editor') throw new ApiError('http', 404, { code: 'not_found', status: 404 });
  const notSavable = () => new ApiError('http', 422, { code: 'look_not_savable', status: 422 });
  if (post.pieces.length === 0) throw notSavable();

  const key = `${postId}:${mode}`;
  const existing = fixtureDb.looks.find((l) => l.id === state.lookOf[key]);
  if (existing) return clone(existing);

  const base = {
    id: requestId,
    name: post.title.slice(0, 60),
    occasion: post.occasion ?? 'weekend',
    isFavorite: false,
    rating: null,
    ratingCount: 0,
    tryOnImageUrl: null,
    createdAt: new Date().toISOString(),
    baseVersion: 1,
  } satisfies Partial<Look>;

  let look: Look;
  if (mode === 'inspiration') {
    look = { ...base, slots: [], coverImageUrl: post.images[0] ?? null, coverPending: false, inspiration: true };
  } else {
    const taken = new Set<LookSlotKind>();
    const slots: (LookSlotKind | null)[] = post.pieces.map(() => null);
    // A dress decides top / bottom first; then the pieces in their order (the first keeps a contested slot).
    const order = post.pieces.map((_, index) => index).sort((a, b) => Number(post.pieces[b]?.category === 'dress') - Number(post.pieces[a]?.category === 'dress') || a - b);
    for (const index of order) {
      const category = post.pieces[index]?.category ?? '';
      const slot = slotOf(category);
      if (!slot || taken.has(slot)) continue;
      taken.add(slot);
      slots[index] = slot;
      if (category === 'dress') taken.add('bottom');
    }
    if (slots.filter(Boolean).length < FEED_LOOK_MIN_PIECES) throw notSavable();

    const items: Item[] = post.pieces.map((piece, index) => {
      const category = ((ITEM_CATEGORIES as readonly string[]).includes(piece.category) ? piece.category : 'accessory') as ItemCategory;
      return {
        id: `${requestId}_p${index + 1}`,
        name: i18n.t(`homeFeed.pieceKind.${category}`),
        category,
        subcategory: null,
        brand: null,
        size: null,
        color: 'other',
        fabric: null,
        seasons: [...ITEM_SEASONS],
        imageUrl: piece.imageUrl,
        originalImageUrl: null,
        useOriginalImage: false,
        wearCount: 0,
        lastWornAt: null,
        createdAt: base.createdAt,
        baseVersion: 1,
      };
    });
    fixtureDb.items = [...items, ...fixtureDb.items];
    const lookSlots: LookSlot[] = items.flatMap((item, index) => {
      const slot = slots[index];
      return slot ? [{ slot, source: 'wardrobe' as const, refId: item.id, name: item.name, imageUrl: item.imageUrl, brand: null, price: null, deleted: false }] : [];
    });
    look = { ...base, slots: LOOK_SLOTS.flatMap((slot) => lookSlots.filter((s) => s.slot === slot)), coverPending: true };
  }
  fixtureDb.looks = [look, ...fixtureDb.looks];
  state.lookOf[key] = look.id;
  return clone(look);
}

function find(id: string): FeedPost {
  const post = state.posts.find((p) => p.id === id);
  if (!post) throw new ApiError('http', 404, { code: 'not_found', status: 404 });
  return post;
}

export const feedFixtures = {
  page: (tab: FeedTab, pageToken: string | null): FeedPostPage => {
    if (state.failNext) {
      state.failNext = false;
      throw new ApiError('http', 400, { code: 'bad_request', status: 400 });
    }
    const occasions: readonly string[] | null = feedTabOccasions(tab);
    // Teen accounts get editor content only (decision 17).
    const visible = currentTeenRules().isTeen ? state.posts.filter((p) => p.kind !== 'user') : state.posts;
    const all = occasions ? visible.filter((p) => p.occasion !== null && occasions.includes(p.occasion)) : visible;
    const start = pageToken ? Number(pageToken) : 0;
    const items = all.slice(start, start + FEED_PAGE_SIZE).map((p) => ({ ...p }));
    const next = start + FEED_PAGE_SIZE;
    return { items, nextPageToken: next < all.length ? String(next) : null };
  },
  stories: (): EditorStory[] => state.stories.map((s) => ({ ...s })),
  like: (id: string, liked: boolean): { liked: boolean; likeCount: number } => {
    const post = find(id);
    if (post.liked !== liked) post.likeCount = Math.max(0, post.likeCount + (liked ? 1 : -1));
    post.liked = liked;
    return { liked, likeCount: post.likeCount };
  },
  save: (id: string, saved: boolean): void => {
    const post = find(id);
    post.saved = saved;
    state.savedOrder = state.savedOrder.filter((s) => s !== id);
    if (saved) state.savedOrder.unshift(id);
  },
  saved: (): FeedPost[] =>
    state.savedOrder.map((id) => state.posts.find((p) => p.id === id)).filter((p): p is FeedPost => Boolean(p)).map((p) => ({ ...p })),
  /** GET v1/tenant/feed-post/{id}/similar — catalogue products like the pieces of a member's look. */
  similar: (id: string): ProductSummary[] => {
    find(id);
    return (userSeeds().find((u) => u.seed.id === id)?.seed.similar ?? []).map(summary);
  },
  /** PUT v1/tenant/feed-post/{id}/hide — the post leaves this user's feed (and their saved list). Idempotent. */
  hide: (id: string): void => {
    if (!state.hidden.includes(id)) state.hidden.push(id);
    state.posts = state.posts.filter((p) => p.id !== id);
    state.savedOrder = state.savedOrder.filter((s) => s !== id);
  },
  /** POST v1/tenant/feed-post/{id}/report */
  report: (id: string, reason: ReportReason, note: string | null = null): { reportId: string } => {
    state.reports.push({ postId: id, reason, note });
    return { reportId: `report_${state.reports.length}` };
  },
  /** POST v1/tenant/feed-post/{id}/look — "Looklarıma ekle" (as inspiration, or with its pieces). */
  saveAsLook,
  /** Test helpers: what "Bunu gösterme" and "Şikâyet et" sent. */
  hiddenIds: (): string[] => [...state.hidden],
  reports: (): FeedReport[] => state.reports.map((r) => ({ ...r })),
};
