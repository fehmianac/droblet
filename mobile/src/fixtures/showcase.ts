import { currentLanguage } from '@/i18n';

/**
 * Fixture copy in the app language for the showcase build (`EXPO_PUBLIC_DROBLET_FIXTURES=1`, used for
 * the landing page and store screenshots). The server localizes its text to `Accept-Language`; the
 * fixtures do the same here, so an English capture shows English item, look, trip and stylist text.
 *
 * Under Jest the fixtures stay Turkish (the seed the unit and screen tests assert on), whatever the
 * test language is: `SHOWCASE` is false there.
 */
export const SHOWCASE = process.env.JEST_WORKER_ID === undefined;

function english(): boolean {
  return SHOWCASE && currentLanguage() === 'en';
}

/** English text of the Turkish fixture strings. A string missing here stays Turkish. */
const EN: Record<string, string> = {
  // Wardrobe pieces (db.ts, library, palette mismatch)
  'Beyaz poplin gömlek': 'White poplin shirt',
  'Lacivert yün blazer': 'Navy wool blazer',
  'Siyah midi elbise': 'Black midi dress',
  'Düz jean': 'Straight jeans',
  'Krem triko': 'Cream knit',
  'Kroko babet': 'Croc ballet flats',
  'Siyah deri çanta': 'Black leather bag',
  'Tüvit ceket': 'Tweed jacket',
  'Bej trençkot': 'Beige trench coat',
  'Siyah kumaş pantolon': 'Black tailored trousers',
  'Siyah bot': 'Black boots',
  'Beyaz sneaker': 'White trainers',
  'İpek fular': 'Silk scarf',
  'Keten gömlek': 'Linen shirt',
  'Fuşya triko': 'Fuchsia knit',
  'Buz mavisi gömlek': 'Icy blue shirt',
  'Soğuk gri kaban': 'Cool grey coat',
  // Sub-categories and fabrics
  Gömlek: 'Shirt',
  Jean: 'Jeans',
  Triko: 'Knit',
  Ceket: 'Jacket',
  Trençkot: 'Trench coat',
  Pantolon: 'Trousers',
  Babet: 'Ballet flats',
  'Omuz çantası': 'Shoulder bag',
  Pamuk: 'Cotton',
  Yün: 'Wool',
  Viskon: 'Viscose',
  Deri: 'Leather',
  Tüvit: 'Tweed',
  'Yün karışım': 'Wool blend',
  İpek: 'Silk',
  Keten: 'Linen',
  // Looks (db.ts) and the weekly edit (today.ts)
  'Lacivert Blazer': 'Navy Blazer',
  'Siyah Düz Elbise': 'Little Black Dress',
  'Tüvit & Jean': 'Tweed & Denim',
  'Krem Katmanlar': 'Cream Layers',
  'Beyaz Gömlek, Net Çizgi': 'White Shirt, Clean Lines',
  Lacivert: 'Navy',
  'Akşam Yemeği': 'Dinner',
  'Pazar Sakinliği': 'Easy Sunday',
  'Net Ofis Klasikleri': 'Clean Office Classics',
  'Beyaz poplin gömleği yüksek belli pantolonun içine yerleştir; kroko babet ve siyah çantayla sade tut.':
    'Tuck the white poplin shirt into high-waisted trousers; keep it simple with croc flats and the black bag.',
  'Siyah midi elbiseyi ince bir kemerle topla; blazer omuzda kalsın.': 'Cinch the black midi dress with a slim belt; wear the blazer over your shoulders.',
  'Lacivert blazerı krem trikoyla yumuşat; altına düz jean yeter.': 'Soften the navy blazer with a cream knit; straight jeans are all it needs.',
  'Saten gömleği siyah pantolonla eşle; küçük taşlı küpe tek aksesuar olsun.': 'Pair the satin shirt with black trousers; small stone earrings are the only accessory.',
  'Krem trikonun üzerine bej trençkot; tonları yakın tut.': 'A beige trench over the cream knit; keep the tones close.',
  'Tüvit ceketi düz jean ve beyaz sneaker ile rahatlat.': 'Relax the tweed jacket with straight jeans and white trainers.',
  'Keten gömlek, düz jean ve fular: rahat ama derli toplu.': 'Linen shirt, straight jeans and a scarf: relaxed but put together.',
  // Weekly edit products
  'Beyaz Poplin Gömlek': 'White Poplin Shirt',
  'Yüksek Bel Kumaş Pantolon': 'High-Waisted Trousers',
  'Deri Kroko Babet': 'Leather Croc Ballet Flats',
  'City Medium Siyah Çanta': 'City Medium Black Bag',
  'Kroko Desen Deri Babet': 'Croc-Effect Leather Flats',
  'Yapılı Deri Çanta': 'Structured Leather Bag',
  'Siyah Midi Elbise': 'Black Midi Dress',
  'İnce Deri Kemer': 'Slim Leather Belt',
  'Tokalı Deri Kemer': 'Buckled Leather Belt',
  'Lacivert Yün Blazer': 'Navy Wool Blazer',
  'Deri Loafer': 'Leather Loafers',
  'Tokalı Deri Loafer': 'Buckled Leather Loafers',
  'Saten Gömlek': 'Satin Shirt',
  'Küçük Taşlı Küpe': 'Small Stone Earrings',
  'Küçük taşlı küpe': 'Small stone earrings',
  'İpek Saten Gömlek': 'Silk Satin Shirt',
  'Taşlı Altın Küpe': 'Gold Stone Earrings',
  'Krem Triko': 'Cream Knit',
  'Deri Bilekte Bot': 'Leather Ankle Boots',
  'Süet Bilekte Bot': 'Suede Ankle Boots',
  'Düz Kesim Jean': 'Straight-Cut Jeans',
  'Kanvas Tote Çanta': 'Canvas Tote Bag',
  'Deri Tote Çanta': 'Leather Tote Bag',
  'Keten Gömlek': 'Linen Shirt',
  'Deri Sandalet': 'Leather Sandals',
  'El Yapımı Deri Sandalet': 'Handmade Leather Sandals',
  // Stylist (16–17)
  'Hafif yağmur': 'Light rain',
  'Gece Laciverti': 'Midnight Navy',
  'Sade Şıklık': 'Quiet Elegance',
  'Koyu tonları tek bir açık parçayla dengele; yağmura karşı kapalı burunlu ayakkabı seç.':
    'Balance the dark tones with one light piece; choose closed shoes for the rain.',
  'Açık tonları katman katman kullan; üstüne atacağın parça günü toparlar.': 'Layer the light tones; the piece you throw on top pulls the day together.',
  'Az parça, net çizgi: rahat ama özenli bir görünüm.': 'Few pieces, clean lines: relaxed but considered.',
  // Men's showcase account (canvas 17: Emre's wardrobe, looks, library and weekly edit)
  'Beyaz oxford gömlek': 'White oxford shirt',
  'Lacivert takım ceketi': 'Navy suit jacket',
  'Lacivert ipek kravat': 'Navy silk tie',
  'Koyu jean': 'Dark jeans',
  'Gri yün triko': 'Grey wool knit',
  'Kahve loafer': 'Brown loafers',
  'Çelik saat': 'Steel watch',
  'Lacivert polo': 'Navy polo',
  'Bej chino': 'Beige chinos',
  'Kahve bot': 'Brown boots',
  'Kahve deri kemer': 'Brown leather belt',
  'Takım ceketi': 'Suit jacket',
  Kravat: 'Tie',
  Loafer: 'Loafers',
  Saat: 'Watch',
  'Polo tişört': 'Polo shirt',
  'Chino pantolon': 'Chinos',
  Kemer: 'Belt',
  'Lacivert Takım': 'Navy Suit',
  'Akşam Klasikleri': 'Evening Classics',
  'Gri Katmanlar': 'Grey Layers',
  'Oxford Gömlek': 'Oxford Shirt',
  'Koyu Chino': 'Dark Chinos',
  'Deri loafer': 'Leather loafers',
  'Basic tişört': 'Basic T-shirt',
  'Oxford gömlek': 'Oxford shirt',
  'Bisiklet yaka triko': 'Crew-neck knit',
  Kaban: 'Coat',
  'Düz paça jean': 'Straight-leg jeans',
  Sneaker: 'Trainers',
  'Beyaz Oxford Gömlek': 'White Oxford Shirt',
  'Koyu Chino Pantolon': 'Dark Chinos',
  'Deri Kemer': 'Leather Belt',
  'Gri Yün Triko': 'Grey Wool Knit',
  'Kaşmir Triko': 'Cashmere Knit',
  'Lacivert Takım Ceketi': 'Navy Suit Jacket',
  'İpek Kravat': 'Silk Tie',
  'El Yapımı İpek Kravat': 'Handmade Silk Tie',
  'Koyu Gömlek': 'Dark Shirt',
  'Poplin Gömlek': 'Poplin Shirt',
  'Deri Bot': 'Leather Boots',
  'Süet Bot': 'Suede Boots',
  'Kanvas Sırt Çantası': 'Canvas Backpack',
  'Deri Sırt Çantası': 'Leather Backpack',
  'Beyaz oxford gömleği chino ile eşle; kahve loafer ve deri kemerle sade tut.': 'Pair the white oxford shirt with chinos; keep it simple with brown loafers and a leather belt.',
  'Koyu chinoyu gri trikoyla yumuşat; saat tek aksesuar olsun.': 'Soften the dark chinos with a grey knit; let the watch be the only accessory.',
  'Lacivert takım ceketini beyaz gömlek ve ipek kravatla tamamla.': 'Finish the navy suit jacket with a white shirt and a silk tie.',
  'Koyu gömleği chino ile eşle; deri loafer akşamı tamamlar.': 'Pair the dark shirt with chinos; leather loafers finish the evening.',
  'Gri trikonun altına beyaz gömlek; tonları yakın tut.': 'A white shirt under the grey knit; keep the tones close.',
  'Tüvit ceketi koyu jean ve beyaz sneaker ile rahatlat.': 'Relax the tweed jacket with dark jeans and white trainers.',
  'Keten gömlek, koyu jean ve polo: rahat ama derli toplu.': 'Linen shirt, dark jeans and a polo: relaxed but put together.',
  // Places (today, stylist, trips, people)
  İstanbul: 'Istanbul',
  İzmir: 'Izmir',
  Londra: 'London',
  Roma: 'Rome',
  Milano: 'Milan',
  Barselona: 'Barcelona',
  Viyana: 'Vienna',
  Atina: 'Athens',
  'Muğla, Türkiye': 'Muğla, Türkiye',
  'Birleşik Krallık': 'United Kingdom',
  'Ontario, Kanada': 'Ontario, Canada',
  Fransa: 'France',
  İtalya: 'Italy',
  Almanya: 'Germany',
  Hollanda: 'Netherlands',
  İspanya: 'Spain',
  Avusturya: 'Austria',
  Yunanistan: 'Greece',
  ABD: 'USA',
  'Birleşik Arap Emirlikleri': 'United Arab Emirates',
  Japonya: 'Japan',
  // Trips (19)
  'Yağmur botu': 'Rain boots',
  // Keşfet creators and people
  'Stil danışmanı': 'Stylist',
  Editör: 'Editor',
  'Quiet luxury ofis': 'Quiet luxury office',
  'Hafta sonu katman': 'Weekend layers',
  'Lüks dokunuş': 'Luxury touch',
  'Marka vitrini': 'Brand showcase',
  'Stil editörü': 'Style editor',
};

/** A Turkish fixture string in the app language (showcase build only; Turkish under Jest). */
export function L(tr: string): string {
  return english() ? (EN[tr] ?? tr) : tr;
}

/** For text built from values: picks the Turkish or the English variant (showcase build only). */
export function tx(tr: string, en: string): string {
  return english() ? en : tr;
}
