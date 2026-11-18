import type { LibraryItem } from '@/api/contracts';
import {
  BULK_ADD_MAX,
  ITEM_CATEGORIES,
  ITEM_SEASONS,
  type Item,
  type ItemCategory,
  type ItemColor,
  type ItemDraft,
  type ItemFields,
  type ItemSeason,
} from '@/api/contracts/wardrobe';

/** 12c form state. Category / colour start empty for a manual entry so the user has to choose. */
export type ItemFormValues = {
  name: string;
  category: ItemCategory | null;
  subcategory: string;
  brand: string;
  size: string;
  color: ItemColor | null;
  fabric: string;
  seasons: ItemSeason[];
  useOriginalImage: boolean;
};

export const EMPTY_FORM: ItemFormValues = {
  name: '',
  category: null,
  subcategory: '',
  brand: '',
  size: '',
  color: null,
  fabric: '',
  seasons: [],
  useOriginalImage: false,
};

export const NAME_MAX = 80;

export function formFromItem(item: ItemFields): ItemFormValues {
  return {
    name: item.name,
    category: item.category,
    subcategory: item.subcategory ?? '',
    brand: item.brand ?? '',
    size: item.size ?? '',
    color: item.color,
    fabric: item.fabric ?? '',
    seasons: [...item.seasons],
    useOriginalImage: item.useOriginalImage,
  };
}

/** AI suggestion → form. It is only a starting point: nothing is saved until the user confirms. */
export function formFromDraft(draft: Pick<ItemDraft, 'suggestion'>): ItemFormValues {
  const s = draft.suggestion ?? {};
  return {
    name: s.name ?? '',
    category: s.category ?? null,
    subcategory: s.subcategory ?? '',
    brand: s.brand ?? '',
    size: s.size ?? '',
    color: s.color ?? null,
    fabric: s.fabric ?? '',
    seasons: [...(s.seasons ?? [])],
    useOriginalImage: s.useOriginalImage ?? false,
  };
}

export type ItemFormErrorKey = 'nameRequired' | 'nameTooLong' | 'categoryRequired' | 'colorRequired' | 'seasonRequired';
export type ItemFormErrors = Partial<Record<'name' | 'category' | 'color' | 'seasons', ItemFormErrorKey>>;

/** Rules of 12c: name, category and colour are required and at least one season must be chosen. */
export function validateItemForm(values: ItemFormValues): ItemFormErrors {
  const errors: ItemFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'nameRequired';
  else if (name.length > NAME_MAX) errors.name = 'nameTooLong';
  if (!values.category) errors.category = 'categoryRequired';
  if (!values.color) errors.color = 'colorRequired';
  if (values.seasons.length === 0) errors.seasons = 'seasonRequired';
  return errors;
}

export function isFormValid(values: ItemFormValues): boolean {
  return Object.keys(validateItemForm(values)).length === 0;
}

const orNull = (value: string): string | null => value.trim() || null;

/** Only call with a valid form. */
export function toItemFields(values: ItemFormValues): ItemFields {
  if (!values.category || !values.color || values.seasons.length === 0) throw new Error('invalid item form');
  return {
    name: values.name.trim(),
    category: values.category,
    subcategory: orNull(values.subcategory),
    brand: orNull(values.brand),
    size: orNull(values.size),
    color: values.color,
    fabric: orNull(values.fabric),
    seasons: values.seasons,
    useOriginalImage: values.useOriginalImage,
  };
}

/** The fields the server accepts on PUT, taken from an existing item (used for season-only edits). */
export function fieldsOf(item: Item): ItemFields {
  return {
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    brand: item.brand,
    size: item.size,
    color: item.color,
    fabric: item.fabric,
    seasons: item.seasons,
    useOriginalImage: item.useOriginalImage,
  };
}

// ---------- 13 Toplu ekle ----------

/** Keeps at most `BULK_ADD_MAX` photos per batch (counting ones already in progress). */
export function limitBulkSelection<T>(picked: T[], alreadyQueued: number): { accepted: T[]; rejected: number } {
  const room = Math.max(0, BULK_ADD_MAX - alreadyQueued);
  return { accepted: picked.slice(0, room), rejected: Math.max(0, picked.length - room) };
}

export type DraftProgress = { total: number; done: number; ready: number; failed: number; processing: number };

/** "12 fotoğraf işleniyor · 8 / 12": done = ready + failed. */
export function draftProgress(drafts: Pick<ItemDraft, 'status'>[]): DraftProgress {
  const ready = drafts.filter((d) => d.status === 'ready').length;
  const failed = drafts.filter((d) => d.status === 'failed').length;
  return { total: drafts.length, done: ready + failed, ready, failed, processing: drafts.length - ready - failed };
}

/** A ready draft can be added as-is only when its suggestion passes the form rules. */
export function isDraftComplete(draft: Pick<ItemDraft, 'status' | 'suggestion'>): boolean {
  return draft.status === 'ready' && isFormValid(formFromDraft(draft));
}

// ---------- 12b Hazır kütüphane ----------

/** Library categories arrive as wire strings; anything unknown is filed under accessories. */
export function libraryCategory(value: string): ItemCategory {
  return ITEM_CATEGORIES.find((c) => c === value) ?? 'accessory';
}

/**
 * A library piece becomes a wardrobe piece with neutral defaults — "Renk ve bedeni sonra düzenle":
 * colour unknown, every season, no size. The user refines it in 12c whenever they like.
 */
export function libraryItemFields(item: Pick<LibraryItem, 'name' | 'category'>): ItemFields {
  return {
    name: item.name,
    category: libraryCategory(item.category),
    subcategory: null,
    brand: null,
    size: null,
    color: 'other',
    fabric: null,
    seasons: [...ITEM_SEASONS],
    useOriginalImage: false,
  };
}
