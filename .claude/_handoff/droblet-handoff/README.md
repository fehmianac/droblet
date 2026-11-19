# Droblet — Tasarım handoff özeti

**Kaynak tasarım:** https://claude.ai/artifact/UUAJnqCfrvDkh3yPPvnqw1 — "Droblet — Uygulama UX/UI", 30 mobil ekran + tasarım sistemi (2026-11-18).
**Ekran metinleri:** [SCREENS.md](SCREENS.md) — her ekranın metni, tasarımdaki sırayla.

Bu dosya tasarımdan **ürünü** çıkarır. **Teknik yığın ekibin yığınıdır** (.NET 10 Lambda + DynamoDB tek tablo + SQS + SAM; React Native/Expo + TanStack Query). Tasarım mimari önermez; teknik kararların hepsi [TEAM_LEAD.md](../../team/TEAM_LEAD.md)'deki gibi geçerlidir. Aşağıdaki adlar (Lambda, entity, epic) rol rehberlerinde ortak kullanılır.

---

## 1. Ürün

**Droblet**, kişisel gardırobu dijitalleştiren, AI ile her gün ve her seyahat için kombin öneren mobil stil asistanıdır. Kullanıcı kıyafetlerini fotoğraflar; Droblet parçaları tanır, kombin ve bavul hazırlar, kombinleri ve mağaza ürünlerini **kullanıcının kendi fotoğrafı üzerinde** gösterir.

- **Vaat (hoş geldin ekranı):** "Sabah 'ne giysem' derdi ve saatler süren bavul hazırlığı bitti. Dolabın artık senin için düşünüyor."
- **Paywall sloganı:** "Her sabah hazır bir kombin. Her seyahatte hazır bir bavul."
- **Ton:** "Sakin, editoryal, kişisel." Sen dili, kısa cümleler.
- **Pazar:** Türkiye (₺, TR markalar: Marks & Spencer, Vakko, Beymen Club, Communité, Gap). Uygulama dili TR + EN.
- **Hedef segment (onboarding):** Kadın · Erkek · Genç (13–18).

## 2. Gezinme — 5 sekme

| Sekme | İçerik | Ekranlar |
|---|---|---|
| **Bugün** | Günün kombini (hava + takvim ortamı), haftalık plan, haftanın edit'i, takvim | 06–09 |
| **Gardırop** | Alt sekmeler: Parçalar / Looklar / Bavullar | 10–15, 18–19 |
| **Stilist** (orta) | Ortam + hava → kombin öner, bavul hazırla, haftamı planla, look oluştur, renk paletim | 16–17, 30 |
| **Keşfet** | Edit (editör), Mağaza, Influencer, Arkadaşlar, Dizi outfitleri | 20–27 |
| **Profil** | İstatistik, renk paleti, üyelik, gizlilik, ayarlar | 28–30 |

## 3. Özellikler (ekran → yetenek)

