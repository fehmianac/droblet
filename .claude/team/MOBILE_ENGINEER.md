# Mobile Engineer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
iOS ve Android için **React Native uygulaması** (`mobile/`) ve — proje gerektirirse — ona bağlı **native widget extension'ları** sende. Çevrimdışı çalışma, bildirimler, uygulama içi satın alma ve cihaz üzerindeki native yetenekler senin alanın.

**Droblet'te ürünün kendisi mobil uygulamadır.** Web dashboard yok; web yalnız landing, yasal sayfalar, web hesap silme ve davet linki karşılama sayfasıdır ([FRONTEND_ENGINEER.md](FRONTEND_ENGINEER.md)). Gardırop, look, plan/takvim, bavul, stilist, try-on, renk paleti, keşfet/mağaza, sosyal ve üyelik yüzeylerinin hepsi uygulamada.

- **Widget MVP'de yok.** Tasarımda widget panosu yok. "Günün kombini" ana ekran widget'ı MVP sonrası adaydır; gelirse aşağıdaki [Widget'lar](#widgetlar--uçtan-uca-proje-gerektirirse) kuralları aynen geçerlidir.
- Mobilin sahip olduğu native yetenekler: **kamera ve toplu fotoğraf yükleme** (parça ekleme, boy/yüz fotoğrafı), **konum** (hava — A-4), **rehber** (arkadaş bulma — A-8), **bildirimler**, **uygulama içi abonelik** (StoreKit 2 / Play Billing) ve markanın mağazasına **uygulama içi tarayıcıyla** yönlendirme.
- Sunucudaki AI işleri (`ItemProcessor`, `Stylist`, `TryOn`, `Palette`) uzun sürer; mobil bunları başlatır, durumunu sorgular ve sonucu önizletir (§Uzun süren sunucu işleri).

---

## Bu uygulama neden var

- **Kullanıcı problemi:** her sabah "ne giysem" kararı ve saatler süren bavul hazırlığı; dolapta olanı unutmak, aynı birkaç parçayı giymek, yeni alınan parçanın mevcut dolapla uyup uymadığını bilememek.
- **Vaat (hoş geldin ekranı):** "Sabah 'ne giysem' derdi ve saatler süren bavul hazırlığı bitti. Dolabın artık senin için düşünüyor." Paywall: "Her sabah hazır bir kombin. Her seyahatte hazır bir bavul."
- **North Star (öneri — PM ve ürün sahibi onaylar):** *haftalık giyilen kombin sayısı* — kullanıcının "Bunu giyiyorum" dediği ya da takvimde "ne giydim" olarak kaydettiği, Droblet'in önerdiği ya da kullanıcının Droblet'te kurduğu kombinler (`WearLog`).
  - **Sayılır:** günün kombininde "Bunu giyiyorum", plandaki bir günün giyildi işaretlenmesi, bavul look'unun seyahatte giyildi işaretlenmesi.
  - **Sayılmaz:** yalnız öneri üretilmesi (Stilist çağrısı), try-on görüntülenmesi, parça eklenmesi, keşfette gezinme, sepete ekleme. Bunlar ara metriktir.

Droblet'te bu ilke şu demek: **çevrimdışı açılan uygulama günün kombinini, gardırobu, look'ları ve bavul listesini son önbellekten gösterir**; "Bunu giyiyorum", hazırlık işaretleme, look kaydı ve kuyruğa alınmış parça fotoğrafları bağlantı yokken kaybolmaz.

Genel ilke: ekranlardan önce gelen iki şey **çevrimdışında anlamlı kalan bir uygulama** ve **kullanıcının yaptığı bir yazmanın — uygulamadan, widget'tan, çevrimdışı — asla kaybolmaması**dır.

---

## Neler hazır, neleri yapacaksın

| Parça | Durum | Nerede |
|---|---|---|
| Tasarım panoları (ekran dizini) | Hazır — 30 mobil ekran + tasarım sistemi | Canlı tasarım: https://claude.ai/artifact/UUAJnqCfrvDkh3yPPvnqw1 · metinler: `.claude/_handoff/droblet-handoff/SCREENS.md` (ekran no ↔ `*.dc.html` dosya adı) |
| Ölçü, metin, durum ve davranış için doğru kaynak | Hazır | Canlı tasarım (`.dc.html` okuma kılavuzu: [UX_DESIGNER.md](UX_DESIGNER.md) §Tasarım kaynakları). SCREENS.md ile çelişirse **canlı tasarım geçerlidir** |
| Token'lar (renk light/dark, tip, yarıçap, boşluk, dokunma alanı) | Light değerleri tasarımda hazır; `tokens.json` yazılacak (S0). **Dark palet yok — Açık karar (A-9)** | `design/tokens.json` → `src/theme/tokens.ts` |
| Mağaza metinleri ve ekran görüntüsü başlıkları | Yok — E12'de yazılacak | Handoff'ta yok; UX + PM hazırlar |
| Backend API | Epic başına sözleşme | [BACKEND_ENGINEER.md](BACKEND_ENGINEER.md) §Uç nokta haritası |

**Sözleşmesi yazılmamış bir epic'e başlama.** Her epic öncesi backend ile istek/cevap şekillerini sabitleyin (PRODUCT_MANAGER.md). O zamana kadar MSW ile kaydedilmiş sahte cevaplarla çalışılabilir, ama sahte cevabın şekli sözleşmeden gelir, tahminden değil. Widget varsa widget snapshot'ı da bir sözleşmedir.

---

## Tech Stack

| Layer | Choice | Why this one |
|---|---|---|
| Framework | React Native (Expo, bare-capable) | Ekip React ve TypeScript yazıyor; ikinci bir paradigma ikinci bir bakım yükü |
| Language | TypeScript, strict | |
| Navigation | Expo Router / React Navigation (native stack) | |
| Push | **Firebase Cloud Messaging** (`@react-native-firebase/messaging`) iOS + Android; izin ve ön plan gösterimi `expo-notifications` | |
| Storage | `expo-secure-store` for tokens, `AsyncStorage` for everything else | See [Tokens](#cihazdaki-tokenlar) |
| Data fetching | TanStack Query | Çevrimdışı önbellek, retry ve bayatlık mobildeki asıl problem |
| Styling | NativeWind (Tailwind for RN) | Tasarım sistemi token'ları Tailwind teması olarak taşınır |

**Bare React Native değil, Expo** — bir şey zorlamadıkça. Zorlayan tipik şeyler: **widget'lar, Live Activity, App Intents (Siri/Shortcuts, Control Center) ve Android Glance native kod ister.** Bunlar config plugin'li native target'larla Expo projesine eklenir (bkz. [Widget'lar](#widgetlar--uçtan-uca-proje-gerektirirse)).

Sık gelen eklemeler:

| İhtiyaç | Seçim | Not |
|---|---|---|
| Apple ile giriş | `expo-apple-authentication` (Expo SDK) | Native `ASAuthorizationAppleIDButton` çizer; `identityToken` + `nonce` → `POST v1/auth/apple` |
| Google ile giriş | Google'ın marka kurallarına uyan buton | Beyaz, 1px #747775 çerçeve, Roboto Medium, resmi G logosu |
| Uygulama içi satın alma | **Doğrudan StoreKit 2 / Google Play Billing** — dış servis yok | Expo config plugin'i olan bir native köprü kütüphanesiyle. Doğrulama **sunucuda** |
| Cihaz üzerinde işleme (TTS, konuşma tanıma, kamera metin tanıma vb.) | Cihaz API'leri | Hassas veri (ses, görüntü) cihazda işleniyorsa **ağa çıkmaz** — bu bir vaattir, QA ağ trafiğiyle doğrular |

Droblet'in ek ihtiyaçları (hepsi `npx expo install`; kesin seçim ilgili epic başında, gerekirse ADR):

| İhtiyaç | Seçim | Ne zaman | Not |
|---|---|---|---|
| Kamera (parça ekle, boy fotoğrafı) | `expo-camera` | E2 / E1 | Ekran 12 canlı vizör; 04 "Çek" |
| Galeriden çoklu seçim (toplu ekle, yüz fotoğrafı) | `expo-image-picker` (`allowsMultipleSelection`) | E2 | Ekran 13: tek seferde N fotoğraf |
| Yükleme öncesi küçültme / EXIF temizleme | `expo-image-manipulator` | E2 | Konum EXIF'i cihazdan çıkmaz |
| S3'e yükleme (arka planda devam edebilen) | `expo-file-system` (`uploadAsync`, binary PUT) | E2 | Presigned PUT; bkz. §Kamera ve toplu yükleme |
| Görsel gösterimi + disk önbelleği | `expo-image` | E2 | Özel görsellerin önbelleği çıkışta ve "fotoğraflarımı sil"de temizlenir |
| Konum (hava) | `expo-location` (yalnız "kullanırken", kaba konum) | E4 | **Açık karar (A-4)** — şehir seçimi alternatifi |
| Rehber (arkadaş bul) | `expo-contacts` | E9 | **Açık karar (A-8)** — kişi listesinin sunucuya gidip gitmeyeceği |
| Marka mağazasına yönlendirme | `expo-web-browser` (SFSafariViewController / Custom Tabs) + `Linking` | E8 | Ödeme Droblet'te alınmaz |
| Fontlar | `@expo-google-fonts/cormorant-garamond`, `@expo-google-fonts/jost` | S0 | Uygulamaya gömülü |
| Abonelik | StoreKit 2 / Play Billing native köprü (config plugin'li) | E10 | Yukarıdaki satırla aynı karar |

Uygulama kimliği: bundle id / package **`com.alatech.droplet`**, scheme `droplet`, universal link alanı `droblet.alatech.co` — üçü de **Açık karar (A-10)**; tahmin edilip yazılmaz. **Mağaza kaydından sonra değişmez.**

---

## Project Structure

```
mobile/
├── src/app/                      # Expo Router routes (rotalar src/app altında)
│   ├── (onboarding)/...          # onboarding akışı
│   ├── (auth)/start.tsx          # giriş yöntemleri — Apple / Google / telefon / e-posta
│   ├── (auth)/contact.tsx        # ülke kodu seçici
│   ├── (auth)/verify.tsx         # OTP
│   ├── (tabs)/index.tsx          # ana sekme
│   ├── (tabs)/{feature}.tsx      # diğer sekmeler
│   ├── {feature}/[id].tsx        # detay ekranları
│   ├── paywall.tsx               # Paywall (satın alma varsa)
│   ├── subscription.tsx          # abonelik yönetimi
│   ├── settings.tsx              # Settings
│   ├── notifications.tsx         # bildirim ayarları
│   ├── delete-account.tsx        # hesap silme (mağaza zorunluluğu)
│   ├── dev/components.tsx        # Bileşen vitrini (yalnız __DEV__)
│   └── _layout.tsx               # QueryClient + kalıcı önbellek + mutasyon kuyruğu + i18n
├── src/                          # rota olmayan kod
│   ├── api/                      # one module per resource
│   ├── auth/                     # token storage, refresh, session
│   ├── sync/                     # mutasyon kuyruğu, widget cevaplarının toplanması, çakışma ekranları, bekleyen sayısı
│   ├── widgets/                  # (varsa) snapshot → paylaşılan önbellek + zaman çizelgesi
│   ├── entitlement/              # sunucudan gelen yetkiyi okuyan hook'lar — paket mantığı burada değil, sunucuda
│   ├── i18n/                     # tr.json, en.json — tüm arayüz metinleri
│   ├── push/                     # registration, handlers
│   ├── components/
│   ├── theme/                    # tasarım sistemi token'ları → NativeWind teması (light + dark)
│   └── types/                    # API response shapes (copied, not shared)
├── modules/                      # (varsa) yerel Expo modülleri — ör. widget-store köprüsü
├── app.json                      # Expo config: scheme, permissions, notification config
└── package.json
```

Droblet rota listesi (ekran no ↔ tasarım dosyası, SCREENS.md sırasıyla). Rota adları İngilizce, arayüz metni çeviri dosyasında. Alt tab bar 5 sekme: **Bugün · Gardırop · Stilist (orta) · Keşfet · Profil**.

| Sekme / akış | Rota | Ekran (tasarım) | Epic |
|---|---|---|---|
| Onboarding | `(onboarding)/welcome.tsx` | 01 Hoş geldin — `Main.dc.html` | E1 |
| Giriş | `(auth)/start.tsx` | 02 Kayıt / giriş — `Kayit.dc.html` (Kayıt ol / Giriş yap; Apple, Google, e-posta + şifre) | E1 |
| Onboarding | `(onboarding)/style.tsx` | 03 Stil profili 1/3 — `OnbStil.dc.html` | E1 |
| Onboarding | `(onboarding)/body.tsx` | 04 Beden ve fotoğraf — `OnbFoto.dc.html` (Atla) | E1 |
| Üyelik | `paywall.tsx` (modal) | 05 Üyelik — `Paywall.dc.html` | E10 |
| **Bugün** | `(tabs)/index.tsx` | 06 Bugün — `Home.dc.html` | E4 |
| Bugün | `plan/week.tsx` | 07 Haftalık plan — `Hafta.dc.html` | E4 |
| Bugün / Keşfet | `edit/[id].tsx` | 08 Haftanın edit'i — `Edit.dc.html` | E8 |
| Bugün | `calendar.tsx` | 09 Takvim — `Takvim.dc.html` | E4 |
| **Gardırop** | `(tabs)/wardrobe/_layout.tsx` (üst sekmeler) | Parçalar / Looklar / Bavullar | E2 |
| Gardırop › Parçalar | `(tabs)/wardrobe/index.tsx` | 10 Gardırop — `Gardirop.dc.html` | E2 |
| Gardırop | `item/[id].tsx` | 11 Parça detayı — `Parca.dc.html` | E2 |
| Gardırop | `item/add.tsx` (modal, kamera) | 12 Parça ekle — `Ekle.dc.html` | E2 |
| Gardırop | `item/bulk.tsx` | 13 Toplu ekle — `TopluEkle.dc.html` | E2 |
| Gardırop › Looklar | `(tabs)/wardrobe/looks.tsx` | 14 Looklar — `Looklar.dc.html` | E3 |
| Gardırop | `look/new.tsx`, `look/[id].tsx` | 15 Look oluştur — `LookYeni.dc.html` (düzenleme aynı ekran) | E3 |
| Gardırop › Bavullar | `(tabs)/wardrobe/trips.tsx` | 18 Bavullar — `Bavul.dc.html` | E5 |
| Gardırop | `trip/[id].tsx` | 19 Bavul detayı — `BavulDetay.dc.html` | E5 |
| **Stilist** | `(tabs)/stylist.tsx` | 16 Stilist — `Stilist.dc.html` | E5 |
| Stilist | `stylist/[jobId].tsx` | 17 Kombin önerisi — `DanismanSonuc.dc.html` | E5 |
| Stilist / Profil | `palette.tsx` | 30 Renk paleti — `RenkPaleti.dc.html` | E7 |
| **Keşfet** | `(tabs)/discover.tsx` | 20 Keşfet — `Kesfet.dc.html` (Editör / Mağaza / Influencer / Arkadaşlar / Dizi outfitleri) | E8 |
| Keşfet | `shop/index.tsx` | 21 Stil mağazası — `Magaza.dc.html` | E8 |
| Keşfet | `shop/product/[id].tsx` | 22 Ürün + üzerimde — `Urun.dc.html` | E8 / E6 |
| Keşfet | `shop/builder.tsx` | 23 Kombin oluşturucu — `KombinOlusturucu.dc.html` | E8 |
| Keşfet | `cart.tsx` | 24 Sepet — `Sepet.dc.html` | E8 |
| Keşfet › Arkadaşlar | `friends/feed.tsx` | 25 Arkadaş akışı — `Akis.dc.html` | E9 |
| Keşfet | `u/[handle].tsx` | 26 Kişi profili — `Kisi.dc.html` | E9 |
| Keşfet | `friends/find.tsx` | 27 Dolapları keşfet — `Arkadaslar.dc.html` | E9 |
| **Profil** | `(tabs)/profile.tsx` | 28 Profil — `Profil.dc.html` | E11 |
| Profil | `settings.tsx` | 29 Gizlilik ve ayarlar — `Ayarlar.dc.html` | E11 |
| Profil | `subscription.tsx`, `notifications.tsx`, `delete-account.tsx` | Panosu yok — UX eksikler tablosu (D-x) | E10 / E11 |
| Ortak | `tryon/[jobId].tsx` (sayfa ya da sheet) | "Üzerimde gör" sonucu — 07, 15, 19, 22'den açılır | E6 |

Şablondaki `(auth)/contact.tsx` ve `(auth)/verify.tsx` (telefon/OTP) tasarımda yok; Droblet girişi Apple / Google / e-posta + şifre. Web hesap silmedeki e-posta OTP'si (FRONTEND) ayrı bir akıştır. Şifre sıfırlama ekranı tasarımda yok → UX eksikler tablosu.

**Doğrulanmış sürümler (önceki projede):** Expo SDK 57, React Native 0.86, expo-router 57 (`expo-router/ui` başsız sekmeler → özel TabBar), NativeWind 4.2.7 + Tailwind 3.4 (`tailwind.config.ts` token'ları `src/theme/tokens.ts`'ten okur), React Native Testing Library 14 (`render` ve `fireEvent` asenkron — `await`). Paket eklerken her zaman `npx expo install`.

**Tipler kopyalanır, paylaşılmaz.** API sözleşmedir; mağaza kuyruğundan geçen bir uygulamayla backend arasında paylaşılan bir paket sürüm problemi üretir.

---

## Tasarımdan gelen kurallar

**Kaynak:** canlı tasarım https://claude.ai/artifact/UUAJnqCfrvDkh3yPPvnqw1 ("Droblet — Uygulama UX/UI") + `.claude/_handoff/droblet-handoff/` (README.md, SCREENS.md). Ton: **"Sakin, editoryal, kişisel."** Sen dili, kısa cümleler.

**Token'lar → NativeWind teması** (`design/tokens.json` → `src/theme/tokens.ts` → `tailwind.config.ts`):

| Token (öneri adı) | Tasarımdaki ad | Değer | Kullanım |
|---|---|---|---|
| `ink` | Mürekkep | `#1C1A17` | Ana metin, birincil buton zemini |
| `cream` | Krem zemin | `#F4F1EC` | Ekran zemini |
| `paper` | Kâğıt | `#FBF9F5` | Kart, sheet |
| `espresso` | Espresso vurgu | `#6E5640` | Vurgu, seçili, bağlantı |
| `ink-secondary` | İkincil metin | `#665F56` | Açıklama, meta |
| `line` | Çizgi | `#DCD4C9` | Ayırıcı, alan çerçevesi |
| `sand` | Kum | `#E8E1D7` | Çip, görsel yer tutucu, ikincil yüzey |
| `alert` | Uyarı | `#9A3B2E` | Hata / yıkıcı aksiyon (her zaman metinle) |

Dark palet tasarımda yok — **Açık karar (A-9)**. Token yapısı yine light + dark iki palet olarak kurulur (ekip kuralı); karar gelene kadar dark değerler doldurulmaz ve dark mode açılmaz.

**Fontlar** (gömülü): **Cormorant Garamond** (başlıklar) + **Jost** (gövde, etiket).

| Stil | Font | Ağırlık | Boyut / satır |
|---|---|---|---|
| Display | Cormorant Garamond | 500 | 36 / 38 |
| Başlık 2 | Cormorant Garamond | 500 | 26 |
| Başlık 3 | Cormorant Garamond | 600 | 20 |
| Gövde | Jost | 400 | 14 / 21 |
| Üst etiket | Jost | 500 | 11, harf aralığı %14 (RN'de `letterSpacing` ≈ 1.54) |

**Üst etiket notu:** tasarımdaki "Üst etiket" stili (ör. "Haftalık stil", "Senin üzerinde", "Bugünün kombini") **CSS/Tailwind ile büyük harfe çevrilmez** — NativeWind'de `uppercase` sınıfı, RN'de `textTransform: 'uppercase'` yasak. Etiket canlı tasarımda hangi harfle görünüyorsa `tr.json` ve `en.json`'a **o harfle** yazılır (Türkçe `i → İ` dahil). Stil yalnız font, boyut ve harf aralığını verir.

**Ölçüler:** ekran kenarı 20 · ızgara 4/8 · kart köşesi 20 · görsel köşesi 12–14 · birincil buton yüksekliği 52, ikincil 44 · dokunma alanı ≥ 44 (Android ≥ 48 dp — ekip kuralı geçerli). Bileşenler: birincil / ikincil buton, seçili, çip, rozet, alan, marka, ürün satırı.

**Ürüne özel görünürlük kuralları (gizlilik vaatleri — bozulamaz):**
- Boy/yüz fotoğrafları ve try-on çıktıları ("Senin üzerinde", "Üzerimde gör") **yalnız sahibine** gösterilir. Başka bir kullanıcının profilinde/akışında (25–27) look'lar parça görselleriyle gösterilir; try-on görseli hiçbir görünürlük ayarında görünmez.
- Özel görseller kısa ömürlü imzalı URL'lerle gelir; `persistQueryClient`'a URL'nin süresinden uzun yazılmaz, `expo-image` disk önbelleği çıkışta ve "Fotoğraflarımı ve üretilen görselleri sil"de temizlenir.
- AI çıktısı her zaman işaretli: "AI önizleme" (17), "Gömlek algılandı" (12), "Yüz fotoğrafından AI ile çıkarıldı" (30).
- Ödeme Droblet'te alınmaz: "Ödeme ve teslimat … kendi mağazasında tamamlanır." metni ürün (22) ve sepette (24) her zaman görünür.
- Fiyatlar ₺ ve `tr-TR` biçimiyle (ör. ₺26.550); tasarımdaki `[FİYAT]`, `[AYLIK FİYAT]` vb. yer tutucular üretime girmez.

Projeden bağımsız kurallar:

- **Yalnız token.** Renk, boşluk, yarıçap ve tipografi `tokens.ts`'ten; NativeWind temasına buradan aktarılır. Bileşende hex yazılmaz. Light ve dark iki tam palet.
- **Font** uygulamaya gömülü (`@expo-google-fonts/*` ya da yerel dosya).
- **Büyük harf etiketler** metin olarak **kaynakta ve çeviri dosyasında büyük harfle** yazılır; `textTransform: 'uppercase'` kullanılmaz. Türkçe büyük harf (`i → İ`) stil motoruna bırakılmaz.
- **Renk tek başına anlam taşımaz** — hata/başarı durumları metin ya da ikonla da belirtilir.
- **Dokunma alanı:** iOS ≥ 44 pt, Android ≥ 48 dp.
- **Platform farkı:** Android panoları Material 3 uyarlamasıysa aynı ekranın Android hali `Platform.select` ile uygulanır; iOS tasarımı Android'e kopyalanmaz.
- **Hata ve boş durumlarda** her zaman tek, açık bir sonraki adım.
- **Erişilebilirlik:** Dynamic Type / font ölçeği; her ikon butonunda `accessibilityLabel`; snackbar ve senkron mesajlarında `accessibilityLiveRegion="polite"`; kontrast ≥ 4.5:1.
- **Metinler** tasarımdaki metinle birebir aynı ve **çeviri dosyasında** (TR + EN). Uzun dillere (DE) dayanıklı düzen.
- Panolardaki isimler ve veriler örnektir.

---

## Cihazdaki tokenlar

- **Access ve refresh token `expo-secure-store`'da** — iOS'ta Keychain, Android'de Keystore. `AsyncStorage` düz bir dosyadır.
- **Refresh token uzun ömürlü ve döner.** `POST /v1/auth/refresh` yeni bir çift döndürür ve eskisini geçersiz kılar; iki eşzamanlı refresh yarışı kullanıcıyı çıkış yaptırır. Refresh'leri **tek bir promise'in arkasında sıraya koy.**
- **Çevrimdışı kuyruk boşaltılırken 401 almak, kullanıcıyı çıkış yaptırmak için en kötü an.** Önce refresh, sonra bir kez yeniden dene. Refresh de başarısızsa kuyruğu **silme**; girişten sonra kaldığı yerden devam et. Kuyruktaki yazmalar kullanıcının emeği.
- **Widget extension'ı token taşımaz.** Widget ağa çıkmaz; yalnız paylaşılan önbelleği okur ve cevapları oraya yazar.

---

## Çevrimdışı ve senkron — uçtan uca

### Okuma
- TanStack Query önbelleği AsyncStorage'a kalıcı yazılır (`persistQueryClient`). Uygulama internetsiz açıldığında son görülen veriler görünür.
- Yenileme: uygulama ön plana gelince, ekran odağa gelince ve açık ekranda periyodik (`refetchInterval`). Gerçek zamanlı kanal yok (proje aksini karar vermedikçe).
- Filtrelenmiş listeler mümkünse cihazda, önbellekteki veriler üzerinde kurulur — çevrimdışı da çalışır.

### Yazma
- Her değişiklik bir **mutasyon** olarak kuyruğa girer ve kalıcı yazılır (TanStack Query paused mutations + persist). Bağlantı gelince **sırayla** gönderilir.
- **İyimser güncelleme:** değişiklik hemen ekranda görünür; bekleyen değişiklikler küçük bir "senkronize ediliyor (3)" göstergesiyle işaretlenir.
- **Yeni kayıtların id'si cihazda üretilir (ULID).** Çevrimdışı oluşturulan bir kayıt sunucuya ulaşmadan kullanılabilir.
- **Olay tipi yazmalar** (ör. bir cevap, bir işaretleme): `{ {entityId}, ..., occurredAt, clientMutationId }`. `clientMutationId` olay anında **bir kez** üretilir ve her yeniden denemede aynı kalır; `occurredAt` cihaz saatidir, gönderim saati değil. Toplu uçlara gönderilebilir (ör. en fazla 100).

### Widget cevapları (proje gerektirirse)
- Widget'taki etkileşimler widget tarafında (App Intent / Glance action) **paylaşılan yerel depoya** yazılır — `clientMutationId` ve zaman damgası orada üretilir.
- Uygulama her açılışta ve arka planda fırsat buldukça bu cevapları toplar, mutasyon kuyruğuna ekler ve paylaşılan depodan siler. Aynı cevap iki kez toplansa da sunucu `clientMutationId` ile tanır.
- **Sözleşme:** widget cevap üretir, uygulama gönderir.

### Çakışma
Sunucunun cevapları ve ekrandaki karşılıkları:

| Sunucu | Ne oldu | Ekranda |
|---|---|---|
| Olay ucu → 200 | Uygulandı (ya da zaten uygulanmıştı — idempotent) | Hiçbir şey sorma; yerel durumu güncelle |
| `PUT` / `PATCH` → **409** + güncel kayıt | Aynı kayıt başka bir cihazda değişti | "Bunu başka bir cihazda değiştirdin" — iki değeri yan yana göster: **Diğerini tut / Bunu kaydet** |
| `PUT` / olay ucu → **404** | Kayıt başka bir cihazda silindi | "Bunu başka bir cihazda sildin" — **Tamam / Yeniden ekle** |

Kurallar:
- **Sessizce üzerine yazma yok.** "Bunu kaydet" yeni `baseVersion` ile yeniden gönderilir; bu bir kullanıcı kararıdır.
- Çakışma ekranları kuyruğu durdurmaz: çakışan mutasyon kenara alınır, diğerleri devam eder.

### Neler çevrimdışı çalışmaz
- Önbellekte olmayan veri, AI özellikleri, satın alma vb. Bu girişler devre dışı değil, **açıklamalı durum** gösterir ve bir sonraki adımı verir.

Droblet'te:

| Çevrimdışı çalışır (önbellek / kuyruk) | Çevrimdışı çalışmaz (açıklamalı durum) |
|---|---|
| Bugün: son günün kombini, hafta şeridi (06) | Yeni kombin önerisi, "Öner", "Haftamı planla" (07, 16–17) — Stylist |
| "Bunu giyiyorum" / takvimde "ne giydim" — olay, kuyruğa (`WearLog`) | "Üzerimde gör" — TryOn |
| Gardırop listesi, filtreler, parça detayı (10–11) — cihazda filtrelenir | Parça işleme (arka plan temizleme, algılama) — fotoğraf kuyrukta bekler, işleme bağlantı gelince başlar |
| Parça düzenleme, look oluşturma/düzenleme gardıroptaki parçalarla (15) | Renk paleti analizi (30) — Palette |
| Bavul listesi ve hazırlık işaretleme (19) — olay, kuyruğa | Yeni bavul oluşturma (18) ve şehir hava tahmini |
| Takvim ve haftalık plan (son önbellek) | Mağaza araması, katalog, sepet ödemesi (marka sitesi), edit'in güncel hali |
| Kamera / galeriden parça fotoğrafı çekmek (yükleme kuyruğu) | Arkadaş akışı yenileme, kullanıcı arama, rehberden bulma |
| Takip et / look puanla — olay, kuyruğa | Abonelik satın alma ve geri yükleme; hesap silme |

Tasarımda çevrimdışı metni yok → UX eksikler tablosunda çizilir; metinler ton kuralına uyar ("Bağlantı gelince önerini hazırlarız." gibi — kesin metin UX'ten).

---

## Widget'lar — uçtan uca (proje gerektirirse)

### Teknik yol
- **`expo-widgets`** — TSX widget'lar; native target'lar config plugin'le üretilir. Layout'lar `mobile/src/widgets/` altında platforma göre (`*.ios.tsx` / `*.android.tsx`), snapshot sözleşmesi `contract.ts`.
- **Paylaşılan önbellek:** iOS'ta **App Group**, Android'de **SharedPreferences**. Android'de props okuma için yerel modül: `mobile/modules/widget-store/`.
- Aynı paketle Live Activity de yapılabilir. Gerçek cihaz denemesiyle kesinleştir; seçim bir ADR'ye yazılır.

### Kurallar
- **Yalnız yerel önbellekten çizilir.** Uygulama snapshot ucunu (ör. `GET v1/tenant/widget/snapshot`) alır, paylaşılan önbelleğe yazar ve **zaman çizelgesini önceden** (ör. 24 saat) kurar. **Widget kodunda ağ çağrısı yok.**
- **Widget'taki cevaplar** yerelde kaydedilir → uygulama senkronlar (yukarı).
- **Sistem yenileme bütçesine uyulur.** Gerçek zamanlı ya da dakikalık güncelleme **vaat edilmez**.
- **Her widget'ın beş hali var:** light, dark, boş, **çevrimdışı** (son önbelleği anlamlı gösterir), uzun metin.
- **Karmaşık etkileşimler** deep link ile uygulamayı açar (`droplet://...`).
- **Paket farkı** varsa kilitli widget görünür kalır, dokununca paywall'a gider; abonelik bitince widget kaldırılmaz, kilitli haline geçer.
- **Kurulum:** iOS'ta sistem widget eklemeyi uygulamadan yapamaz — adım adım anlatım; Android'de tek dokunuşla ekleme (`requestPinAppWidget`).
- **Olaylar:** `widget_installed{family,size}`, `widget_removed`, `widget_interaction{family,action}`.

**Droblet MVP'de widget, Live Activity, App Intents ve Control Center yüzeyi yok** (tasarımda yok). MVP sonrası aday: "Günün kombini" ana ekran widget'ı (küçük/orta) ve "Bunu giyiyorum" etkileşimi. Gelirse: snapshot sözleşmesi Api'den, try-on görseli widget'ta yalnız cihaz sahibinin paylaşılan önbelleğinde; ayrı epic + ürün sahibi kararı.

---

## Kapsam (MVP)

| Sekme | Ekranlar | Not |
|---|---|---|
| Onboarding | 01–04 | 04 atlanabilir; fotoğraflar sonradan Profil'den eklenir. Genç (13–18) seçimi: yaş doğrulama, veli onayı ve kısıtlar **Açık karar (A-5)** |
| Üyelik | 05 + abonelik yönetimi | Onboarding sonunda ve kilitli özellik anlarında açılır (§Abonelik) |
| **Bugün** | 06–09 | Hava: **Açık karar (A-4)**. Günün ortamı takvimden/plandan; "Bunu giyiyorum" → `WearLog` olayı |
| **Gardırop** | 10–15, 18–19 | Üst sekmeler Parçalar / Looklar / Bavullar. Parça ekleme AI taslağı **kullanıcı onayı olmadan kaydedilmez** (12–13) |
| **Stilist** | 16–17, 30 | Ortam + hava + "Sadece gardırobum" → 3 öneri. Eksik parça önerisi mağazaya bağlanır; "Takvime ekle" → `PlanDay` |
| **Keşfet** | 08, 20–27 | Global içerik + katalog; sepet markaya göre gruplu, ödeme marka sitesinde. Katalog kaynağı **Açık karar (A-2)**, influencer/dizi içerik hakları **Açık karar (A-7)** |
| **Profil** | 28–30 + ayarlar | Dolap görünürlüğü (Herkese açık / Yalnızca takipçiler / Gizli; varsayılan **Açık karar (A-6)**); fotoğraf + üretilen görsel silme (hesap silmeden bağımsız); bildirim tercihleri; çıkış; hesap silme |

### Kamera ve toplu fotoğraf yükleme (E2, E1)
Parça fotoğrafları (12–13), boy fotoğrafı ve yüz fotoğrafı (04) **özel S3 nesneleri**dir. Akış:

1. **Çek / seç.** Kamera (12, 04 "Çek") ya da galeriden çoklu seçim (13, 04 "Yükle"). Dosya hemen uygulamanın kendi dizinine kopyalanır (`documentDirectory/uploads/<ULID>.jpg`) — kullanıcı galeriden silse de kuyruk kaybolmaz. Küçültme + EXIF (konum dahil) temizliği cihazda.
2. **Yükleme kuyruğu (kalıcı, çevrimdışı).** Her fotoğraf bir mutasyon: `{ uploadId (ULID), kind: item|body|face, localUri, clientMutationId, occurredAt }`. Mutasyon kuyruğuyla aynı kurallar: sırayla, kullanıcıya göre anahtarlı, 401'de silinmez. "Senkronize ediliyor (N)" göstergesi yüklemeleri de sayar.
3. **Presigned URL gönderim anında alınır**, kuyruğa alınırken değil (URL'nin süresi dolar): `POST v1/tenant/uploads` → `{ uploadId, url, headers, expiresAt }` → `PUT` doğrudan S3'e (`expo-file-system` `uploadAsync`). 403/süre dolması → yeni URL iste, bir kez yeniden dene.
4. **İşi başlat.** Parça için `POST v1/tenant/items/process` (202, `jobId`) → `ItemProcessor`. Toplu eklemede (13) her fotoğraf ayrı iş; ekran "12 fotoğraf işleniyor · 8 / 12" sayacını işlerin durumundan kurar.
5. **Önizle / onayla.** Sonuç bir **taslaktır** (arka planı temizlenmiş görsel, tür, renk, kumaş, sezon önerisi). Kullanıcı "Kontrol et" listesinde düzeltir, "Kategoriyi kontrol et" uyarılarına bakar, "N parçayı gardıroba ekle" ile `POST v1/tenant/items` (cihazda üretilmiş ULID'lerle) yapar. Onaylanmayan taslak gardıroba girmez.
6. Boy/yüz fotoğrafı yüklenince try-on hazırlığı ve `Palette` işi tetiklenir; Profil'de "Stil fotoğrafın hazır" (28) sunucu durumundan gelir.

Uç adları örnektir; kesin şekil E2 sözleşmesinde backend ile sabitlenir.

### İzinler
Her izin önce **kendi açıklama ekranımız** (UX eksikler tablosu), sonra sistem diyaloğu; reddedilirse akış devam eder ve tek bir sonraki adım gösterilir. `app.json` izin metinleri (Info.plist / Android) TR + EN.

| İzin | Nerede | Reddedilirse |
|---|---|---|
| Kamera | 12 Parça ekle, 04 boy fotoğrafı | Galeriden seç + Ayarlar'a git |
| Fotoğraflar (galeri; iOS sınırlı erişim desteklenir) | 13 Toplu ekle, 04 yüz fotoğrafı | Kamerayla çek + Ayarlar'a git |
| Konum ("kullanırken", kaba) | 06 / 16 hava | **Açık karar (A-4)** — şehir seçimiyle devam |
| Rehber | 27 "Rehberinden arkadaşlarını bul" | **Açık karar (A-8)** — kullanıcı adı ara / davet linki |
| Bildirim | §Push bildirimleri | Uygulama çalışır; Profil › Ayarlar'dan açılır |

### Uzun süren sunucu işleri (AI vb.)
İstek → `POST v1/tenant/{feature}` (202) → `GET v1/tenant/{feature}/{id}` ile sorgula → sonuç. AI taslağı **önizle / düzenle** adımından geçmeden kalıcı kayda dönüşmez. Kota varsa kalan hak sunucudan gelir; başarısız işte kota sunucuda iade edilir ve kullanıcıya söylenir.

Droblet'in işleri:

| İş | Worker (SQS) | Başlatan ekran | Sonuç / önizleme |
|---|---|---|---|
| Parça işleme | `ItemProcessor` (`item-process-request`) | 12, 13 | Taslak parça → kullanıcı onayı |
| Stilist | `Stylist` (`stylist-request`) | 06 günün kombini, 07 "Haftamı planla" / "Öner", 16 "Kombin öner" / "Bavul hazırla", 17 eksik parça | 3 öneri (17) → "Takvime ekle"; bavul listesi + günlük look'lar (19) |
| Try-on | `TryOn` (`tryon-request`) | "Üzerimde gör": 07, 15, 19, 22, 23 | Kullanıcının boy fotoğrafında görsel — yalnız sahibine |
| Renk paleti | `Palette` (`palette-request`) | 04 yüz fotoğrafı, 30 | Sezon tipi, tonlar, gardırop uyum oranı |

Sorgulama (polling) kuralları:
- Tek bir `useJob(kind, id)` hook'u: TanStack Query `refetchInterval` artan aralıkla (ör. 1 sn → 2 → 4, üst sınır 10 sn); `done` / `failed` gelince durur. Ekran odaktan çıkınca durur, ön plana gelince devam eder. Gerçek zamanlı kanal yok (ekip kararı).
- `jobId` kalıcı yazılır: uygulama kapanıp açılınca devam eden iş ekranda "hazırlanıyor" olarak görünür, yeniden başlatılmaz.
- Başlatma isteği `clientMutationId` taşır; aynı istek iki kez giderse sunucu tek iş açar.
- Bekleme ekranları "yükleniyor" durumunun parçasıdır ve iptal edilebilir (iş sunucuda sürebilir; sonuç sonra listede görünür).
- `failed`: kullanıcıya sakin metin + "Tekrar dene"; kota iadesi sunucudan, metin `extractApiError` kodlarından.
- AI sağlayıcıları ve süre/maliyet: **Açık karar (A-3)**. Her worker ayrı kill switch bayrağıyla kapatılabilir (§Release).

**Durum ekranları** (boş / yükleniyor / hata / çevrimdışı / başarı) **her ekranda zorunlu**. Bir ekran bunlardan biri olmadan `Bitti` sayılmaz.

Droblet'te tasarımın çizmediği ve sık gözden kaçacak durumlar (çizimleri UX eksikler tablosunda): boş gardırop (0 parça — 06, 10, 14, 16 "Sadece gardırobum" ve 30 uyum oranı buna bağlı); boy fotoğrafı yokken "Üzerimde gör"; AI işi sürüyor / başarısız (12–13, 17, 19, try-on, 30); hava alınamadı (06, 16); boş arkadaş akışı (25); "Gizli" dolaplı profil (26); boş sepet (24); kilitli (ücretli) özellik.

### Uzun süren sunucu işleri (AI vb.)
İstek → `POST v1/tenant/{feature}` (202) → `GET v1/tenant/{feature}/{id}` ile sorgula → sonuç. AI taslağı **önizle / düzenle** adımından geçmeden kalıcı kayda dönüşmez. Kota varsa kalan hak sunucudan gelir; başarısız işte kota sunucuda iade edilir ve kullanıcıya söylenir.

### Abonelik (varsa)
- Yetki **kullanıcı bazında**. Hangi özelliğin açık olduğu ve kalan kotalar sunucudan (`GET v1/tenant/entitlement`) gelir; **uygulamada paket mantığı ve sabit sayı yok** — yalnız sunucunun kararı gösterilir.
- Paywall: fiyat, dönem, deneme ve otomatik yenileme koşulları satın alma butonunun yanında; **Restore Purchases her zaman görünür**; Terms ve Privacy linkleri.
- Satın alma akışı: mağaza ödeme sayfası → işlem kimliği → `POST v1/tenant/entitlement/purchase` → sunucu doğrular → yetki yenilenir. **Sunucu onaylamadan ücretli özellik gösterilmez.**
- Abonelik bitince kullanıcı verisi kalır; ücretsiz sınırlara dönülür.
- Test: iOS sandbox hesabı + StoreKit yapılandırma dosyası; Android lisans test hesabı.

Droblet:
- **Paket:** "Droblet Üyelik" — aylık ve yıllık, ücretsiz deneme; "Satın alımları geri yükle" (05). Fiyatlar, deneme süresi ve ücretsiz paket sınırları **Açık karar (A-1)** — tasarımdaki `[AYLIK FİYAT]` / `[YILLIK FİYAT]` / `[PLAN ADI]` yer tutucudur; mağaza ürün kimlikleri E10'da ürün sahibinden gelir. Fiyat her zaman mağazadan (StoreKit / Play Billing) yerel para birimiyle okunur, uygulamada sabit fiyat yok.
- **Üyelikle gelenler (paywall metni):** sınırsız "üzerimde gör", kişisel stil danışmanı (günlük kombin), akıllı bavul, renk paleti analizi. Ücretsiz pakette ne kaldığı **Açık karar (A-1)**; uygulama yalnız `GET v1/tenant/entitlement`'ı gösterir.
- **Paywall anları:** onboarding sonu (04'ten sonra) ve kilitli bir özelliğe dokunulduğunda (Üzerimde gör, Kombin öner, Bavul hazırla, Renk paletim). Kilitli olan gizlenmez; ne olduğu ve neden kilitli olduğu görünür. Hangi anda açılacağı ürün sahibiyle kesinleşir.
- **Mağaza alışverişi IAP değildir.** Sepet (24) marka başına "X'da öde" → markanın ürün/sepet sayfası `expo-web-browser` ile (uygulama içi tarayıcı) ya da marka uygulaması yüklüyse deep link ile açılır. Ödeme verisi Droblet'e hiç gelmez. Affiliate parametreleri ve gelir modeli **Açık karar (A-2)**.
- **Referans/davet:** davet linki (27) üyelik avantajı vermez (tasarımda yok).
- **Kapsam dışı (MVP):** widget, web dashboard, uygulama içi ödeme (fiziksel ürün), tablet düzeni (karar yok).

---

## Push bildirimleri

- **İzin zamanı ürün kararıdır.** Önerilen: önce kendi açıklama ekranımız, sonra sistem izni. Android 13+ `POST_NOTIFICATIONS`. Reddedilirse akış devam eder; Ayarlar'dan açılabilir.
- **Kullanıcı saatleri** ekranda yerel saat, kabloda **UTC** (`HH:mm`); çeviri bir hook içinde (ör. `src/notify/time.ts`).
- Pazarlama bildirimleri **ayrı rıza ister**, varsayılan kapalı.
- Dokununca ilgili yer açılır: `droplet://...`.
- Token **her soğuk açılışta** kaydedilir (`PUT v1/tenant/user/me/device`), yalnız girişte değil — token'lar döner ve süresi dolar.
- Android: bildirim türlerine göre ayrı kanallar; kullanıcı birini sistemden de kapatabilir.

Droblet bildirim türleri (`Notifier`, ekran 29'daki anahtarlar = Android kanalları):

| Tür / kanal | İçerik | Açılan yer | Varsayılan |
|---|---|---|---|
| Sabah kombin hatırlatması | Günün kombini hazır | `(tabs)/index` (06) | Saat: **Açık karar** (listede yok — PM'e) |
| Haftanın edit'i | Yeni haftalık edit | `edit/[id]` (08) | Ürün satışı içerdiği için pazarlama rızası sayılıp sayılmayacağı **Açık karar** (listede yok — hukuk/PM); sayılırsa varsayılan kapalı |
| Arkadaş puanları | Look'unu puanlayanlar | ilgili look | Açık |

- **İzin zamanı (öneri):** onboarding'de değil; kullanıcı ilk günün kombinini gördükten sonra kendi açıklama ekranımızla ("Her sabah kombinini hatırlatalım mı?" — kesin metin UX'ten), sonra sistem izni.
- Sessiz saatler tasarımda yok. Ton: sakin, editoryal, sen dili; ünlem ve aciliyet dili yok.

---

## Deep link

- Şema: `droplet://...`; web linki `https://droblet.alatech.co/...` — uygulama yüklüyse uygulamayı açar (universal link / app link), değilse web sayfası mağaza butonunu gösterir.
- **Android:** kurulumdan sonra parametre Play Install Referrer ile gelebilir. **iOS:** deferred deep link ayrı bir servis kararıdır; elle giriş her zaman çalışmalı.
- Kullanıcı giriş yapmamışsa link parametresi saklanır; kayıttan sonra uygulanır.

Droblet rotaları (scheme ve alan adı **Açık karar (A-10)**):

| Link | Açılan yer | Not |
|---|---|---|
| `droplet://today` | 06 Bugün | Sabah bildirimi |
| `droplet://edit/{id}` | 08 Haftanın edit'i | Bildirim |
| `droplet://look/{id}` | Look detayı | Arkadaş puanı bildirimi (kendi look'u) |
| `https://droblet.alatech.co/invite/{code}` | 27 → davet edenin profili (26) + "Takip et" | Davet linki (27). Uygulama yoksa web karşılama sayfası ([FRONTEND_ENGINEER.md](FRONTEND_ENGINEER.md)); girişten sonra uygulanır |
| `https://droblet.alatech.co/u/{handle}`, `/l/{id}` | Paylaşılan profil / look | **Açık karar (A-6)** — karar gelmeden yapılmaz |

---

## API conventions you inherit

- **Base URL**: tek bir sabit, Expo config'ten okunur; build yerel, staging ya da prod'a işaret edebilir. Ekranda sabit URL yok.
- **Auth header**: `/v1/tenant/*` altındaki her şeyde `Authorization: Bearer {accessToken}`.
- **Hatalar**: doğrulama hataları RFC 9110 `ProblemDetails` (`detail` alanı) olarak gelir; iş kuralı hataları **kod** olarak gelir (ör. `monthly_limit_reached`). İkisini de işleyen tek bir `extractApiError` yaz; kod çeviri dosyasında kullanıcının diline çevrilir — "Bir şeyler ters gitti" son çaredir.
- **Zamanlar kabloda UTC, ekranda cihaz saat diliminde.** Kullanıcının saat dilimi profilde ve cihaz kaydında sunucuya gider.
- **Önbellek ve mutasyon kuyruğu kullanıcıya göre anahtarlanır** — çıkış yapıp başka hesapla girince eski kuyruk yeni hesaba gönderilmez.

**Kullanıcı = tenant** (tek kişi, rol yok, tenant değiştirme yok). Sosyal ekranlar (25–27) başka kullanıcının verisini yalnız sunucudaki `VisibilityPolicy`'den geçmiş cevaplarla görür; mobil görünürlük kuralını kendisi uygulamaz, yalnız sunucunun döndüğünü gösterir. Başka kullanıcının verisi kendi kullanıcının önbellek anahtarı altında, ayrı sorgu anahtarlarıyla tutulur ve "Gizli"ye geçen birinin verisi 403/404'te önbellekten silinir. Global veri (edit, katalog, influencer, dizi outfitleri) tenant'sız uçlardan gelir.

---

## Testing

| Layer | Tool | What it covers |
|---|---|---|
| Unit | Jest + React Native Testing Library | Token refresh yarışı, mutasyon kuyruğu sırası, `clientMutationId` ve zaman damgası kararlılığı, widget cevaplarının toplanması (çift toplama), çakışma eşlemesi (200/409/404), TR ve EN çeviri dosyalarında aynı anahtarlar |
| Integration | Mock Service Worker | Ekranlar, kaydedilmiş API cevaplarıyla; 409, 404, 403 (yetki) ve 429 (kota) senaryoları dahil |
| E2E | Maestro | Onboarding (01–04, "Atla" dahil) + e-posta ile kayıt/giriş; parça ekle → taslak onay; toplu ekle (çevrimdışı kuyruk → bağlantı); "Bunu giyiyorum"; Kombin öner → Takvime ekle; bavul oluştur + hazırlık işaretleme; ürün → sepet → marka sitesine çıkış; paywall sandbox satın alma + geri yükleme; fotoğrafları sil; hesap sil |
| Manual, every release | Gerçek cihaz × 2 | Uçak modunda yazma → bağlantı → sunucuda görünür; dark mode; en büyük yazı tipi; bildirim saatinde gelir; (varsa) widget'ı yardımsız kur, kilit ekranı widget'ı |

**Son satır isteğe bağlı değil ve otomatikleştirilemez.** İki gerçek telefon, iki platform, her sürümden önce. Simülatör kodun doğru olduğunu söyler; gerçek cihazda, gerçek yenileme bütçesiyle doğru davrandığını söylemez.

Ne yaptığını yaz. İmza formatı için bkz. [QA_ENGINEER.md](QA_ENGINEER.md).

---

## Release

- **Over-the-air (Expo Updates)** yalnız JS değişiklikleri için. **Widget extension'ları native koddur** — widget'a dokunan her değişiklik bir mağaza build'idir.
- **Mağaza build'i** native değişiklikler için: izinler (bildirim, mikrofon, kamera…), entitlements (App Group dahil), widget / Live Activity / App Intents target'ları, deep link alan adları.
- **Android'de kademeli yayın** ve bir **kill switch**: dış bağımlılığı olan özellikleri (ör. AI) kapatan bir sunucu bayrağı. Sağlayıcı çökerse ya da maliyet patlarsa özellik "şu an kullanılamıyor" der, uygulama bozulmaz. Bayrak ilk mağaza gönderiminden **önce** yapılır.
- Sürüm hattı: [DEVOPS_ENGINEER.md](DEVOPS_ENGINEER.md) §Mobil Sürüm.

Uygulamayı kendine göre değil API'ye göre sürümle. Bir uç noktanın şekli değiştiğinde kısıt, birinin cebindeki **en eski** uygulama ve ana ekranındaki **en eski widget**'tır — ve o uygulamanın kuyruğunda eski şekilde bekleyen yazmalar olabilir.

---

## Verilen kararlar

| Konu | Karar |
|---|---|
| Framework | React Native (Expo) + TanStack Query + NativeWind |
| Push | Firebase Cloud Messaging |
| Satın alma | Doğrudan StoreKit 2 / Play Billing; doğrulama sunucuda |
| Widget verisi (varsa) | Yalnız yerel önbellek; widget kodunda ağ yok; önceden kurulmuş zaman çizelgesi |
| Senkron | Periyodik yenileme (ön plan + açık ekran); WebSocket yok |
| Gerçek cihaz testi | Her sprint demosunda iki telefonla |
| Platformlar | iOS + Android telefon |
| Arayüz dilleri | TR + EN (tasarım TR; EN metinleri UX'ten) |
| Tablet | Tasarımda yok — **Açık karar** (listede yok); karar gelene kadar telefon düzeni |
| Dark mode | **Açık karar (A-9)** |
| Push izni zamanı | İlk günün kombininden sonra, kendi açıklama ekranımızla (öneri) |
| Giriş | Apple / Google / e-posta + şifre (02); telefon/OTP yok |
| Fotoğraf yükleme | Presigned S3 PUT + kalıcı çevrimdışı yükleme kuyruğu; AI taslağı kullanıcı onayıyla kaydedilir |
| AI işleri | 202 + polling (`useJob`); her worker için kill switch |
| Marka ödemesi | Uygulama içi tarayıcı / deep link; Droblet'te ödeme yok |
| Abonelik bitişi | Veri kalır; ücretsiz sınırlara dönülür (sınırlar **A-1**) |
| Genç (13–18) | **Açık karar (A-5)** |
| Widget | MVP'de yok |
