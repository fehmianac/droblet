# UI/UX Designer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
Bu rolü **Claude** üstlenir; her yeni ya da değişen ekran **ürün sahibinin onayına** sunulur, onaysız ekran geliştirilmez.

Ürünün kullanıcı deneyimi sende: bilgi mimarisi, akışlar, ekranlar, (varsa) widget'lar, durum ekranları ve tasarım sisteminin korunması. Tasarım teslim edildiyse işin üç parça:

1. **Teslim** — geliştiricinin her ekranı doğru kaynaktan, doğru sırayla almasını sağlamak.
2. **Eksikleri kapatmak** — geliştirme sırasında ortaya çıkan ve tasarımda olmayan durumlar (aşağıda listelenir).
3. **Tasarım QA** — her sprint sonunda gerçek telefonda, uygulamayı tasarıma karşı kontrol etmek.

---

## Ürün bağlamı

**Droblet**, kişisel gardırobu dijitalleştiren, AI ile her gün ve her seyahat için kombin öneren mobil stil asistanıdır. Kullanıcı kıyafetlerini fotoğraflar; Droblet parçaları tanır, kombin ve bavul hazırlar, kombinleri ve mağaza ürünlerini **kullanıcının kendi fotoğrafı üzerinde** gösterir.

- **Hedef kullanıcı:** Türkiye pazarı (₺, TR markalar); onboarding segmentleri Kadın · Erkek · Genç (13–18). Genç segmentine özel kısıtlar **Açık karar (A-5)**.
- **Vaat:** "Sabah 'ne giysem' derdi ve saatler süren bavul hazırlığı bitti. Dolabın artık senin için düşünüyor."
- **Ana yüzey:** Bugün sekmesi — günün kombini, "Senin üzerinde", tek ana aksiyon "Bunu giyiyorum". Gezinme 5 sekme: Bugün · Gardırop (Parçalar / Looklar / Bavullar) · Stilist (orta) · Keşfet · Profil.
- **Ton:** "Sakin, editoryal, kişisel." Sen dili, kısa cümleler; moda dergisi editörü gibi öneren, yargılamayan bir ses. Beden, kilo ve "kaçınman gerekenler" (30) gibi konularda yargı ya da düzeltme dili yok.
- **Ölçü (North Star — öneri):** haftalık giyilen kombin sayısı ("Bunu giyiyorum" / takvimde "ne giydim"). Ayrıntı: [MOBILE_ENGINEER.md](MOBILE_ENGINEER.md) §Bu uygulama neden var.
- **Tasarım kabul testleri:**
  1. Yeni kullanıcı onboarding'den sonra (fotoğrafı atlasa bile) Bugün'de anlamlı bir sonraki adım görür.
  2. Parça eklemede AI'ın algıladığı her alan kaydetmeden önce görünür ve düzeltilebilir.
  3. Kendi fotoğrafı üzerindeki her görsel "Senin üzerinde" / "AI önizleme" olarak işaretlidir ve başka hiçbir kullanıcının ekranında görünmez.
  4. Mağaza akışında "ödeme marka sitesinde" bilgisi ödeme butonundan önce görünür.
  5. Kilitli (üyelik) bir özelliğe dokunan kullanıcı ne kazanacağını ve geri dönüş yolunu görür.

Genel ilkeler:
- **Tek ekranda tek ana aksiyon.**
- **Ton:** sakin ve destekleyici; suçlayıcı dil yok. Her hata ve boş durumda tek, açık bir sonraki adım.

Yüzeyler: **mobil uygulama** (iOS + Android) — ürünün kendisi. Widget ve kilit ekranı MVP'de yok (MVP sonrası aday: "Günün kombini" widget'ı). Web: landing, yasal sayfalar, web hesap silme, davet linki karşılama sayfası; web dashboard yok. Web için bkz. [FRONTEND_ENGINEER.md](FRONTEND_ENGINEER.md).

---

## Tasarım kaynakları

Handoff klasörü: `.claude/_handoff/droblet-handoff/` — `README.md` (ürün brifi) ve `SCREENS.md` (30 ekranın metni). Tasarım: **"Droblet — Uygulama UX/UI"**, https://claude.ai/artifact/UUAJnqCfrvDkh3yPPvnqw1 (2026-11-18).

