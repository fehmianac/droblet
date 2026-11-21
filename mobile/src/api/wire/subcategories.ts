/**
 * Sub-type ids the AI suggests (server `SubcategoryCatalog`, e.g. `necklace`) with their names. The form's
 * "Tür" field is free text: an id is shown by its name on the way in, and a known name goes back as its id
 * (the server only accepts lower-case ids). Text that matches nothing is sent as typed.
 */
import i18n from '@/i18n';

const SUBCATEGORIES: Record<string, { tr: string; en: string }> = {
  't-shirt': { tr: 'Tişört', en: 'T-shirt' },
  shirt: { tr: 'Gömlek', en: 'Shirt' },
  blouse: { tr: 'Bluz', en: 'Blouse' },
  sweater: { tr: 'Kazak', en: 'Sweater' },
  cardigan: { tr: 'Hırka', en: 'Cardigan' },
  hoodie: { tr: 'Kapüşonlu sweatshirt', en: 'Hoodie' },
  'tank-top': { tr: 'Atlet', en: 'Tank top' },
  top: { tr: 'Üst', en: 'Top' },
  jeans: { tr: 'Jean', en: 'Jeans' },
  trousers: { tr: 'Pantolon', en: 'Trousers' },
  skirt: { tr: 'Etek', en: 'Skirt' },
  shorts: { tr: 'Şort', en: 'Shorts' },
  leggings: { tr: 'Tayt', en: 'Leggings' },
  dress: { tr: 'Elbise', en: 'Dress' },
  jumpsuit: { tr: 'Tulum', en: 'Jumpsuit' },
  blazer: { tr: 'Blazer', en: 'Blazer' },
  jacket: { tr: 'Ceket', en: 'Jacket' },
  coat: { tr: 'Kaban', en: 'Coat' },
  'trench-coat': { tr: 'Trençkot', en: 'Trench coat' },
  puffer: { tr: 'Şişme mont', en: 'Puffer' },
  vest: { tr: 'Yelek', en: 'Vest' },
  sneakers: { tr: 'Spor ayakkabı', en: 'Sneakers' },
  boots: { tr: 'Çizme', en: 'Boots' },
  'ankle-boots': { tr: 'Bot', en: 'Ankle boots' },
  heels: { tr: 'Topuklu ayakkabı', en: 'Heels' },
  flats: { tr: 'Babet', en: 'Flats' },
  sandals: { tr: 'Sandalet', en: 'Sandals' },
  loafers: { tr: 'Loafer', en: 'Loafers' },
  handbag: { tr: 'El çantası', en: 'Handbag' },
  tote: { tr: 'Tote çanta', en: 'Tote' },
  'shoulder-bag': { tr: 'Omuz çantası', en: 'Shoulder bag' },
  crossbody: { tr: 'Çapraz çanta', en: 'Crossbody bag' },
  clutch: { tr: 'Clutch', en: 'Clutch' },
  backpack: { tr: 'Sırt çantası', en: 'Backpack' },
  belt: { tr: 'Kemer', en: 'Belt' },
  hat: { tr: 'Şapka', en: 'Hat' },
  cap: { tr: 'Kep', en: 'Cap' },
  beanie: { tr: 'Bere', en: 'Beanie' },
  scarf: { tr: 'Şal / eşarp', en: 'Scarf' },
  sunglasses: { tr: 'Güneş gözlüğü', en: 'Sunglasses' },
  glasses: { tr: 'Gözlük', en: 'Glasses' },
  watch: { tr: 'Saat', en: 'Watch' },
  gloves: { tr: 'Eldiven', en: 'Gloves' },
  tie: { tr: 'Kravat', en: 'Tie' },
  'hair-accessory': { tr: 'Saç aksesuarı', en: 'Hair accessory' },
  ring: { tr: 'Yüzük', en: 'Ring' },
  necklace: { tr: 'Kolye', en: 'Necklace' },
  earrings: { tr: 'Küpe', en: 'Earrings' },
  bracelet: { tr: 'Bileklik', en: 'Bracelet' },
  brooch: { tr: 'Broş', en: 'Brooch' },
  anklet: { tr: 'Halhal', en: 'Anklet' },
  bikini: { tr: 'Bikini', en: 'Bikini' },
  swimsuit: { tr: 'Mayo', en: 'Swimsuit' },
  kaftan: { tr: 'Kaftan', en: 'Kaftan' },
  'ski-jacket': { tr: 'Kayak montu', en: 'Ski jacket' },
  'ski-pants': { tr: 'Kayak pantolonu', en: 'Ski pants' },
  // Men's and unisex ids (docs/api/segments.md §3, server `SubcategoryCatalog`).
  polo: { tr: 'Polo yaka tişört', en: 'Polo shirt' },
  'oxford-shirt': { tr: 'Oxford gömlek', en: 'Oxford shirt' },
  'dress-shirt': { tr: 'Klasik gömlek', en: 'Dress shirt' },
  henley: { tr: 'Henley tişört', en: 'Henley' },
  sweatshirt: { tr: 'Sweatshirt', en: 'Sweatshirt' },
  turtleneck: { tr: 'Balıkçı yaka kazak', en: 'Turtleneck' },
  'quarter-zip': { tr: 'Yarım fermuarlı kazak', en: 'Quarter-zip sweater' },
  chinos: { tr: 'Chino pantolon', en: 'Chinos' },
  'suit-trousers': { tr: 'Takım pantolonu', en: 'Suit trousers' },
  'cargo-trousers': { tr: 'Kargo pantolon', en: 'Cargo trousers' },
  joggers: { tr: 'Jogger eşofman altı', en: 'Joggers' },
  'suit-jacket': { tr: 'Takım ceketi', en: 'Suit jacket' },
  overshirt: { tr: 'Gömlek ceket', en: 'Overshirt' },
  bomber: { tr: 'Bomber ceket', en: 'Bomber jacket' },
  'leather-jacket': { tr: 'Deri ceket', en: 'Leather jacket' },
  parka: { tr: 'Parka', en: 'Parka' },
  waistcoat: { tr: 'Takım yeleği', en: 'Waistcoat' },
  derbies: { tr: 'Derby ayakkabı', en: 'Derby shoes' },
  'oxford-shoes': { tr: 'Oxford ayakkabı', en: 'Oxford shoes' },
  'chelsea-boots': { tr: 'Chelsea bot', en: 'Chelsea boots' },
  'boat-shoes': { tr: 'Makosen', en: 'Boat shoes' },
  briefcase: { tr: 'Evrak çantası', en: 'Briefcase' },
  'messenger-bag': { tr: 'Postacı çanta', en: 'Messenger bag' },
  'bow-tie': { tr: 'Papyon', en: 'Bow tie' },
  'pocket-square': { tr: 'Cep mendili', en: 'Pocket square' },
  cufflinks: { tr: 'Kol düğmesi', en: 'Cufflinks' },
  suspenders: { tr: 'Pantolon askısı', en: 'Suspenders' },
  'swim-shorts': { tr: 'Deniz şortu', en: 'Swim shorts' },
};

const fold = (value: string) => value.trim().toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Sub-type id → its name in the app language (an unknown id is shown as sent). */
export function toSubcategoryLabel(id: string | null | undefined): string | null {
  if (!id) return null;
  const names = SUBCATEGORIES[id];
  if (!names) return id;
  return i18n.language?.startsWith('en') ? names.en : names.tr;
}

/** What the form holds (a name or an id) → the id to send; text that matches no sub-type is kept as typed. */
export function toSubcategoryId(text: string | null | undefined): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  if (SUBCATEGORIES[trimmed]) return trimmed;
  const needle = fold(trimmed);
  for (const [id, names] of Object.entries(SUBCATEGORIES)) {
    if (fold(names.tr) === needle || fold(names.en) === needle || id === needle) return id;
  }
  return trimmed;
}
