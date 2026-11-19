import { productsFixture } from './store';
import type { Look, LookSlot, LookSlotKind } from '@/api/contracts/looks';
import {
  STYLIST_SUGGESTION_COUNT,
  type AcceptSuggestionRequest,
  type AcceptSuggestionResponse,
  type StylistOutfitRequest,
  type StylistOutfitResponse,
  type StylistOutfitResult,
  type StylistPiece,
  type StylistSuggestion,
  type StylistWeather,
  type WeatherForecastResponse,
} from '@/api/contracts/stylist';
import type { Item, ItemCategory } from '@/api/contracts/wardrobe';
import { fixtureDb, FixtureNotFound, slotFromItem } from '@/fixtures/db';
import { getFixtureJob, startFixtureJob } from '@/fixtures/jobs';

/** Fixture weather (sample from the 16 board). Set to null to exercise "hava alınamadı". */
export const stylistFixtureOptions: { weather: StylistWeather | null } = {
  weather: { temperatureC: 14, summary: 'Hafif yağmur', city: 'İstanbul' },
};

const SLOT_OF: Record<ItemCategory, LookSlotKind> = {
  top: 'top',
  dress: 'top',
  beachwear: 'top',
  skiwear: 'top',
  bottom: 'bottom',
  outerwear: 'outerwear',
  shoes: 'shoes',
  bag: 'accessory',
  accessory: 'accessory',
};

/** The missing piece the stylist proposes — a product of the catalogue fixture (leather belt). */
const STORE_PRODUCT = productsFixture.find((p) => p.id === 'prod_023') ?? (productsFixture[0] as (typeof productsFixture)[number]);

const STORE_PIECE: StylistPiece = {
  slot: 'accessory',
  source: 'store',
  refId: STORE_PRODUCT.id,
  name: STORE_PRODUCT.name,
  brand: STORE_PRODUCT.brandName,
  price: STORE_PRODUCT.price,
  imageUrl: null,
  category: 'accessory',
  color: null,
};

const NAMES = ['Gece Laciverti', 'Krem Katmanlar', 'Sade Şıklık'] as const;
const NOTES = [
  'Koyu tonları tek bir açık parçayla dengele; yağmura karşı kapalı burunlu ayakkabı seç.',
  'Açık tonları katman katman kullan; üstüne atacağın parça günü toparlar.',
  'Az parça, net çizgi: rahat ama özenli bir görünüm.',
] as const;

function pieceFromItem(item: Item): StylistPiece {
  return {
    slot: SLOT_OF[item.category],
    source: 'wardrobe',
    refId: item.id,
    name: item.name,
    brand: item.brand,
    price: null,
    imageUrl: item.useOriginalImage ? item.originalImageUrl : item.imageUrl,
    category: item.category,
    color: item.color,
  };
}

const SLOT_ORDER: LookSlotKind[] = ['top', 'bottom', 'outerwear', 'shoes', 'accessory'];

/**
 * Deterministic stand-in for the Stylist worker: three different combinations from the wardrobe.
 * Pinned pieces (`itemIds`) are in every suggestion; unless `wardrobeOnly`, the first suggestion
 * carries one missing store piece.
 */
