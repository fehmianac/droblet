import type { TryOnPiece } from '@/api/contracts/tryon';
import { ITEM_CATEGORIES, type ItemCategory } from '@/api/contracts/wardrobe';

/**
 * The pieces of each try-on job this app started, for the curtain wait (21e): the start answer carries them, the
 * `/tryon/[jobId]` route only the job id. In memory only — a screen opened later (a notification, a relaunch) has
 * none and the curtain says "Kombin" instead.
 */
const byJob = new Map<string, TryOnPiece[]>();

export const tryOnPieces = {
  record(jobId: string, pieces: TryOnPiece[] | undefined) {
    if (pieces && pieces.length > 0) byJob.set(jobId, pieces);
  },
  get(jobId: string | null | undefined): TryOnPiece[] {
    return (jobId && byJob.get(jobId)) || [];
  },
  /** Tests. */
  clear() {
    byJob.clear();
  },
};

/** Wire `{ name, category }` → app pieces; an unknown category reads as an accessory, a blank name as none. */
export function toTryOnPieces(wire: { name: string | null; category: string }[] | null | undefined): TryOnPiece[] {
  return (wire ?? []).map((p) => {
    const category = (ITEM_CATEGORIES as readonly string[]).includes(p.category) ? (p.category as ItemCategory) : 'accessory';
    const name = p.name?.trim() ? p.name.trim() : null;
    return { name, category };
  });
}

const DRESS_ORDER: Record<ItemCategory, number> = {
  top: 0,
  beachwear: 0,
  skiwear: 0,
  outerwear: 1,
  bottom: 2,
  dress: 2,
  shoes: 3,
  bag: 4,
  accessory: 5,
};

/** The server's dressing order (tops, outerwear, bottoms, shoes, bags, accessories) — used for fixture data. */
export function inDressingOrder(pieces: TryOnPiece[]): TryOnPiece[] {
  return [...pieces].sort((a, b) => DRESS_ORDER[a.category] - DRESS_ORDER[b.category]);
}

/** Bags and accessories are "takılıyor / takıldı"; everything else is worn: "giyiliyor / giyildi". */
export function isWornPiece(category: ItemCategory): boolean {
  return category !== 'bag' && category !== 'accessory';
}