| # | Ekran | Yetenek | Teknik karşılık |
|---|---|---|---|
| 01–02 | Hoş geldin, Kayıt | Apple / Google / e-posta ile hesap | Auth (Api) |
| 03 | Stil profili (1/3) | Kimin için (Kadın/Erkek/Genç), 3 stil etiketi, bütçe (High street / Karma / Lüks dokunuş) | `StyleProfile` |
| 04 | Beden ve fotoğraf | Boy, kilo, beden; **boy fotoğrafı** (üzerimde gör için), **yüz fotoğrafı** (renk paleti). Atlanabilir | Özel S3 nesneleri, `BodyProfile` |
| 05 | Üyelik | Aylık / yıllık abonelik, ücretsiz deneme, geri yükle | StoreKit 2 / Play Billing doğrudan |
| 06 | Bugün | Tarih, sezon, **hava (14° İstanbul)**, günün ortamı, "Senin üzerinde" günün kombini, "Bunu giyiyorum" | Hava servisi, `WearLog` |
| 07 | Haftalık plan | 7 gün × ortam; "Haftamı planla", gün için "Öner" | Stylist worker |
| 08 | Haftanın edit'i | Editör seçimi haftalık look'lar; ürün satırları, toplam fiyat, "Look'u satın al" | Global içerik (`Edit`) + katalog |
| 09 | Takvim | Ne giyeceğim / ne giydim; ay özeti, en çok giyilen, rapor | `WearLog`, `PlanDay` |
| 10–11 | Gardırop, Parça detayı | 86 parça; kategori/sezon/renk filtresi; beden, renk, kumaş, giyilme sayısı, ilgili look'lar | `Item` |
| 12–13 | Parça ekle, Toplu ekle | Kamera ile çek → **AI algılar (tür, renk, kumaş)**; toplu: **arka plan temizleme, kadraj, alan doldurma**; kaydetmeden önce kullanıcı onayı | ItemProcessor worker |
| 14–15 | Looklar, Look oluştur | Lookbook, favoriler, ortam filtresi, puan (4.6); 5 slot (üst, alt, dış giyim, ayakkabı, çanta/aksesuar), gardıroptan ya da mağazadan | `Look` |
| 16–17 | Stilist, Kombin önerisi | Ortam + hava + "sadece gardırobum" → 3 öneri, açıklama, eksik parça önerisi (mağaza), "Takvime ekle" | Stylist worker |
| 18–19 | Bavullar, Bavul detayı | Şehir, tarih, seyahat tipi, sadece kabin → bavul listesi (9 parça, 5 look, her parça ≥2 kez), günlük look'lar, hazırlık işaretleme, şehir hava tahmini | Stylist worker + hava |
| 20 | Keşfet | Editör / Mağaza / Influencer / Arkadaşlar / Dizi outfitleri | Global içerik |
| 21–24 | Mağaza, Ürün, Kombin oluşturucu, Sepet | Katalog arama/filtre; "Parçamı tamamla"; ürünü **üzerimde gör**; "gardırobundaki 7 parçayla uyumlu"; sepet markaya göre gruplanır; **ödeme markanın kendi mağazasında** | Katalog (global), `Cart`, try-on |
| 25–27 | Arkadaş akışı, Kişi profili, Dolapları keşfet | Takip, arkadaşların look'larını puanlama (4,7 ort.), stil uyumu %, dolabını keşfet, rehberden bul, davet linki, influencer dolapları | `Follow`, `Rating`, görünürlük |
| 28–29 | Profil, Gizlilik ve ayarlar | Dolap görünürlüğü (Herkese açık / Yalnızca takipçiler / Gizli); fotoğrafları ve üretilen görselleri sil; bildirimler; hesabı sil | Silme akışı |
| 30 | Renk paleti | Yüz fotoğrafından sezon tipi (Sıcak Sonbahar), yakışan/kaçınılacak tonlar, gardırop uyumu %64, paletime uygun ürünler | Palette worker |

## 4. Teknik eşleme (ekibin yığınında)

**Tenant:** kullanıcı = tenant (tek kişi, rol yok). Sosyal özellikler başka tenant'ın verisini **yalnızca görünürlük kuralıyla** okur (Herkese açık / Yalnızca takipçiler / Gizli); okuma tek bir `VisibilityPolicy`'den geçer.

**Lambda'lar**
| Lambda | Görev |
|---|---|
| `Api` | Auth, profil, gardırop, look, plan/takvim, bavul, sosyal, katalog, sepet, yetki, iş başlatma + durum |
| `ItemProcessor` (SQS `item-process-request`) | Parça fotoğrafı → arka plan temizleme, kadraj, tür/renk/kumaş/sezon önerisi (taslak; kullanıcı onaylar) |
| `Stylist` (SQS `stylist-request`) | Günlük kombin, haftalık plan, bavul listesi + günlük look'lar, eksik parça önerisi |
| `TryOn` (SQS `tryon-request`) | "Üzerimde gör": parça/look/ürünü kullanıcının boy fotoğrafında görselleştirir |
| `Palette` (SQS `palette-request`) | Yüz fotoğrafından sezon tipi ve palet; gardırop uyum oranı |
| `Notifier` (EventBridge) | Sabah kombin hatırlatması, haftanın edit'i, arkadaş puanları |

**Global veri:** haftanın edit'i, editör/influencer içerikleri, dizi outfitleri, mağaza kataloğu (marka, ürün, fiyat, beden, satış linki).
**Tenant verisi:** profil, stil/beden profili, fotoğraflar (özel S3), parçalar, look'lar, plan günleri, giyim kaydı, bavullar, sepet, takip, puanlar, palet sonucu, üretilen görseller.

**Epic'ler (rehberlerde ortak numaralar):** E1 Hesap ve onboarding (01–04) · E2 Gardırop ve parça ekleme (10–13) · E3 Look'lar (14–15) · E4 Bugün, haftalık plan, takvim (06–09) · E5 Stilist ve bavul (16–19) · E6 Üzerimde gör / try-on · E7 Renk paleti (30) · E8 Keşfet, edit ve mağaza (08, 20–24) · E9 Sosyal (25–27) · E10 Üyelik (05) · E11 Profil, gizlilik, silme (28–29) · E12 Lansman (web, mağaza, yasal).

## 5. Gizlilik vaatleri (ekranda yazılı — bozulamaz)