| Kaynak | Yol | Ne için |
|---|---|---|
| Ekran kaynakları | Canlı tasarımdaki `*.dc.html` dosyaları (ör. `Home.dc.html`, `Gardirop.dc.html`) | **Ölçü, metin, durum ve davranış için tek doğru kaynak** |
| Ekran dizini | `.claude/_handoff/droblet-handoff/SCREENS.md` + aşağıdaki tablo | Her pano, sekmeye göre gruplu. Tasarım yalnız mobil (iOS ölçüsü); Android (Material 3) panosu yok → eksikler tablosu |
| Token'lar | `design/tokens.json` → `src/theme/tokens.ts` | Renk (light; dark **A-9**), tip, yarıçap, boşluk, dokunma alanı, marka butonları |
| Ürün brifi | `.claude/_handoff/droblet-handoff/README.md` | Ürün, 5 sekme, özellikler, gizlilik vaatleri, üyelik, tasarım sistemi özeti, epic'ler, açık kararlar A-1…A-10 |
| Mağaza metinleri | Yok — E12'de yazılacak | İsim, alt başlık, anahtar kelimeler, ekran görüntüsü başlıkları (TR + EN) |
| Canlı canvas | https://claude.ai/artifact/UUAJnqCfrvDkh3yPPvnqw1 | Klasörle çelişirse **canlı kaynak geçerlidir** |

**Ekran dizini** (no · ekran · dosya · epic):

| Sekme | Ekranlar |
|---|---|
| Onboarding / hesap (E1) | 01 Hoş geldin `Main` · 02 Kayıt / giriş `Kayit` · 03 Stil profili 1/3 `OnbStil` · 04 Beden ve fotoğraf `OnbFoto` |
| Üyelik (E10) | 05 Üyelik `Paywall` |
| Bugün (E4, E8) | 06 Bugün `Home` · 07 Haftalık plan `Hafta` · 08 Haftanın edit'i `Edit` · 09 Takvim `Takvim` |
| Gardırop (E2, E3, E5) | 10 Gardırop `Gardirop` · 11 Parça detayı `Parca` · 12 Parça ekle `Ekle` · 13 Toplu ekle `TopluEkle` · 14 Looklar `Looklar` · 15 Look oluştur `LookYeni` · 18 Bavullar `Bavul` · 19 Bavul detayı `BavulDetay` |
| Stilist (E5, E7) | 16 Stilist `Stilist` · 17 Kombin önerisi `DanismanSonuc` · 30 Renk paleti `RenkPaleti` |
| Keşfet (E8, E9) | 20 Keşfet `Kesfet` · 21 Stil mağazası `Magaza` · 22 Ürün + üzerimde `Urun` · 23 Kombin oluşturucu `KombinOlusturucu` · 24 Sepet `Sepet` · 25 Arkadaş akışı `Akis` · 26 Kişi profili `Kisi` · 27 Dolapları keşfet `Arkadaslar` |
| Profil (E11) | 28 Profil `Profil` · 29 Gizlilik ve ayarlar `Ayarlar` |
| Sistem | Tasarım sistemi `TasarimSistemi` |

Rota eşlemesi: [MOBILE_ENGINEER.md](MOBILE_ENGINEER.md) §Project Structure.

**`.dc.html` nasıl okunur** (tasarım bu formatta teslim edildiyse): işaretleme `<x-dc>` içinde, satır içi stiller kesin değerler; `{{name}}` dosyanın sonundaki `renderVals()`'tan gelir — metin varyantları, durum mantığı ve veriler oradadır. `<sc-if>` koşullu blok, `<sc-for>` tekrar eden blok, `<dc-import>` başka bir ekranı gömer, script'teki `data-props` varyantları (`state`, `loc`, `dark`) listeler. Canvas çalışma zamanı (`support.js`) pakette yoksa dosyalar **kaynak olarak okunur** ya da canlı canvas açılır; tarayıcıda tek başına doğru çizilmez.

---

## Tasarım sistemi kuralları

Bunlar ürün kuralıdır; geliştirici de tasarımcı da uyar.

