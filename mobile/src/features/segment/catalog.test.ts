import { MEN_STYLE_TAGS, WOMEN_STYLE_TAGS } from '@/api/contracts';
import { toAppConfig, toAvailableSegments, toBodyProfile } from '@/api/wire/core';
import { toSubcategoryId, toSubcategoryLabel } from '@/api/wire/subcategories';
import { SILHOUETTE_BODY_PATH, SILHOUETTE_BODY_PATH_MEN, silhouetteBodyPath } from '@/components/brand/logoPaths';
import { FINE_GLYPHS, GARMENT_GLYPHS, garmentGlyphPath } from '@/components/ui/ImageSlot';
import { computeRequirements, type RequirementInput } from '@/features/requirements/logic';

import {
  appSegment,
  bodyTypeForSegment,
  bodyTypesFor,
  itemCategoriesFor,
  productCategoriesFor,
  shopChipCategories,
  showSegmentChoice,
  styleTagsFor,
  subcategorySuggestions,
  tagsForSegment,
} from './catalog';
import { segmentStore } from './store';

afterEach(() => segmentStore.reset());

describe('segment availability (server configuration)', () => {
  it('asks for the segment only when more than one is open', () => {
    expect(showSegmentChoice(['women'])).toBe(false);
    expect(showSegmentChoice(['women', 'men'])).toBe(true);
    expect(showSegmentChoice([])).toBe(false);
    expect(showSegmentChoice(undefined)).toBe(false);
  });

  it('reads `segments.available` from GET v1/config; absent or unknown = women only', () => {
    expect(toAvailableSegments(undefined)).toEqual(['women']);
    expect(toAvailableSegments(null)).toEqual(['women']);
    expect(toAvailableSegments(['teen'])).toEqual(['women']);
    expect(toAvailableSegments(['men', 'women'])).toEqual(['women', 'men']);
    expect(toAppConfig({}).availableSegments).toEqual(['women']);
    expect(toAppConfig({ segments: { available: ['women'], all: ['women', 'men', 'teen'] } }).availableSegments).toEqual(['women']);
    expect(toAppConfig({ segments: { available: ['women', 'men', 'teen'] } }).availableSegments).toEqual(['women', 'men']);
  });

  it('serves the women set for anything that is not men (teen is not open)', () => {
    expect(appSegment('men')).toBe('men');
    expect(appSegment('women')).toBe('women');
    expect(appSegment('teen')).toBe('women');
    expect(appSegment(null)).toBe('women');
  });
});

describe('style tags per segment (03)', () => {
  it('women keep the ten phase-1 tags; men get the server set (docs/api/segments.md §2)', () => {
    expect(styleTagsFor('women')).toEqual(WOMEN_STYLE_TAGS);
    expect(styleTagsFor('men')).toEqual(MEN_STYLE_TAGS);
    expect(styleTagsFor('men')).toEqual(['minimal', 'classic', 'smart_casual', 'tailored', 'quiet_luxury', 'street', 'sporty', 'vintage', 'colorful']);
    expect(styleTagsFor('men')).not.toContain('boho');
    expect(styleTagsFor('men')).not.toContain('romantic');
  });

  it('keeps only the shared tags when the segment changes', () => {
    expect(tagsForSegment(['minimal', 'boho', 'office_chic'], 'men')).toEqual(['minimal']);
    expect(tagsForSegment(['smart_casual', 'classic'], 'women')).toEqual(['classic']);
  });
});

describe('body types per segment (11e)', () => {
  it('women: hourglass, pear, apple, rectangle, inverted triangle, not sure', () => {
    expect(bodyTypesFor('women')).toEqual(['hourglass', 'pear', 'apple', 'rectangle', 'inverted_triangle', 'unsure']);
  });

  it('men: rectangle, inverted triangle, triangle, oval, trapezoid, not sure', () => {
    expect(bodyTypesFor('men')).toEqual(['rectangle', 'inverted_triangle', 'triangle', 'oval', 'trapezoid', 'unsure']);
  });

  it("treats a body type of the other segment's set as not chosen, so the requirements flow asks again", () => {
    expect(bodyTypeForSegment('hourglass', 'men')).toBeNull();
    expect(bodyTypeForSegment('rectangle', 'men')).toBe('rectangle');
    expect(bodyTypeForSegment('trapezoid', 'women')).toBeNull();
    expect(bodyTypeForSegment('unsure', 'men')).toBe('unsure');
    expect(bodyTypeForSegment(undefined, 'men')).toBeUndefined();

    const input: RequirementInput = {
      ageConfirmed: true,
      validConsents: ['bodyPhotoAi', 'facePhotoTryOn', 'facePhotoPalette', 'crossBorderTransfer'],
      hasBodyPhoto: false,
      hasFacePhoto: true,
      bodyType: bodyTypeForSegment('hourglass', 'men'),
      hasBodyProfile: true,
      isMember: true,
      creditsRemaining: 5,
      cityId: 'ist',
      handle: 'emre',
      itemCount: 10,
    };
    expect(computeRequirements('tryOn', input, 'face').steps.map((s) => s.kind)).toContain('bodyType');
    expect(computeRequirements('tryOn', { ...input, bodyType: bodyTypeForSegment('oval', 'men') }, 'face').steps.map((s) => s.kind)).not.toContain('bodyType');
  });

  it('maps the men types to and from the wire', () => {
    expect(toBodyProfile({ heightCm: 180, weightKg: null, size: 'l', bodyType: 'trapezoid', version: 1, updatedAt: '' }).bodyType).toBe('trapezoid');
    expect(toBodyProfile({ heightCm: 180, weightKg: null, size: 'l', bodyType: 'invertedTriangle', version: 1, updatedAt: '' }).bodyType).toBe('inverted_triangle');
  });
});

