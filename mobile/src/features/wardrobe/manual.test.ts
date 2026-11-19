import { EMPTY_FORM, toItemFields, validateItemForm } from './form';
import { buildConfirmVariables, toCreateItemWire } from './mutations';

describe('manual piece without a photo (POST v1/tenant/item)', () => {
  it('the empty form names the missing fields instead of saving silently', () => {
    expect(validateItemForm(EMPTY_FORM)).toEqual({
      name: 'nameRequired',
      category: 'categoryRequired',
      color: 'colorRequired',
      seasons: 'seasonRequired',
    });
    expect(validateItemForm({ ...EMPTY_FORM, name: 'Kazak', category: 'top', color: 'other', colorHex: '#12', seasons: ['winter'] })).toEqual({
      colorHex: 'colorHexInvalid',
    });
  });

  it('a row without draft or library piece becomes a create-item body with the device id', () => {
    const fields = toItemFields({
      ...EMPTY_FORM,
      name: 'Hardal hırka',
      category: 'top',
      subcategory: 'Hırka',
      color: 'other',
      colorHex: 'c8a13a',
      fabric: 'Bambu karışım',
      seasons: ['autumn'],
    });
    const { request } = buildConfirmVariables([{ fields, draftId: null }]);
    const row = request.items[0]!;
    expect(toCreateItemWire(row)).toEqual({
      name: 'Hardal hırka',
      category: 'top',
      subcategory: 'cardigan', // the sub-type name goes to the server as its id
      colorIds: ['other'],
      colorHex: '#C8A13A',
      fabric: null,
      fabricText: 'Bambu karışım',
      seasons: ['autumn'],
      size: null,
      brand: null,
      clientMutationId: row.id,
      itemId: row.id,
    });
  });
});