### Token
- Renk, boşluk, yarıçap ve tipografi **yalnız token'dan**. Ekranda ya da bileşende hex yazılmaz.
- Yeni bir değer gerekiyorsa önce `tokens.json`'a girer, sonra kullanılır. Token dışı bir değer, ikinci bir tasarım sistemidir. Panolarda token'da olmayan ara tonlar görülürse önce token'a alınır.
- Light ve dark iki tam palet.
- **Görsel yön:** "Sakin, editoryal, kişisel" — krem zemin, mürekkep metin, espresso vurgu; mevcut Droblet kimliği (krem zemin, Cormorant başlıklar, Jost metin) sadeleştirilerek korunur. Görseller tasarımda placeholder; gerçek ürün ve kullanıcı fotoğrafları yerine geçer.
- **Renk token'ları:** Mürekkep `#1C1A17` · Krem zemin `#F4F1EC` · Kâğıt `#FBF9F5` · Espresso vurgu `#6E5640` · İkincil metin `#665F56` · Çizgi `#DCD4C9` · Kum `#E8E1D7` · Uyarı `#9A3B2E`.
- **Dark palet tasarımda yok — Açık karar (A-9).** Karar "evet" olursa dark palet bu token'lardan türetilip onaya sunulur; o zamana kadar dark mode açılmaz.

### Tipografi
- **Fontlar:** Cormorant Garamond (başlıklar) + Jost (gövde, etiket); uygulamaya gömülü.

| Stil | Font | Ağırlık | Boyut / satır | Örnek (tasarımdan) |
|---|---|---|---|---|
| Display | Cormorant Garamond | 500 | 36 / 38 | "Bu hafta ne giyeceksin?" |
| Başlık 2 | Cormorant Garamond | 500 | 26 | "Net Ofis Klasikleri" |
| Başlık 3 | Cormorant Garamond | 600 | 20 | "Bu haftanın edit'i" |
| Gövde | Jost | 400 | 14 / 21 | "Beyaz poplin gömleği yüksek belli pantolonun içine yerleştir." |
| Üst etiket (eyebrow) | Jost | 500 | 11, harf aralığı %14 | "Haftalık stil · 9–15 Kasım" |

- **Üst etiket notu:** "Üst etiket" bir font/boyut/harf aralığı tarifidir; **büyük harfe çevirme CSS/Tailwind ya da `textTransform` ile yapılmaz** (`uppercase` sınıfı yasak). Etiket hangi harfle görünmesi isteniyorsa metin kaynakta ve `tr.json` / `en.json`'da **o harfle yazılır**. Canlı tasarımda büyük harfle görünüyorsa çeviri dosyasına büyük harfle girilir ("HAFTALIK STİL" — Türkçe `İ` ile), değilse yazıldığı gibi.
- **Büyük harf stil ile yapılmaz.** Token'daki `"uppercase": true` bir görünüm tarifidir, uygulama talimatı değil: metin kaynakta ve çeviri dosyasında büyük harfle yazılır; `textTransform: 'uppercase'` / CSS `uppercase` kullanılmaz (Türkçe `i → İ` dahil).
- Dynamic Type ve Android font ölçeği desteklenir; düzen en büyük yazı tipinde kırılmaz.