describe('item edit form: categories and "Tür" suggestions follow the segment (12c)', () => {
  it('suggests men sub-types for men and women sub-types for women', () => {
    expect(subcategorySuggestions('men', 'accessory')).toEqual(expect.arrayContaining(['watch', 'tie', 'belt']));
    expect(subcategorySuggestions('men', 'accessory')).not.toContain('earrings');
    expect(subcategorySuggestions('men', 'bottom')).toContain('chinos');
    expect(subcategorySuggestions('men', 'bottom')).not.toContain('skirt');
    expect(subcategorySuggestions('men', 'outerwear')).toContain('suit-jacket');
    expect(subcategorySuggestions('women', 'bottom')).toContain('skirt');
    expect(subcategorySuggestions('women', 'shoes')).toContain('heels');
    expect(subcategorySuggestions('men', null)).toEqual([]);
  });

  it('every suggested id has a name in both languages', () => {
    for (const segment of ['women', 'men'] as const) {
      for (const category of itemCategoriesFor('women')) {
        for (const id of subcategorySuggestions(segment, category)) {
          expect(toSubcategoryLabel(id)).not.toBe(id);
          expect(toSubcategoryId(toSubcategoryLabel(id))).toBe(id);
        }
      }
    }
  });

  it('leaves "Elbise" out of the men list unless the piece already is one', () => {
    expect(itemCategoriesFor('women')).toContain('dress');
    expect(itemCategoriesFor('men')).not.toContain('dress');
    expect(itemCategoriesFor('men', ['dress'])).toContain('dress');
  });
});

describe('store and catalogue (21–23)', () => {
  it('drops the women-only catalogue categories for men', () => {
    expect(productCategoriesFor('men', ['tshirt', 'blouse', 'dress', 'skirt', 'jeans'])).toEqual(['tshirt', 'jeans']);
    expect(productCategoriesFor('women', ['blouse', 'dress'])).toEqual(['blouse', 'dress']);
    expect(shopChipCategories('women')).toContain('dress');
    expect(shopChipCategories('men')).not.toContain('dress');
    expect(shopChipCategories('men')).toContain('jeans');
  });
});

describe('placeholders (canvas 17 "Yer tutucular")', () => {
  it('has a men figure next to the women one', () => {
    expect(silhouetteBodyPath('women')).toBe(SILHOUETTE_BODY_PATH);
    expect(silhouetteBodyPath('men')).toBe(SILHOUETTE_BODY_PATH_MEN);
    expect(SILHOUETTE_BODY_PATH_MEN).not.toBe(SILHOUETTE_BODY_PATH);
  });

  it('draws the finer men glyphs from the sub-type (id or name) or the catalogue category', () => {
    expect(garmentGlyphPath('accessory', 'tie')).toBe(FINE_GLYPHS.tie);
    expect(garmentGlyphPath('accessory', 'Saat')).toBe(FINE_GLYPHS.watch);
    expect(garmentGlyphPath('outerwear', 'Takım ceketi')).toBe(FINE_GLYPHS['suit-jacket']);
    expect(garmentGlyphPath('bottom', 'chinos')).toBe(FINE_GLYPHS.chinos);
    expect(garmentGlyphPath('shoes', 'oxford-shoes')).toBe(FINE_GLYPHS.loafers);
    expect(garmentGlyphPath('shoes', 'derbies')).toBe(FINE_GLYPHS.loafers);
    expect(garmentGlyphPath('loafers')).toBe(FINE_GLYPHS.loafers);
    expect(garmentGlyphPath('suit')).toBe(FINE_GLYPHS['suit-jacket']);
    // Anything else keeps its family glyph.
    expect(garmentGlyphPath('bottom', 'jeans')).toBe(GARMENT_GLYPHS.bottom);
    expect(garmentGlyphPath('skirt')).toBe(GARMENT_GLYPHS.bottom);
    expect(garmentGlyphPath(null)).toBe(GARMENT_GLYPHS.top);
  });
});