export function buildFixtureSuggestions(request: Pick<StylistOutfitRequest, 'wardrobeOnly' | 'itemIds'>, items: Item[]): StylistSuggestion[] {
  const bySlot = (slot: LookSlotKind) => items.filter((i) => SLOT_OF[i.category] === slot);
  const pinned = (request.itemIds ?? []).map((id) => items.find((i) => i.id === id)).filter((i): i is Item => Boolean(i));
  const pick = (slot: LookSlotKind, n: number): Item | undefined => {
    const pool = bySlot(slot);
    return pool.length ? pool[n % pool.length] : undefined;
  };

  return Array.from({ length: STYLIST_SUGGESTION_COUNT }, (_, index) => {
    const chosen = new Map<LookSlotKind, StylistPiece>();
    const pinnedBottom = pinned.some((p) => SLOT_OF[p.category] === 'bottom');
    for (const slot of SLOT_ORDER) {
      let item = pick(slot, index);
      // A dress fills top + bottom; keep a separate top when a bottom is pinned.
      if (slot === 'top' && pinnedBottom && item?.category === 'dress') item = bySlot('top').find((i) => i.category !== 'dress') ?? item;
      if (slot === 'bottom' && chosen.get('top')?.category === 'dress') continue;
      if (slot === 'accessory' && index === 1) continue;
      if (item) chosen.set(slot, pieceFromItem(item));
    }
    for (const item of pinned) {
      const slot = SLOT_OF[item.category];
      chosen.set(slot, pieceFromItem(item));
      if (item.category === 'dress') chosen.delete('bottom');
    }
    if (!request.wardrobeOnly && index === 0) chosen.set('accessory', { ...STORE_PIECE });
    return {
      index,
      name: NAMES[index % NAMES.length] ?? NAMES[0],
      note: NOTES[index % NOTES.length] ?? NOTES[0],
      pieces: SLOT_ORDER.map((s) => chosen.get(s)).filter((p): p is StylistPiece => Boolean(p)),
      tryOnImageUrl: null,
      savedLookId: null,
      plannedDate: null,
    };
  });
}

export function startFixtureStylistOutfit(request: StylistOutfitRequest): StylistOutfitResponse {
  const jobId = startFixtureJob<StylistOutfitResult>(
    'stylist-outfit',
    () => ({
      request: { date: request.date, occasion: request.occasion, text: request.text, wardrobeOnly: request.wardrobeOnly },
      suggestions: buildFixtureSuggestions(request, fixtureDb.items),
      weather: stylistFixtureOptions.weather,
    }),
    { id: `job_${request.requestId}` },
  );
  return { jobId };
}

export function fixtureWeather(date: string): WeatherForecastResponse {
  const w = stylistFixtureOptions.weather;
  if (!w) throw new FixtureNotFound('weather');
  return { city: w.city, days: [{ date, temperatureC: w.temperatureC, summary: w.summary }] };
}

/** Server side of "Takvime ekle" / heart: suggestion → Look (+ PlanDay). Idempotent on `lookId`. */
export function acceptFixtureSuggestion(jobId: string, index: number, request: AcceptSuggestionRequest): AcceptSuggestionResponse {
  const job = getFixtureJob<StylistOutfitResult>(jobId, 'stylist-outfit');
  const suggestion = job.result?.suggestions.find((s) => s.index === index);
  if (!job.result || !suggestion) throw new FixtureNotFound(`suggestion ${jobId}:${index}`);
  const lookId = suggestion.savedLookId ?? request.lookId;

  if (!fixtureDb.looks.some((l) => l.id === lookId)) {
    const slots: LookSlot[] = suggestion.pieces.map((p) => {
      const item = p.source === 'wardrobe' ? fixtureDb.items.find((i) => i.id === p.refId) : undefined;
      return item
        ? slotFromItem(p.slot, item)
        : { slot: p.slot, source: p.source === 'library' ? 'wardrobe' : p.source, refId: p.refId, name: p.name, imageUrl: p.imageUrl, brand: p.brand, price: p.price, deleted: false };
    });
    const look: Look = {
      id: lookId,
      name: suggestion.name,
      occasion: job.result.request.occasion ?? 'weekend',
      slots,
      isFavorite: false,
      rating: null,
      ratingCount: 0,
      tryOnImageUrl: suggestion.tryOnImageUrl,
      createdAt: request.occurredAt,
      baseVersion: 1,
    };
    fixtureDb.looks.unshift(look);
  }
  suggestion.savedLookId = lookId;

  if (request.date) {
    const existing = fixtureDb.planDays.find((d) => d.date === request.date);
    if (existing) {
      existing.lookId = lookId;
      existing.occasion = job.result.request.occasion ?? existing.occasion;
      existing.baseVersion += 1;
    } else {
      fixtureDb.planDays.push({ date: request.date, occasion: job.result.request.occasion, lookId, baseVersion: 1 });
    }
    suggestion.plannedDate = request.date;
  }
  return { lookId, plannedDate: request.date };
}