### Ölçüler
- Dokunma alanı **iOS ≥ 44 pt, Android ≥ 48 dp**.
- Ekran kenarı **20** · ızgara **4/8** · kart köşesi **20** · görsel köşesi **12–14** · birincil buton yüksekliği **52**, ikincil **44** · tasarımdaki dokunma alanı ≥ 44 (Android'de ekip kuralı ≥ 48 dp geçerli). Çip/rozet yarıçapı ve yığın aralığı canlı tasarımdaki bileşen sayfasından token'a alınır.
- Bileşenler (tasarım sistemi sayfası): birincil buton, ikincil buton, seçili, çip, rozet, alan, marka, ürün satırı.

### Renk anlamları

| Anlam | Görsel | Kural |
|---|---|---|
| Doğru / başarı | Yeşil + tint | **Her zaman metinle** |
| Yanlış / hata | Error tint + kırmızı | **Her zaman metinle**; ton sakin, bir sonraki adım net |
| Kilitli (ücretli) | Tasarımda çizilmedi — Kum zemin + kilit ikonu + "Droblet Üyelik" metni (öneri; eksikler D-8) | Kilitli olan **gizlenmez**; ne olduğu ve neden kilitli olduğu görünür |
| Primary | Mürekkep `#1C1A17` zemin, Kâğıt metin | Ana aksiyon |
| Vurgu / seçili | Espresso `#6E5640` | Seçili çip, bağlantı, "Senin üzerinde" rozeti |
| Uyarı | Uyarı `#9A3B2E` | Hata, "Hesabımı sil", "Kategoriyi kontrol et" — her zaman metinle |
| Başarı | Token'da yeşil yok — sakin metin + ikon; yeni renk gerekiyorsa önce `tokens.json`'a önerilir | |
| Modül renkleri | Yok — modüller renkle değil başlık ve ikonla ayrılır | |

### Marka butonları
- **Apple:** native `ASAuthorizationAppleIDButton`.
- **Google:** Google'ın marka kurallarına göre (beyaz zemin, 1px #747775 çerçeve, Roboto Medium, metin #1F1F1F, resmi G logosu).
- Resmi logolar ve App Store / Google Play rozetleri markaların kendi kitlerinden alınır — panolardaki yer tutucular üretime girmez.

### Erişilebilirlik
- Renk tek başına anlam taşımaz — doğru/yanlış, kilitli/açık her zaman metinle.
- Her ikon butonunun bir etiketi var (`accessibilityLabel`); widget'larda da.
- Snackbar ve senkron mesajları ekran okuyucuya duyurulur (`accessibilityLiveRegion="polite"`).
- Metin kontrastı en az 4.5:1 (WCAG AA), light ve dark'ta ayrı ayrı.

---

## Değişmez ürün kuralları (tasarıma yansıyan)

- **Paywall (varsa):** fiyat, dönem, deneme ve yenileme koşulları satın alma butonunun yanında; Restore Purchases her zaman görünür; Terms ve Privacy linkleri.
- **AI (varsa):** AI önerisi her zaman AI önerisi olarak işaretlenir; kalıcı veriye yazmadan önce önizlenir ve düzenlenir.
- **Widget'lar (varsa):** her durumda anlamlı — light, dark, boş, çevrimdışı (son önbellek), uzun metin. Gerçek zamanlı güncelleme ima eden metin yok.
- **Çok dilli arayüz:** diller ilk günden çeviri dosyalarında; düzen en uzun dildeki (ör. DE) metne dayanıklı.
- **Kişisel görseller yalnız sahibine:** "Fotoğrafların ve senin üzerinde üretilen görseller yalnızca sana açıktır." Boy/yüz fotoğrafı ve try-on çıktısı hiçbir görünürlük ayarında (Herkese açık / Yalnızca takipçiler / Gizli) başkasına gösterilmez; sosyal ekranlarda (25–27) look'lar parça görselleriyle çizilir.
- **Silme yolu her zaman görünür:** "İstediğin an Profil › Gizlilik'ten silebilirsin." — fotoğraf/üretilen görsel silme hesap silmeden bağımsızdır (29).
- **Ödeme Droblet'te alınmaz:** ürün (22), kombin oluşturucu (23) ve sepet (24) ödeme butonundan önce "Ödeme ve teslimat … kendi mağazasında tamamlanır." der; buton marka adını taşır ("Marks & Spencer'da öde").
- **AI işaretleri:** "AI önizleme", "… algılandı", "Yüz fotoğrafından AI ile çıkarıldı"; parça taslağı "Kontrol et" adımından geçmeden gardıroba girmez.
- **Dolap görünürlüğü kullanıcı seçimi;** varsayılanı **Açık karar (A-6)**. Profilde mevcut ayar her zaman yazılı ("Dolabım: yalnızca takipçiler").
- **Fiyat yer tutucuları** (`[FİYAT]`, `[AYLIK FİYAT]`, `[YILLIK FİYAT]`, `[PLAN ADI]`) üretime girmez — **Açık karar (A-1, A-2)**.

---

## Teslim sırası

Ekranlar sprint planına göre teslim edilir (PRODUCT_MANAGER.md §4). Her sprint başında, o sprintin ekranları için geliştiriciyle 30 dakikalık bir geçiş yapılır: kaynak dosya, durumlar (`data-props`), kenar durumları, dark ve Android karşılığı.

| Sprint | Ekranlar |
|---|---|
| S0 | Tasarım sistemi, bileşen vitrini |
| S1+ | Sprint numaraları PRODUCT_MANAGER.md §4'ten; sıra epic'e göre: |
| E1 | 01–04 + şifre sıfırlama, izin açıklamaları (kamera/galeri), Genç segmenti (A-5 kararından sonra) |
| E2 | 10–13 + boş gardırop, yükleme kuyruğu, AI işleme hatası |
| E3 | 14–15 |
| E4 | 06–07, 09 + hava/konum izni (A-4), bildirim izni |
| E5 | 16–19 + AI bekleme ve hata durumları |
| E6 | Try-on sonucu / bekleme (07, 15, 19, 22, 23'ten açılan) |
| E7 | 30 |
| E8 | 08, 20–24 |
| E9 | 25–27 + rehber izni (A-8), gizli dolap |
| E10 | 05 + abonelik yönetimi, kilitli özellik anları |
| E11 | 28–29 + hesap silme onayı, fotoğraf silme onayı |
| E12 | Mağaza ekran görüntüleri, web sayfaları |

---

## Tasarımda eksik olanlar

Geliştirme sırasında gerekecek ama handoff'ta panosu olmayan durumlar. Claude bunları mevcut tasarım sistemiyle (token, bileşen, ton) çizer ve ilgili sprintten **önce** ürün sahibinin onayına sunar.

Çoğu projede eksik çıkan tipik durumlar (kontrol et):
- İkon seti (tek kütüphane, 24 grid)
- Çeviri metinleri (panolar tek dildeyse)
- Çakışma: "Bunu başka bir cihazda değiştirdin" — Diğerini tut / Bunu kaydet
- Silinmiş kayda değişiklik: "Bunu başka bir cihazda sildin"
- Bekleyen senkron göstergesi: "Senkronize ediliyor (3)"
- İzin açıklamaları ve reddedilmiş halleri (kamera, mikrofon, bildirim)
- Web hesap silme sayfası (Google Play kuralı): giriş (OTP) → onay → bitti
- Web yasal sayfaları (Privacy, Terms, abonelik koşulları, KVKK aydınlatma, Cookie Notice)
- Yarıda bırakılan akışa geri dönme
- Tablet düzeni (ürün kararı gelmeden çizilmez)

| # | Durum | Sprint | Not |
|---|---|---|---|
| D-1 | **Boş gardırop** (0 parça): Bugün (06), Gardırop (10), Looklar (14), Stilist "Sadece gardırobum" (16), Renk paleti uyum oranı (30) | E2 | Tek aksiyon: "Parça ekle" / "Toplu ekle"; 06'da gardırop yokken ne önerileceği ürün sahibiyle |
| D-2 | **AI işleme başarısız** — parça algılanamadı / arka plan temizlenemedi (12–13), öneri üretilemedi (17, 19), palet çıkarılamadı (30) | E2, E5, E7 | Sakin metin + "Tekrar dene" + elle doldurma (parça); kota iadesi söylenir |
| D-3 | **Try-on sürüyor / başarısız / boy fotoğrafı yok** | E6 | Bekleme hali "Senin üzerinde hazırlanıyor"; fotoğraf yoksa 04'e götüren tek adım |
| D-4 | **Çevrimdışı** — bekleyen yükleme sayısı, AI özelliklerinin açıklamalı hali, mağaza/akış önbelleği | S0 + her epic | Metinler ton kuralına uyar; "Senkronize ediliyor (N)" yüklemeleri de sayar |
| D-5 | **Toplu yükleme kuyruğu** — çevrimdışı çekilen fotoğraflar, yarıda kalan yükleme, kısmi başarı ("8 / 12") | E2 | 13'ün durum varyantları |
| D-6 | **İzin açıklamaları ve reddedilmiş halleri:** kamera, fotoğraflar (iOS sınırlı erişim), konum (**A-4** — şehir seçimi alternatifi), rehber (**A-8**), bildirim | E1, E4, E9 | Mikrofon yok |
| D-7 | **Bildirim izni ön ekranı** — ilk günün kombininden sonra (öneri) | E4 | 29'daki üç tür: sabah kombin, haftanın edit'i, arkadaş puanları |
| D-8 | **Paywall anları ve kilitli haller** — Üzerimde gör, Kombin öner, Bavul hazırla, Renk paletim; ücretsiz sınıra gelmiş kullanıcı | E10 | Sınırlar ve fiyat **A-1**; kilitli olan görünür |
| D-9 | **Abonelik yönetimi** (28 "Üyelik" satırından) — aktif plan, yenileme, iptal yolu (mağaza), geri yükle | E10 | Panosu yok |
| D-10 | **Genç hesap (13–18) kısıtları** — yaş doğrulama, veli onayı, sosyal ve fotoğraf/try-on özelliklerinin kısıtlı hali | E1, E9 | **Açık karar (A-5)** — karar gelmeden çizilmez |
| D-11 | **Hesap silme onayı** — ne silinir, aktif aboneliğin silmeyle iptal olmadığı + mağaza linki, onay ("DELETE" yaz), bitti | E11 | Web hesap silmeyle aynı metin (FRONTEND) |
| D-12 | **"Fotoğraflarımı ve üretilen görselleri sil" onayı** ve sonrası (try-on ve palet kilitli/boş hali) | E11 | Hesap silmeden bağımsız |
| D-13 | **EN uzun metin** — tüm 30 ekranın EN metinleri; 5 sekmeli tab bar, çipler, ürün satırı, paywall maddeleri taşmadan | Her epic | Panolar yalnız TR |
| D-14 | Şifre sıfırlama (02 e-posta + şifre) | E1 | Panosu yok |
| D-15 | Gizli / erişilemeyen dolap (26), boş arkadaş akışı (25), boş sepet (24), boş bavul geçmişi (18) | E8, E9 | |
| D-16 | Hava alınamadı (06, 16, 19) | E4, E5 | Sağlayıcı **A-4** |
| D-17 | Android (Material 3) karşılıkları | Her epic | Panolar iOS ölçüsünde |
| D-18 | Dark palet ve tüm ekranların dark hali | — | **Açık karar (A-9)** |
| D-19 | Paylaşılan profil/look linki ve web karşılığı | — | **Açık karar (A-6)** |

---

## Tasarım QA

Her sprint demosundan önce:

1. Uygulamayı **gerçek telefonda** aç (simülatör değil — font, dokunma alanı, güvenli alan ve widget yenilemesi farklı). iOS ve Android ayrı ayrı.
2. Sprintin her ekranını kaynak tasarıma karşı kontrol et: metin, boşluk, renk token'ı, durumlar (tüm varyantlar).
3. Beş durum ekranının hepsini zorla: boş, yükleniyor, hata, çevrimdışı (uçak modu), başarı. Widget varsa: light, dark, boş, çevrimdışı, uzun metin.
4. Dark mode'da aynı akış.
5. Erişilebilirlik: ekran okuyucuyla bir akış, en büyük yazı tipiyle bir akış.
6. Desteklenen tüm arayüz dillerinde aynı akış — taşma, kesilme, yanlış büyük harf.
7. Sapmaları tek bir listede PR'a ya da sprint notuna yaz: **ekran · beklenen · görülen · ekran görüntüsü**.

---

## Collaboration Rules

- **Mobile Engineer ile:** her ekranın kaynağı tasarım dosyası. Belirsizlik varsa geliştirici tahmin etmez, sorar; cevap bu rehberin "eksikler" tablosuna ya da kaynağa işlenir.
- **Product Manager ile:** yeni bir durum ekranı bir kabul kriterini ya da yetki matrisini etkiliyorsa PM onaylar.
- **QA Engineer ile:** kenar durumları (uzun metin, çok veriye sahip kullanıcı, boş listeler, paket sınırına gelmiş kullanıcı) QA'ya ayrıca verilir.
- **AI Engineer ile:** AI önerisinin nasıl işaretleneceği, cevap uzunlukları ve reddetme metinleri birlikte belirlenir.

---

## Teslim öncesi kontrol listesi (yeni ya da değişen her ekran)

- [ ] Beş durum çizildi: boş, yükleniyor, hata, çevrimdışı, başarı (widget'ta + uzun metin)
- [ ] Light ve dark
- [ ] iOS ve gerekiyorsa Android (Material 3) karşılığı
- [ ] Tüm değerler token'dan; yeni token gerektiyse `tokens.json`'a eklendi
- [ ] Renk anlamları uygulandı; doğru/yanlış ve kilitli durum metinle
- [ ] Metinler tüm arayüz dillerinde, kısa, sakin, suçlamasız; büyük harf kaynakta
- [ ] Kilitli olan görünür, nedeni yazılı
- [ ] Dokunma alanları ≥ 44 pt / 48 dp
- [ ] Erişilebilirlik: etiketler, kontrast, duyurulan mesajlar, büyük yazı tipi
- [ ] Tasarım kaynağı güncel