1. "Fotoğrafların ve senin üzerinde üretilen görseller yalnızca sana açıktır." — boy/yüz fotoğrafları ve try-on çıktıları hiçbir görünürlük ayarında başkasına gösterilmez, hiçbir zaman global önbelleğe girmez.
2. "İstediğin an Profil › Gizlilik'ten silebilirsin." — fotoğraf + üretilen görsel silme, hesap silmeden bağımsız çalışır.
3. Dolap görünürlüğü kullanıcı seçimidir; varsayılanı **Açık karar**.
4. Ödeme Droblet'te alınmaz; marka sitesine yönlendirilir.

## 6. Üyelik (paywall'da yazılı)

Droblet Üyelik — aylık ve yıllık, ücretsiz deneme. Fiyatlar tasarımda `[AYLIK FİYAT]`, `[YILLIK FİYAT]`.
Üyelikle gelenler: **sınırsız "üzerimde gör"**, **kişisel stil danışmanı** (günlük kombin), **akıllı bavul**, **renk paleti analizi**.
Ücretsiz pakette ne kaldığı (ör. aylık N try-on, gardırop limiti) tasarımda yok → **Açık karar**.

## 7. Tasarım sistemi

Renk token'ları: Mürekkep `#1C1A17` · Krem zemin `#F4F1EC` · Kâğıt `#FBF9F5` · Espresso vurgu `#6E5640` · İkincil metin `#665F56` · Çizgi `#DCD4C9` · Kum `#E8E1D7` · Uyarı `#9A3B2E`.
Tipografi: Cormorant Garamond (display 500 36/38, başlık-2 500 26, başlık-3 600 20) · Jost (gövde 400 14/21, üst etiket 500 11, harf aralığı %14).
Ölçüler: kenar 20 · ızgara 4/8 · kart köşesi 20 · görsel köşesi 12–14 · buton 52 (ikincil 44) · dokunma ≥44.
Bileşenler: birincil/ikincil buton, seçili, çip, rozet, alan, marka, ürün satırı.
Kural: büyük harf CSS/Tailwind ile verilmez; metin kaynağa istenen harfle yazılır.
Tasarımda dark mode yok → **Açık karar**.

## 8. Tasarımda açık kalanlar (ürün sahibi kararı)

