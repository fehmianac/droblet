import type { TFunction } from 'i18next';

import type { ItemFields } from '@/api/contracts/wardrobe';

type Detected = Pick<Partial<ItemFields>, 'category' | 'subcategory' | 'color' | 'fabric'> | null | undefined;

/** The piece's type in one word: "Gömlek" (the AI's sub-category), else the category, else "Parça". */
export function pieceTypeLabel(t: TFunction, fields: Detected): string {
  return fields?.subcategory?.trim() || (fields?.category ? t(`itemCategory.${fields.category}`) : t('itemAdd.detectedPiece'));
}

/**
 * "Gömlek algılandı · Beyaz · Pamuk" — what the AI found (category · colour · material), missing parts left out.
 * Shown on 12 while the photo is recognised and as the pill on top of the review form (12c, canvas n_ux1 A2).
 */
export function detectedLine(t: TFunction, suggestion: Detected): string {
  return [
    t('itemAdd.detected', { type: pieceTypeLabel(t, suggestion) }),
    suggestion?.color ? t(`itemColor.${suggestion.color}`) : null,
    suggestion?.fabric?.trim() || null,
  ]
    .filter(Boolean)
    .join(' · ');
}