| # | Konu |
|---|---|
| A-1 | Fiyatlar, deneme süresi, ücretsiz paket sınırları |
| A-2 | Mağaza kataloğunun kaynağı (marka feed'i / affiliate ağı / elle) ve gelir modeli (affiliate komisyonu?) |
| A-3 | Try-on ve görsel işleme AI sağlayıcıları; görsel başı maliyet |
| A-4 | Hava durumu sağlayıcısı; konum izni mi şehir seçimi mi |
| A-5 | Genç (13–18) segmenti: yaş doğrulama, veli onayı, sosyal ve fotoğraf özelliklerinin gençlerde kısıtlanması |
| A-6 | Dolap görünürlüğünün varsayılanı; profil/look'ların web'de paylaşılabilir linki |
| A-7 | Influencer/editör içeriğinin kaynağı ve hakları; "Dizi outfitleri" için lisans |
| A-8 | Rehberden arkadaş bulma: kişi listesi sunucuya gidecek mi (hash'li eşleşme) |
| A-9 | Dark mode |
| A-10 | Bundle id / package, scheme, alan adı |
| A-11 | North Star önerisinin onayı (PRODUCT_MANAGER.md) |
| A-12 | MVP kapsam önerisinin onayı (PRODUCT_MANAGER.md / BACKLOG.md) |
| A-13 | Sabah kombin hatırlatmasının varsayılan saati |

---

## 9. Brief ile kapanan kararlar (2026-11-18)

Kaynak: [BRIEF.md](BRIEF.md). Bu bölüm, rol rehberlerinde "Açık karar" yazan maddelerden **üstündür**; rehberle çelişirse burası geçerlidir.

### 9.1 Ürün kararları (brief'ten)

| Konu | Karar | Kapanan |
|---|---|---|
| Faz 1 segmenti | **Yalnız Kadın.** Erkek ve Genç (13–18) çipleri "Yakında" rozetiyle devre dışı. Genç = faz 1b, ebeveyn hesabı zorunlu | A-5 (faz 1 için) |
| Üyelik fiyatı | Kadın **$4,99/ay**, Erkek ve aile $3,99/ay (faz 1b). TL fiyat **mağaza fiyat kademesinden okunur**, ekranda sabit yazılmaz. Yıllık fiyat ve deneme süresi hâlâ açık | A-1 (kısmen) |
| AI kredisi | Üyelik **ayda 30 AI görseli** ("üzerimde gör" = 1 kredi). Metin danışmanı krediden düşmez. Aylık yenilenir, devretmez. Fazlası **ek kredi paketi** (tüketilebilir IAP). Sayaç **sunucuda**. Kredi bitince paywall değil, ek kredi alt sayfası. Aynı kombinin görseli önbellekten gelir, ikinci kez kredi düşmez. Paywall'daki "Sınırsız" metni "ayda 30 AI görseli" olarak düzeltilir | A-1 (kredi) |
| Üye olmayan | AI özelliğine dokununca paywall. Gardırop, look, takvim, mağaza, sosyal ücretsiz | A-1 (kapsam) |
| Gelir | Üyelik + **affiliate komisyonu** (%7–12). Her tıklama `click_id` taşır; dönüşüm postback ile gelir, kullanıcı + look ile eşleşir. "Look'u tamamla", izleme listesi | A-2 (gelir modeli) |
| Katalog | Ürün ve haftanın edit'i **admin panelinden** yönetilir (mobil uygulamada admin yok). Feed mi elle mi, affiliate ağı mı doğrudan mı hâlâ açık | A-2 (kısmen) |
| AI görsel | **Gemini 2.5 Flash Image**, ≈ $0,039/görsel; çağrı yalnız sunucudan. AI metin: yapılandırılmış JSON | A-3 (try-on) |
| Hava | Konum izni varsa konum, yoksa profildeki şehir. Günlük + 7 günlük tahmin. Sağlayıcı açık | A-4 (kısmen) |
| Paylaşım | WhatsApp, Pinterest, link; her link davet kodu taşır; deferred deep link. Paylaşım kazancı faz 2 | A-6 (kısmen) |
| Influencer | Gardropgurusu, Pelin Çutakyan **hedef liste, anlaşma yok** — gerçek isim yayında kullanılmaz | A-7 |
| Karanlık mod | Faz 1'de yok; token'lar sonradan eklemeye uygun | A-9 |
| Hukuk | Droblet Ltd (Londra), pazar Türkiye: **KVKK + UK GDPR** | — |
| Faz 2+ | İkinci el (Tem 2027), kiralama (Oca 2028), kozmetik (Oca 2029): faz 1'de yok ama veri modeli `Item.listingStatus` ve gezinme yer bırakır | — |

### 9.2 Teknik yığınla çelişen brief maddeleri — ürün sahibi kararı: **yığın korunur**

| Brief | Uygulanan | Neden |
|---|---|---|
| Supabase (DB, Auth, Storage, Edge Function) korunur | **.NET 10 Lambda + DynamoDB + SQS + SAM**; fotoğraflar özel S3 + imzalı URL | Ürün sahibi 2026-11-18'de AWS yığınını seçti. Prototip verisi gerekirse tek seferlik taşınır |
| İstemci teknolojisi açık | **React Native (Expo) + TanStack Query** | Rehber kararı |
| RevenueCat | **StoreKit 2 / Play Billing doğrudan** + App Store Server Notifications v2 / RTDN ile sunucu doğrulama | Üçüncü taraf SDK yok kararı |
| PostHog / Amplitude / Firebase Analytics | Kendi analitiğimiz: mobil → Api → DynamoDB (TTL), rapor betiği | Aynı karar |
| Expo Push / OneSignal | FCM (iOS'ta APNs, FCM üzerinden) | Rehber kararı |
| `/admin/*` web paneli (Lovable) | Admin uçları `Api` içinde ayrı yetkili grup (`/v1/admin/*`, `AdminJwt`); web panel ayrı iş (Frontend) | Mobil uygulamaya girmez |

### 9.3 Giriş yöntemi

Brief ve 02 ekranı **e-posta + şifre** (en az 8 karakter), "Şifremi unuttum" ve deep link'li sıfırlama istiyor; Apple ve Google ile giriş. Rehberlerdeki "telefon/e-posta OTP" şablonu yerine bu uygulanır: şifre sunucuda **PBKDF2/Argon2 karması** olarak saklanır, sıfırlama tek kullanımlık, kısa ömürlü token'la e-postayla (SES) gider. SMS kanalı yok. JWT + refresh kuralları aynen geçerli.

### 9.4 Ürün sahibi kararları (2026-11-18, brief sonrası)

| Konu | Karar | Kapanan |
|---|---|---|
| Fiyat ve deneme süresi | **Mağazadan gelir** (StoreKit / Play ürün bilgisi); sunucu ve istemci fiyat saklamaz. Mağaza ürünleri açılana kadar **temsili**: aylık ₺199,99, yıllık ₺1.499,99, 7 gün deneme | A-1 |
| Ek kredi paketi | **Temsili:** 20 AI görseli = ₺79,99 (tüketilebilir). Paket → kredi eşlemesi config'te | A-1 |
| Ürün kimlikleri (temsili) | `com.alatech.droplet.premium.monthly` · `com.alatech.droplet.premium.yearly` · `com.alatech.droplet.credits.20` | A-10 |
| Affiliate | **İkisi birden:** affiliate ağı **ve** markalarla doğrudan anlaşma. Tıklama/dönüşüm kaydı `source` (Network / Direct) taşır; komisyon oranı marka bazında config'te; dönüşüm iki kaynaktan da postback ile gelir | A-2 (gelir altyapısı) |
| AI metin (stilist, etiketleme) | **GPT-6 Astra** | A-3 |
| AI görsel (üzerimde gör) | **GPT Image 2.5 Sunburst** (brief'teki Gemini 2.5 Flash Image yerine). Model kimlikleri SSM'de (`Ai:TextModel`, `Ai:ImageModel`); görsel başı maliyet spike'ta ölçülür, 30 kredi sınırı aynen geçerli | A-3 |
| Alan adı | `droblet.alatech.co` (API: `api.droblet.alatech.co`, şifre sıfırlama ve davet linkleri, universal/app links, SendGrid gönderici alanı) | A-10 |
| Bundle id / package | `com.alatech.droplet` (iOS ve Android) | A-10 |
| URL scheme | `droplet` (öneri, alan adı ve bundle id ile tutarlı) | A-10 |
| Bölge ve deploy | AWS **eu-central-1**; GitHub Actions + AWS access key secret'ları (`deploy-infra.yml`, `deploy-lambdas.yml`) | — |
| E-posta | **SendGrid** (SES yerine); SDK'sız HTTPS, API anahtarı `SENDGRID_API_KEY` secret'ından SSM'e. Rehberlerde kalan "SES" ifadeleri bu kararla geçersizdir | — |

> **Dikkat — yazım farkı:** Ürün adı tasarımda ve brief'te **Droblet**; alan adı ve bundle id **droplet**. Bundle id mağaza kaydından sonra değiştirilemez. Bu fark bilinçliyse sorun yok; değilse mağaza kaydından önce düzeltilmeli.

### 9.5 Hâlâ açık

Katalog güncelleme yöntemi (admin elle mi, marka feed'i mi) · hava durumu sağlayıcısı · arka plan temizleme çözümü · dolap görünürlüğü varsayılanı (A-6) · rehberden arkadaş bulma (A-8) · gerçek TL fiyat kademeleri ve deneme süresi (mağaza ürünleri açılınca).

---

## 10. Tasarımda eksik olanlar — ekran ekran (spec)

Tasarım tuvali başka hesapta; eksikler **burada spec olarak** tutulur ve kodda mevcut tasarım sistemiyle uygulanır. Tuval güncellenince bu liste kapanır. "Sunum" = brief'te "Sunumdan eklenecek" işaretli.

**Tüm liste ekranları:** yükleniyor = iskelet kutular (spinner değil) · boş = tek cümle + tek eylem · hata = "Tekrar dene" · çevrimdışı = önbellek + üst bant. Bu dört durum tuvalde yok; hepsi eklenecek.

| Ekran | Eksik (tuvalde yok, brief istiyor) |
|---|---|
| 01 | Koşullar ve Gizlilik linkleri tıklanabilir; 2×2 kolaj + krem geçiş |
| 02 | Giriş sekmesinde ad gizli + "Şifremi unuttum"; alan altı hata mesajı (danger); şifre sıfırlama ekranı (e-posta gir → gönderildi; yeni şifre) |
| 03 | Erkek ve Genç çipleri devre dışı + "Yakında" rozeti; tam 3 etiket sınırı (4.'sü seçilemez, sayaç) |
| 04 | 1–3 boy fotoğrafı; izin reddi açıklaması + Ayarlar'a git; kilo opsiyonel |
| 04b | **Yeni adım — "İlk 5 parça":** "Gardırobunda bunlardan hangileri var?" hazır kütüphane ızgarası + kamera kısayolu |
| 05 | "Sınırsız" → "Ayda 30 AI görseli"; fiyatlar mağazadan; kapat (×) her zaman görünür; Koşullar + Gizlilik linkleri |
| 05b | **Yeni — Ek kredi paketi alt sayfası** (kredi bitince) |
| 06 | Yenile ikonu, kalp; plan yok durumu ("Bugün için plan yok" + "Stilistten öneri al"); **Sunum:** "Eksik parça" işareti + "Look'u tamamla" |
| 07 | Gün satırı üç nokta menü (değiştir, kaldır); "Üzerimde gör" öncesi kredi onayı ("7 kredi harcanacak") |
| 08 | Fiyat bandı seçici (High street / Lüks dokunuş); nokta göstergesi; **Sunum:** gardıropta olan parçalar gizli, sadece eksikler; "İzleme listeme ekle"; fotoğraf yoksa "Profil fotoğrafını tamamla" kartı |
| 09 | Güne dokununca look veya öneri alt sayfası |
| 10 | Çipler: + Çanta, Aksesuar, Plaj giyim, Kayak giyim; filtre alt sayfası (sezon, renk, marka, sıralama); arama; uzun basma çoklu seçim; boş durum ("İlk parçanı ekle" + "Hazır kütüphaneden seç") |
| 11 | Düzenle formu; üç nokta (sil, sezonu değiştir); çanta ikonu → tamamlayan ürünler; faz 2 "Sat / Kiraya ver" için yer |
| 12 | Galeri, hazır kütüphane, toplu kısayolları; çekim sonrası form (ad, kategori, marka, beden, renk, kumaş, sezon ≥1); "Orijinale dön" |
| 12b | **Yeni — Hazır ürün kütüphanesi** seçim ekranı |
| 13 | En fazla 30; arka planda devam + bitince bildirim; "Kombin fotoğrafından parçaları ayır" seçeneği |
| 15 | En az 2 parça kuralı (Kaydet devre dışı); slot seçim alt sayfası (Gardırop / Mağaza) |
| 16 | Serbest metin alanı ("Örn. akşam iş yemeği, yağmurlu") |
| 17 | Beğenmedim (×) + geri bildirim; kredi bitti durumu (parça kolajı + "Kredi yükle"); AI görseli üretiliyor durumu (iskelet + ilerleme metni) |
| 18 | Şehir otomatik tamamlama; tarih seçici |
| 19 | Günlük hava tahmini; hazırlık halkası; işaretli satır üstü çizili; **Sunum:** eksik parça tespiti + "Eksikleri tamamla"; tek kabin bavulu modu |
| 20 | "Sponsorlu" etiketi (faz 3 için bileşen hazır); sepet ikonu + rozet |
| 21 | Sepet ikonu + rozet; filtre alt sayfaları; sonsuz kaydırma; "Parçamı tamamla" akışı (gardıroptan parça seç → ürünler) |
| 22 | Beden profilden seçili; **Sunum:** "İzleme listeme ekle" (fiyat düşünce bildirim, kalpten ayrı) |
| 23 | Boş slot için Mağaza / Gardırobum önerileri; "N ürünü satın al" |
| 24 | Bilgi notu metni; boş durum ("Sepetin boş" + "Ürünleri keşfet"); "[Marka]'da öde" → uygulama içi tarayıcı (affiliate) |
| 24b | **Yeni — İzleme listem** ekranı (Profil menüsünden) |
| 25 | Hikaye halkaları (yeni = accent); 1–5 yıldız; kaydet; paylaş (WhatsApp, Pinterest, link) |
| 26 | Üç nokta: **şikayet et, engelle** (mağaza kuralı); gizli dolap durumu |
| 27 | Rehber izni akışı; influencer kartları yer tutucu isimle |
| 28 | **Sunum:** AI kredi sayacı ("Bu ay 30 görselden 12'si kaldı") + "Kredi yükle"; menüye İzleme listem; aile planı faz 1b |
| 29 | Fotoğraf ekle/kaldır listesi; silme onay penceresi (geri alınamaz); dil seçimi (TR / EN); hesap silme onayı |
| 30 | Yüz fotoğrafı yok boş durumu |

### 10.1 Tipografi notu

Brief'te üst etiket ve marka adı **büyük harf**. Proje kuralı gereği büyük harf CSS/`textTransform` ile **verilmez**; çeviri dosyasına büyük harfle yazılır (TR'de `i → İ`; ör. "HAFTALIK STİL"). Dinamik metinler (marka adı API'den) sunucuda/istemcide `toLocaleUpperCase('tr-TR')` ile bir kez çevrilip öyle gösterilir. Başlıklar Dynamic Type ile %130'a kadar büyür. Fontlar gömülü (latin-ext). Alt menü 86 (güvenli alan dahil), orta Stilist butonu 56 çap, 18 yukarı taşar. Çip 36, ikon buton 44×44, alt sayfa köşesi 28. İkonlar Lucide, 1,5 çizgi; emoji yok.

---

## 11. Tuval v2 (2026-11-18) — güncel tasarım kaynağı

Ürün sahibinin hesabındaki yeni tuval: https://claude.ai/artifact/PJtvF68fe3N9XvEP8D4pgo ("Droblet — Uygulama UX/UI v2"). §10'daki eksikler bu tuvalde çizildi; **kod için güncel kaynak budur**. Board kaynakları: [`canvas-v2/`](canvas-v2/) (`canvas.json` + her board için `.dc.html`).

Eklenenler: logo (öneri: **A — iç boşluğu askı kancası olan damla**; `Logo`, `LogoIkon`, `LogoKullanim`), animasyonlu splash (`Splash`, `SplashKareler`; toplam 2,6 sn, `cubic-bezier(0.2,0.8,0.2,1)`), yeni ekranlar (02b–d şifre sıfırlama, 04b İlk 5 parça, 05b ek kredi, 07b kredi onayı, 12b hazır kütüphane, 12c parça bilgisi, 17b kredi bitti, 17c görsel üretiliyor, 24b izleme listem, 26b şikayet/engelle, 29b–c silme onayları), durum board'ları (`Durum*`, `BugunPlanYok`, `EditFotoYok`, `SepetBos`, `KisiGizli`, `PaletBos`), web landing (`Landing`, `LandingMobil`) ve AI bekleme dili (`AiYukleniyor`, `AiYukleniyorStilist`, `AiYukleniyorVaryantlar`: çark yok; parlama 1,8 sn, siluet çizimi 3,2 sn, parçalar 300 ms arayla, metinler 2 sn'de bir geçiş; hareket azaltmada durağan hal). Hata hali: "Şu an oluşturamadık. Kredin iade edildi." + "Tekrar dene".

Dev ortamı (2026-11-18): `https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com` (stack `droblet-dev`, eu-central-1).

---

## 12. Çok dillilik (ürün sahibi kararı, 2026-11-18)

Uygulama **çok dilli**; ilk diller **Türkçe ve İngilizce**, sonrası veriyle eklenebilir olmalı.

| Katman | Kural |
|---|---|
| Mobil | Tüm metinler `tr` ve `en` çeviri dosyalarında (erişilebilirlik etiketleri dahil). Tarih, sayı, para, çoğul yerel ayara göre tek yardımcıdan. İlk açılışta cihaz dili destekleniyorsa o, yoksa TR. Dil değişimi anında uygulanır, cihazda saklanır ve profile yazılır. Yeni dil = yeni çeviri dosyası + tek kayıt. `tr`/`en` anahtar eşitliği testle korunur |
| API | Sabit metin dönmez; kod/enum döner, istemci çevirir. İstemci `Accept-Language` gönderir. Dil sırası: profil `language` → `Accept-Language` → `tr` |
| İçerik (katalog, edit, kütüphane, renk/sezon adları) | Yerelleştirilmiş alanlar `{ "tr": "…", "en": "…" }` haritası; admin uçları haritayı alır; desteklenen diller config listesinde |
| AI metni | Kullanıcının dilinde üretilir; üretilen sonuçla birlikte dili saklanır |
| E-posta ve bildirim | Alıcının profil diline göre şablon |
| Web (landing, yasal sayfalar), mağaza sayfası | TR + EN — E12 kapsamında, henüz yazılmadı |
| Büyük harf etiketler | Dil başına çeviri dosyasında büyük harfle yazılır (TR'de İ) |

---

## 13. Ürün sahibi kararları — geliştirme turu (2026-11-19)

| # | Konu | Karar |
|---|---|---|
| 1 | Admin panel adresi | `droblet-admin.alatech.co` (Cloudflare arkasında statik site) |
| 2 | Admin hesapları | Uygulama hesaplarından **ayrı** admin kullanıcıları, roller: süper admin · içerik editörü · moderatör; admin kullanıcıları panelden yönetilir |
| 3 | Admin girişi | E-posta + şifre, ardından **e-postaya 6 haneli kod** (SendGrid) |
| 4 | Panel kapsamı (ilk sürüm) | Katalog ve içerik (markalar, ürünler + CSV, haftanın edit'i, koleksiyonlar, hazır kütüphane) · kullanıcılar ve moderasyon · raporlar (gelir, huni, özet) · uygulama ayarları (Parameter Store) ve admin kullanıcı yönetimi. Tasarım: Metronic benzeri düzen (koyu yan menü, kartlar, filtreli tablolar); Metronic kodu/asset'i kullanılmaz |
| 5 | Panel dili | TR + EN |
| 6 | Hava durumu | Şimdilik Open-Meteo ücretsiz; lansmandan önce yeniden karar |
| 7 | Dolap gizliliği varsayılanı | **Yalnızca takipçiler** (profil kartı aramada görünür) |
| 8 | Takip | "Yalnızca takipçiler" / gizli hesaplarda **onaylı takip isteği**; herkese açık hesaplarda anında |
| 9 | Varsayılan açık bildirimler | Sabah kombin hatırlatması, haftanın edit'i. Arkadaş puanları ve fiyat düşüşü varsayılan kapalı |
| 10 | İzleme listesi | Markaya gidilip **48 saat** içinde dönüşüm gelmezse ürün kendiliğinden izleme listesine düşer |
| 11 | Ücretsiz parça tanıma | **10** fotoğraf (toplam), sonra paywall; elle giriş her zaman açık |
| 12 | Arka plan temizleme | GPT Image ile |
| 13 | Rehberden arkadaş bulma | **Faz 1'de var**: açık rıza ekranı + karma (hash) eşleştirme, rehber verisi saklanmaz |
| 14 | Katalog girişi | Admin panelden elle + CSV; feed sonra |
| 15 | Affiliate postback | **Admitad**, **Gelir Ortakları (ReklamAction)** ve doğrudan marka anlaşmaları |
| 16 | Hazır kütüphane görselleri | AI (GPT Image) ile üretilir |
| 17 | Lovable/Supabase taşıma | Yalnız **katalog ve görseller** (kullanıcılar taşınmaz); Supabase erişimi ürün sahibinden |
| 18 | Yasal metinler | Claude kapsamlı taslak yazar → ürün sahibi son bakış → hukuk onayı |
| 19 | Prod / API adresi | Şimdilik API Gateway adresi; özel alan adı yok |
| 20 | OpenAI modelleri | `gpt-6-astra` (metin), `gpt-image-2.5-sunburst` (görsel) — teyitli |
| 21 | Ürün sahibi kurulumları (tamam) | Apple profili + App Store Connect kaydı, Cloudflare proxy + SSL, SendGrid. **Bekleyen:** Google OAuth client id'leri, Firebase servis hesabı, Android imza anahtarı + Play kaydı, Supabase erişimi |

## 14. Bekleme listesi — prod'a çıkarken veya ürün sahibi çağırdığında (2026-11-19)

Ürün sahibi kararı: aşağıdakiler şimdilik **bekliyor**; prod hazırlığına başlanırken ya da ürün sahibi istediğinde **tek tek** (her seferinde bir soru) ele alınır.

| # | Konu | Gerekçe / not |
|---|---|---|
| 1 | Destek e-posta adresi + `/support` sayfası | App Store ve Play zorunlu; `NEXT_PUBLIC_CONTACT_EMAIL` ve yasal metinlerdeki `[CONTACT E-MAIL]` |
| 2 | Cloudflare `droblet-admin` CNAME | Admin paneli alan adından açılmıyor (wildcard 192.168.1.1'e çözüyor) |
| 3 | SSM `api/Email` gönderici adresi | "droplet" → "droblet" |
| 4 | App Store Connect IAP ürünleri + anahtar | Ödeme entegrasyonu; o zamana kadar geçici self-premium (prod'da kapalı) |
| 5 | APNs, Firebase, Google client ID'leri, Sign in with Apple anahtarı | Bildirim ve sosyal giriş |
| 6 | Android keystore + Play hesabı | Android sürümü |
| 7 | Yasal metinlerdeki 17 madde | Unvan, adres, VERBİS vb.; yasal sayfalar "taslak" etiketli; hukukçu onayı |
| 8 | Open-Meteo ücretli plan | Ticari kullanım |
| 9 | SnapStart / provisioned concurrency | API soğuk başlangıç ~3 sn → ~0,5 sn; ~3–4 $/ay/fonksiyon (PC: ~9 $/ay); deploy-lambdas alias'a geçmeli, prod'u etkiler |
| 10 | AI hız/kalite ayarları | `Ai:ReasoningEffort:*`, `Ai:FastTextModel`, `Ai:Image:TryOnPreview`; kalite karşılaştırması sonrası öneri |
| 11 | Uygulama adı "Droblet" mağazalarda boş mu | `docs/store-listing/` yedek adlar |
| 12 | İncelemede self-premium | Prod'da kapalı tutulması önerildi |
| 13 | Supabase erişimi | |
| 14 | Prod kurulumu | Altyapı + SSM + mağaza başvurusu; ürün sahibini bekler |

Benim tarafımda (bekleme listesi dışı, sıradaki işler): paywall'a abonelik koşulları linki; moderasyonda "içerik kaldırıldı"nın gerçekten kaldırması; palette ai-perf zaman aşımı incelemesi.
