# Security Engineer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview

İki soru senin:

1. **"Başkasının yazdığı neyi gönderiyoruz, ve bilinen bir açığı var mı?"** — bağımlılık güvenliği.
2. **"Bir kullanıcının verisi başkasına, ya da gereğinden uzun süre bize kalıyor mu — ve bir şey bedavaya ya da kötüye kullanılabiliyor mu?"** — kullanıcı izolasyonu, kişisel veri, yetki ve kötüye kullanım.

**Droblet** kullanıcının bedenini ve yüzünü fotoğraf olarak, bunlardan üretilen görselleri, gardırobunu ve sosyal ilişkilerini tutar. Güven, ekranda yazılı şu vaatlerin tutulmasına bağlıdır (tasarımdan **aynen**; bozulamaz):

1. 04 Beden ve fotoğraf: **"Fotoğrafların ve senin üzerinde üretilen görseller yalnızca sana açıktır. İstediğin an Profil › Gizlilik'ten silebilirsin."**
2. 29 Gizlilik ve ayarlar: **"Yüz ve stil fotoğrafların ile senin üzerinde üretilen tüm görseller yalnızca sana açıktır."** — buton: **"Fotoğraflarımı ve üretilen görselleri sil"**
3. 29: **"Dolabımı kimler görebilir? · Herkese açık · Yalnızca takipçiler · Gizli"** — varsayılan **Açık karar (A-6)**
4. 22 / 24: **"Ödeme ve teslimat Marks & Spencer'ın kendi mağazasında tamamlanır."** · **"Ödeme ve teslimat her markanın kendi mağazasında tamamlanır."** — Droblet ödeme/kart verisi almaz
5. 05 Paywall: **"İstediğin zaman iptal et"**, **"Satın alımları geri yükle"**
6. 01 Hoş geldin: **"Devam ederek Kullanım Koşulları ve Gizlilik Politikası'nı kabul edersin."** — metinlerin durumu **taslak, açık** (§KVKK)

Teknik karşılıkları (README §5): boy/yüz fotoğrafı ve try-on çıktısı **hiçbir görünürlük ayarında** başkasına gösterilmez ve **hiçbir zaman global önbelleğe girmez**; fotoğraf + üretilen görsel silme **hesap silmeden bağımsız** çalışır.

### Kişisel veri envanteri

| Veri | Ekran | Nerede | Kime gidiyor | Saklama | Not |
|---|---|---|---|---|---|
| E-posta, ad | 02 | DynamoDB (`UserEntity`, `AuthIdentityEntity`) | E-posta sağlayıcısı (SES) | Hesap silinene kadar | Log'a yalnız hash |
| Apple / Google kimliği | 02 | DynamoDB | — | Hesap silinene kadar | |
| Stil profili (segment Kadın/Erkek/Genç, 3 etiket, bütçe) | 03 | DynamoDB (`StyleProfile`) | AI sağlayıcısı (Stylist, anonim bağlam olarak) | Hesap silinene kadar | "Genç" seçimi = kullanıcının 13–18 olduğu bilgisi (A-5) |
| **Boy, kilo, beden** | 04 | DynamoDB (`BodyProfile`) | Beden: AI sağlayıcısı (gerekirse). **Boy/kilo gönderilmez** | Hesap silinene kadar | Kilo sağlık verisine yakın — **hukuk incelemesi** |
| **Boy (tam boy) fotoğrafı** | 04 | Özel S3 `tenant/{tenantId}/body/` | Yalnız TryOn sağlayıcısı (A-3) | Kullanıcı silene / hesap silinene kadar | Yalnız sahibine |
| **Yüz fotoğrafı** | 04, 30 | Özel S3 `tenant/{tenantId}/face/` | Yalnız Palette sağlayıcısı (A-3) | Kullanıcı silene / hesap silinene kadar | **Biyometrik veriye yakın — KVKK özel nitelikli veri kapsamı hukuk incelemesine** (aşağı) |
| **Üretilen görseller (try-on)** | 06–08, 15, 17, 19, 22 | Özel S3 `tenant/{tenantId}/tryon/` | — (sağlayıcıda kalan kopya: sağlayıcı politikası) | Kullanıcı silene / hesap silinene kadar | Yalnız sahibine; global önbellek yok |
| Palet sonucu (sezon tipi) | 30 | DynamoDB | — | Hesap silinene kadar (fotoğraf silinince: açık soru, aşağı) | Yüz fotoğrafından türetilmiş |
| Gardırop: parça fotoğrafı (ham) | 12–13 | Özel S3 `uploads/tmp/` → işlendikten sonra silinir | ItemProcessor sağlayıcısı | Geçici (lifecycle) | Ham fotoğrafta kişi, ev içi, konum (EXIF) olabilir |
| Gardırop: işlenmiş parça görseli + alanlar | 10–11 | Özel S3 `tenant/{tenantId}/items/`, DynamoDB `Item` | Görünürlüğe göre diğer kullanıcılar (`VisibilityPolicy`) | Hesap silinene kadar | Paylaşılabilir tek görsel türü |
| Look'lar, puanlar | 14–15, 25 | DynamoDB | Görünürlüğe göre | Hesap silinene kadar | |
| Plan, takvim, giyim kaydı (`PlanDay`, `WearLog`) | 06–09 | DynamoDB | — | Hesap silinene kadar | Görünürlükten bağımsız, yalnız sahibine |
| Bavullar (şehir, tarihler) | 18–19 | DynamoDB | Hava sağlayıcısı (yalnız şehir + tarih) | Hesap silinene kadar | Seyahat tarihleri = evde olmama bilgisi. Kişi profilinde "Seyahatler" sekmesi var → **görünürlüğe açılıp açılmayacağı ürün kararı; karar verilene kadar yalnız sahibine** |
| Sepet | 24 | DynamoDB | Marka sitesi (yönlendirme; A-2'ye göre affiliate parametresi) | Hesap silinene kadar | |
| Sosyal grafik (takip, takipçi) | 25–27 | DynamoDB | Diğer kullanıcılar (sayılar, listeler) | Hesap silinene kadar | |
| Rehber (A-8) | 27 | Karara bağlı: hash'li eşleşme ise yalnız hash | — | Karara bağlı | Telefon numarası hash'i kaba kuvvete açık — tuz/eşleşme tasarımı Security incelemesinden geçer |
| Konum (A-4) | 06 | Karara bağlı: şehir seçimi ise yalnız şehir | Hava sağlayıcısı | Karara bağlı | Hassas konum saklanmaz |
| Cihaz push token'ı | — | DynamoDB `DeviceEntity` | Firebase Cloud Messaging | Hesap silinene / token geçersiz olana kadar | |
| Satın alma kimlikleri | 05 | DynamoDB `PurchaseEntity` | Apple / Google | Hesap silinene kadar (+ kötüye kullanım hash'leri) | |

Üçüncü taraf kod gönderdiğimiz yüzeyler:

| Surface | Manifest | Reaches |
|---|---|---|
| Backend Lambdas | `Droblet.sln` → NuGet | AWS hesabımız, her kullanıcının verisi |
| Mobile app (+ varsa native extension'lar) | `mobile/package.json` → npm, native bağımlılıklar | Kullanıcının telefonu, mağazalar üzerinden |
| Landing | `landing/package.json` → npm | Web sayfalarını açan herkesin tarayıcısı |

Dördüncüsü kimseye gönderilmez ama kimlik bilgisiyle çalışır: **GitHub Actions**. Lambda'ları deploy eder ve mobil build'leri imzalar.

Beşincisi: **AI sağlayıcısı** (proje kullanıyorsa). Kullanıcı girdisini ve bağlamı ona gönderiyoruz. Onun veri saklama ve eğitimde kullanım politikası, bizim gizlilik metnimizin parçasıdır. Droblet'te bu sağlayıcı(lar)a **yüz ve tam boy fotoğrafı** gidiyor — en hassas yüzey budur (sağlayıcılar Açık karar A-3).

Altıncısı: **SMS sağlayıcısı** (telefon OTP). Telefon numaralarını ona gönderiyoruz ve gönderdiğimiz her mesajın parasını ödüyoruz. Droblet tasarımında telefon girişi yok (Apple / Google / e-posta) — telefon kanalı açılmazsa bu yüzey yoktur.

Droblet'e özgü diğerleri: **hava durumu sağlayıcısı** (A-4; şehir/konum gider), **katalog kaynağı** (A-2; marka feed'i / affiliate ağı — gelen veri ve görsel URL'leri güvenilmez girdidir), **marka siteleri** (sepetten yönlendirme; kişisel veri gönderilmez).

---

## Tek önemli triage sorusu

**Bu kod nerede çalışıyor?**

| Tier | Where it runs | Response |
|---|---|---|
| **1 — Shipped** | Telefon (uygulama ya da extension), landing tarayıcısı ya da bir Lambda | Hemen yamala |
| **2 — Build-time** | `@expo/*` CLI, `@babel/*`, Next.js build | Sonraki döngü |
| **3 — Test-only** | xUnit, Moq, `tests/` altı | Sonraki bağımlılık taraması |
| **4 — Dev-server** | "Development server" diyen advisory'ler | Yalnız dev server açıksa. Değil; localhost'ta |

> **Tuzak:** `npm audit` bağımlılık *ağacını* raporlar; ağacın çoğu build aracıdır. Bundle'a neyin girdiğini söyleyemez. Toplam sayıya göre karar vermek, ekibin bir sprintini build aracına harcarken telefona giden kodun açığını kaçırmasıdır.

---

## Commands

### Backend (.NET)

```bash
dotnet list Droblet.sln package --vulnerable --include-transitive
dotnet list Droblet.sln package --deprecated
dotnet list Droblet.sln package --outdated
```

`--include-transitive` isteğe bağlı değil.

### Mobile ve landing (npm)

```bash
cd mobile  && npm audit && npm outdated && npx expo-doctor
cd landing && npm audit && npm outdated
```

### Asla çalıştırma

```bash
npm audit fix --force        # ← hayır
```

Mobilde `--force`, tek bir transitive advisory için Expo'yu on sürüm geri düşürmeyi "düzeltme" olarak önerebilir. `npm audit fix` (force'suz) denenebilir — commit etmeden önce neyi değiştirdiğini oku.

---

## Recommended automation

### 1. Dependabot
`.github/dependabot.yml`: `nuget` (kök), `npm` (`/mobile`, `/landing`), `github-actions`. Haftalık, ekosisteme göre gruplu. Patch ve minor birlikte; major'lar ayrı PR. Native extension'ların bağımlılıkları eklendiğinde ekosistemleri de listeye girer.

### 2. Audit job
Yukarıdaki komutları zamanlanmış ve manifest'e dokunan PR'larda koşan bir workflow.
- **Raporlar, engellemez** — gece gelen bir transitive dev advisory'si build'i düşürürse insanlar onu zorla geçmeyi öğrenir.
- **Tier 1 istisna** — gönderilen kodda advisory kırmızı build'e değer.

### 3. Actions'ı SHA'ya sabitle
`actions/checkout@v4` hareketli bir tag. Onu kontrol eden, AWS anahtarlarımızı ve Play imzalama anahtarımızı tutan bir runner'ı kontrol eder.

Öncelik: Dependabot önce. **Projenin ilk sprintinde** kurulur — kod tabanı sıfırken kurmak en ucuz zaman.

---

## Cadence

| When | What |
|---|---|
| Her PR | Dependabot PR'ları diğerleri gibi incelenir, otomatik merge yok |
| Haftalık | Advisory'lere göz at. Tier 1 → ticket |
| Aylık | Üç manifest'te `--outdated` |
| Her mobil sürüm | `expo-doctor`; gizlilik etiketi / Data safety formu hâlâ doğru mu |
| AI ya da SMS sağlayıcısı değişince | Veri işleme politikasını yeniden oku (aşağı) |

---

## Ürünün kendi duruşu

Kod değiştikçe yeniden kontrol edilmeye değer özellikler — her biri, test setinin fark etmeyeceği bir ihlalden bir satır uzakta:

### Kullanıcı izolasyonu
- Her kullanıcı kapsamlı DynamoDB anahtarı `tenant#{tenantId}` taşır ve `tenantId` **yalnız** `IApiContext`'ten gelir. Gövdeden ya da sorgudan tenant id'si okuyan bir uç, kullanıcılar arası bir okumadır.
- `.../{id}` biçimindeki iş/kayıt kimlikleri tahmin edilse bile başka kullanıcının kaydına ulaşmamalı: anahtar her zaman aktif tenant'la kurulur.
- **Cihazda paylaşılan önbellek** (uygulama ile widget/extension arasında, proje gerektirirse) token içermez. Çıkışta önbellek temizlenir — başka hesapla giren kişi eski kullanıcının verisini görmez.

### Yetki (paket / abonelik — proje içeriyorsa)
- Ücretli yetki **yalnız sunucuda doğrulanmış** durumla verilir: istemci yalnız kimlik gönderir (Apple `transactionId`, Google `purchaseToken`); durum **App Store Server API** ve **Play Developer API**'den TLS ile okunur (bundle/paket ve ürün kimliği kontrol edilir). Mağaza sunucu bildirimlerinin içeriğine güvenilmez: uç `?key=` ortak gizli anahtarla korunur ve bildirim yalnız ilgili aboneliğin mağazadan yeniden okunmasını tetikler — sahte bir bildirim en fazla gereksiz bir sorguya yol açar. İstemcinin "satın aldım" demesi hiçbir şey değiştirmez.
- Paket JWT'de taşınmaz; her istekte kayıttan okunur. İstemcideki kilit yalnız görünümdür — **asıl kapı sunucudadır**.
- **Ters yön de bir ihlaldir:** kullanıcıya her pakette verilmiş bir hakkı kapatan değişiklik sözü bozar. Yetki politikası testi bunu korur.

Droblet:
- **Paketler:** Ücretsiz ve **Droblet Üyelik** (aylık / yıllık, ücretsiz deneme). Fiyat, deneme süresi ve ücretsiz paket sınırları **Açık karar (A-1)**.
- **Sunucuda kapılanan özellikler** (`EntitlementPolicy`, kota `UsageEntity` + SSM `Entitlements`): "üzerimde gör" (TryOn), kişisel stil danışmanı / günlük kombin (Stylist), akıllı bavul (Stylist), renk paleti analizi (Palette); ücretsiz paketin gardırop/parça tanıma sınırı varsa (A-1). Kapı **iş kuyruğa konmadan önce Api'de**; worker'lar yetki kararı vermez ama yetkisiz iş gelirse de çalıştırmaz.
- **"Sınırsız" try-on** vaadi kötüye kullanım üst sınırıyla (SSM `TryOn.Premium.DailyCap`) korunur; bu sınırın abonelik koşullarında nasıl yazılacağı **hukuk incelemesine** gider — ekranda "sınırsız" yazıp sessizce kesmek vaadi bozar.
- **Hiçbir pakette kapanmayan haklar:** kendi gardırobuna, look'larına, bavullarına, takvimine, mevcut palet sonucuna ve daha önce üretilmiş try-on görsellerine erişim; **fotoğraf silme, hesap silme**, dolap görünürlüğünü değiştirme, satın alımları geri yükleme. Abonelik bitince veri silinmez.

### Davet / hediye gibi kötüye kullanılabilir akışlar (proje içeriyorsa)
- Kimliksiz açılan linklerde asıl risk tahmin değil, **çoklu hesapla ödül toplamak**tır.
- Önlem: kişi, cihaz ve Apple ID / Google hesabı başına bir kez (kimlikler **hash'li** saklanır); zaman penceresi; hediye mağaza denemesi değil sunucu yetkisi; hiçbir şey otomatik yenilenmez.
- Anonim önizleme uçlarında hız sınırı şart (DEVOPS_ENGINEER.md §API Gateway) ve yalnız gereken minimum bilgi döner (ör. ilk ad — soyad, e-posta, telefon dönmez).
- Ödül kurgusu değişirse bu bölüm baştan yazılır — ödül, kötüye kullanımın motivasyonunu değiştirir.

### Kimlik ve OTP
- Her uçta doğru politikayla `RequireAuthorization`. `AllowAnonymous` yalnız: OTP başlat/doğrula, Google ve Apple girişi, refresh, mağaza sunucu bildirimleri ve bilinçli olarak anonim bırakılan önizleme uçları. Her yeni anonim uç bir inceleme nedenidir.
- **OTP:** 6 hane, tek kullanımlık, 10 dk, hash'lenmiş saklanır, hedef başına deneme sınırı ve yeniden gönderme bekleme süresi; `start` ucu hız sınırlı ve hesap kayıtlı olsun olmasın aynı cevabı verir (hesap sorgulama yok).
- **SMS pumping:** telefon OTP'si ücretli bir uçtur ve saldırgan onu premium numaralara SMS göndertmek için kullanabilir. Önlemler: ülke kodu izin listesi (SSM `Sms.Routes`; yeni pazar açıldıkça eklenir), numara ve IP başına hız sınırı, günlük SMS harcama alarmı (DEVOPS_ENGINEER.md), sağlayıcının dolandırıcılık korumaları.
- **Apple:** `identityToken` Apple'ın public key'leriyle doğrulanır; `aud`, `iss`, `nonce` kontrol edilir. Google girişi sunuluyorsa iOS'ta Apple ile giriş zorunludur.
- Token'lar mobilde `expo-secure-store`'da; widget/extension'larda token yok.

### Cihaz verisi (ses, kamera, konum…)
- Cihazda işlenmesi vaat edilen veri (ör. ses, görüntü) için o ekranda bu veriyi taşıyan hiçbir ağ çağrısı olmamalı — QA bunu her sürümde proxy ile doğrular. Yeni bir tanıma kütüphanesi eklenirken sunucu tabanlı işlemeye sessizce düşüp düşmediği kontrol edilir (bazı platform API'leri cihazda tanıma yoksa buluta gider — cihaz-içi zorunlu kılınır).
- İzin metinleri bunu açıkça söyler.

Droblet:
- **Kamera / fotoğraf kitaplığı:** parça, boy ve yüz fotoğrafı. Bunlar **cihazda işlenme vaadi taşımaz — sunucuya yüklenir**; vaat "yalnızca sana açık" ve "silebilirsin"dir. İzin metni bunu dürüstçe söyler (DEVOPS_ENGINEER.md §izin metinleri).
- **EXIF:** fotoğrafların konum ve cihaz meta verisi **yükleme sonrası ilk işlemde silinir** ve AI sağlayıcısına EXIF'li görsel gitmez; tercihen istemci de yüklemeden önce temizler. İşlenmiş parça görseli (başkalarına görünebilen tek görsel) asla ham dosyanın kendisi değildir.
- **Ham parça fotoğrafında** kullanıcı ya da başka kişiler, ev içi görülebilir → ham dosya yalnız `uploads/tmp/`'de ve lifecycle ile silinir; başkasına yalnız arka planı temizlenmiş parça görseli gösterilir.
- **Konum (A-4):** karar şehir seçimiyse konum izni istenmez. Konum izni seçilirse yalnız şehir/yaklaşık konum sunucuya gider, saklanmaz.
- **Rehber (A-8):** karar verilene kadar rehber okunmaz. Hash'li eşleşme seçilirse ham numara cihazdan çıkmaz (QA proxy ile doğrular), hash'ler eşleşmeden sonra saklanmaz.
- **Cihaz önbelleği:** imzalı URL'ler ve görsel önbelleği çıkışta ve "fotoğraflarımı sil"de temizlenir.

### AI sağlayıcısı (proje kullanıyorsa)
Seçim öncesi her aday için yazılı cevap alınacak sorular:
- Gönderilen veri **model eğitiminde kullanılıyor mu**? Kullanılmaması gerekir; API ayarı ya da sözleşmeyle.
- Veri ne kadar süre, hangi bölgede saklanıyor?
- Yurt dışına veri aktarımı KVKK ve GDPR açısından nasıl beyan edilecek? (Aydınlatma metnine girer.)

Sağlayıcının API anahtarı yalnız AI worker'larının okuyabildiği SSM parametresindedir; Api Lambda'sı bile okuyamaz.

Droblet'te ek sorular (yüz ve tam boy fotoğrafı gönderildiği için):
- Görsel girdiler ve **üretilen görseller** sağlayıcıda saklanıyor mu, ne kadar, silinebiliyor mu? (Kullanıcı "sil" dediğinde sağlayıcıdaki kopya da vaadin parçasıdır.)
- Yüz görüntüsünden **kimlik/biyometrik şablon** çıkarılıyor ya da saklanıyor mu? (Çıkarılmamalı.)
- İçerik denetimi (moderation) için insan incelemesi var mı — kullanıcı fotoğrafını bir insan görebilir mi?
- Sağlayıcının kullanım politikası reşit olmayanların görselleri için ne diyor (A-5)?
Cevaplar yazılı alınmadan TryOn ve Palette sağlayıcısı seçilmez (AI_ENGINEER.md §Sağlayıcı seçimi).

### Prompt injection
Kullanıcı serbest metin girdiğinde ve bu metin modele gittiğinde:
- Worker çıktısı **yalnız şemaya uyan veri** olarak kabul edilir; serbest metin talimat olarak hiçbir yere gitmez.
- Model iç veriye yalnız **kimlikle** referans verir; sunucu kimliğin varlığını kural tabanlı bir guard/validator ile doğrular. Model kalıcı veriye yazamaz, başka kullanıcının verisini göremez — prompt'ta yalnız o kullanıcının gereken bağlamı vardır.
- AI çıktısı kullanıcının kalıcı verisine yalnız kullanıcı önizleyip onayladıktan sonra girer.

### Kullanıcılar arası erişim — yalnız `VisibilityPolicy`
Droblet'te kullanıcı = tenant; sosyal özellikler (arkadaş akışı, kişi profili, dolapları keşfet, puanlama, influencer dolapları) **başka tenant'ın verisini okur**. Bu okumanın tek yolu `VisibilityPolicy`'dir:
- Başka kullanıcının verisini okuyan her uç, hedef tenant'ı yoldan alır ama **okumayı `VisibilityPolicy.Check(viewer, owner, resource)` kararı olmadan yapmaz**; repository'de "başka tenant'tan oku" yöntemi yalnız bu politikanın arkasından çağrılabilir (kod incelemesi + test).
- Politika kaynak türüne göre beyaz liste: görünürlüğe göre açılabilenler **yalnız** profil özeti (ad, kullanıcı adı, stil etiketleri, sayılar), işlenmiş parça görseli ve alanları, look'lar ve puanları. **Hiçbir ayarda açılmayanlar:** boy/yüz fotoğrafı, try-on çıktıları, palet sonucu, boy/kilo/beden, takvim/giyim kaydı, sepet, bildirim tercihleri, e-posta. Bavullar/"Seyahatler" ürün kararına kadar kapalı.
- Arkadaş akışındaki look görseli sahibinin **try-on görseli değildir**; parça görsellerinden kurulur.
- Görünürlük değişikliği ve takip bırakma **anında** etkili; görünürlük kararı önbelleğe alınırsa süre kısa ve testli. Daha önce verilmiş imzalı URL'ler kısa ömürlüdür — erişim kapanınca en geç o süre içinde biter.
- Paylaşılabilir web linki (A-6) eklenirse anonim uçtur: hız sınırı, yalnız "Herkese açık" dolap, yalnız minimum alan.
- Stil uyumu % ve "Sana benzeyen dolaplar" yalnız görünürlüğü izin veren dolaplar üzerinden hesaplanır — gizli dolap öneri/eşleşme sinyali olarak da sızmaz.

### Fotoğraf depolama ve imzalı URL
- Özel bucket; public erişim tamamen kapalı; SSE; yalnız TLS (DEVOPS_ENGINEER.md §S3).
- S3 anahtarı **yalnız** `IApiContext` tenant'ından kurulur (`tenant/{tenantId}/…`); istemciden gelen anahtar/yol kabul edilmez — yalnız kayıt kimliği.
- Yükleme: kısa ömürlü presigned POST, içerik türü (jpeg/heic/png) ve boyut sınırı koşullu, yalnız `uploads/tmp/{tenantId}/` altına. Sunucu dosyanın gerçekten görsel olduğunu doğrular (sihirli bayt), sonra işler.
- Okuma: kısa ömürlü presigned GET; boy/yüz/try-on için **yalnız sahibine**; parça görseli için sahibine ya da `VisibilityPolicy` izin verdiyse.
- CDN/önbellek: kişisel görseller CDN'den, paylaşılan önbellekten ya da global katalog yolundan **asla** sunulmaz.

### Reşit olmayanlar (13–18) — Açık karar (A-5)
Onboarding'de "Genç (13–18)" segmenti var. Karar verilmeden açılmaması gereken sorular: yaş doğrulama, veli onayı (KVKK'da reşit olmayanın açık rızası — hukuk), gençlerde **boy/yüz fotoğrafı, try-on ve renk paleti**, dolap görünürlüğü ve sosyal özellikler (takip, puanlama, rehber), mağaza yaş derecelendirmesi ve AI sağlayıcısının reşit olmayan politikası. **Öneri (karar ürün sahibinin):** A-5 kapanana kadar Genç segmentinde fotoğraf özellikleri ve sosyal görünürlük kapalı, dolap varsayılanı Gizli.

### Analitik ve pazarlama
- Üçüncü taraf analitik SDK'sı eklemek ürün kararıdır; olaylarda e-posta, telefon, ad, serbest metin yok — yalnız tenant id'si ve sayılar.
- Pazarlama bildirimleri **ayrı pazarlama rızası** ister; varsayılan kapalı; rıza kaydı tarihiyle tutulur.
- Reklam takibi varsa/yoksa gizlilik etiketi buna göre.

### Sırlar ve log
- Sırlar SSM'de, asla `appsettings.json`'da.
- Log'a giden şeyler: id'ler. Gitmeyenler: token, OTP, telefon numarası, e-posta (yalnız hash'i), kullanıcının serbest metni, prompt, AI cevabı.

### KVKK / GDPR
- Hangi pazarlarda çalışılıyorsa o mevzuat (KVKK, GDPR, LGPD…) metinleri ve veri envanteri yeni pazar açılırken gözden geçirilir.
- **Hesap silme**: uygulamadan ve web'den (mağaza zorunluluğu). Kullanıcının tüm verisi silinir: kullanıcı ve kimlik eşlemeleri, tenant ve **tüm tenant kapsamlı bölümler**. Kötüye kullanım kontrolü için gereken hash'ler dışında bir şey kalmaz. Aktif abonelik silmeyle iptal olmaz — kullanıcıya söylenir. Yedeklerden silinme süresi vaadi PITR süresiyle uyumlu olmalı (DEVOPS_ENGINEER.md).
- Silme, **tüm tenant kapsamlı partition'ları** kapsamalı. Yeni bir entity eklenip silme listesine eklenmemesi testte patlamalı (yansıma tabanlı kapsama testi — her `GetPk(string tenantId)` silme listesinde aranır).
- Yasal metinler (Privacy Policy, Terms of Use, abonelik koşulları, KVKK aydınlatma ve açık rıza, Cookie Notice, hesap silme) **hukuk tarafından kontrol edilir**. Metin veri envanterine dayanır: hangi veri, nerede (DynamoDB bölgesi, AI sağlayıcısı, SMS sağlayıcısı), ne kadar süre, kime.
- **Gizlilik etiketi / Data safety formu** ve IARC anketi veri envanteriyle tutarlı doldurulur.

**Droblet:**

**Pazarlar:** Türkiye ilk pazar (KVKK; ₺, TR markalar). Arayüz TR + EN — EN arayüz yeni bir pazar demek değildir; ama AB'den kullanıcı alınırsa GDPR kapsamı başlar → yeni pazar açılırken bu bölüm ve envanter yeniden gözden geçirilir. Veri bölgesi `eu-central-1` (DynamoDB, S3) → Türkiye'den **yurt dışına aktarım** (AWS ve AI sağlayıcısı) KVKK kapsamında aydınlatma metnine ve aktarım mekanizmasına girer — **hukuk**.

**KVKK açısından hukuk incelemesine gidecekler (karar Claude'un değil):**
- **Yüz fotoğrafı** ve ondan sezon tipi çıkarılması: kimlik tespiti yapılmasa da biyometrik veriye yakın — özel nitelikli kişisel veri ve **açık rıza** gerekip gerekmediği.
- **Tam boy fotoğrafı** ve try-on: beden görüntüsü; **kilo**: sağlık verisine yakın.
- Reşit olmayanlar (A-5).
- "Sınırsız" try-on'un fair-use sınırının abonelik koşullarında ifadesi.
- Affiliate/gelir modeli (A-2) varsa bunun kullanıcıya açıklanması.

**Veri envanteri:** yukarıda (§Role Overview — Kişisel veri envanteri). Her yeni entity ya da S3 öneki envantere aynı PR'da eklenir.

**Silme listesi** — iki ayrı akış:

1. **"Fotoğraflarımı ve üretilen görselleri sil"** (hesap silmeden bağımsız):
   - S3 `tenant/{tenantId}/body/`, `tenant/{tenantId}/face/`, `tenant/{tenantId}/tryon/` (tenant içi try-on önbelleği dahil)
   - `BodyProfile` içindeki fotoğraf referansları (boy/kilo/beden ayrı alan — bu akışta kalır)
   - Kuyrukta/işlemde olan TryOn ve Palette işleri iptal; worker silinmiş fotoğraf için sonuç yazmaz
   - Sağlayıcıda kalan kopyalar: sağlayıcı silme API'si varsa çağrılır (A-3 cevabına bağlı)
   - Cihaz görsel önbelleği temizlenir
   - **Açık soru (ürün sahibi / hukuk):** yüz fotoğrafından türetilmiş **palet sonucu** bu akışta silinsin mi? Karar verilene kadar: silinir ve kullanıcıya söylenir (güvenli taraf).
   - Parça görselleri bu akışa **girmez** (ekran metni "yüz ve stil fotoğrafların ile üretilen görseller" der); gardırop parçası tek tek silinebilir.
2. **"Hesabımı sil"** (uygulama + web): tüm DynamoDB tenant bölümleri (yansıma tabanlı kapsama testi) **ve** tüm S3 `tenant/{tenantId}/` öneki + `uploads/tmp/{tenantId}/` + başka kullanıcıların bölümlerinde duran kayıtlar: takip kenarları (takip ettikleri / takipçileri), verdiği puanlar (look ortalamaları yeniden hesaplanır), varsa paylaşım linkleri, rehber hash'leri (A-8), cihaz token'ları. Kapsama testi **S3 önek türlerini de** içerir: yeni bir önek türü eklenip silme listesine girmezse test patlar. S3 sürümleme açıksa eski sürümler de silinir (DEVOPS_ENGINEER.md) — yoksa "silindi" yanlış olur.

**Yasal metinler — durum: taslak, açık (hukuk onayı yok).** Gereken: Gizlilik Politikası, Kullanım Koşulları (01'de linkli), abonelik koşulları (05), KVKK aydınlatma metni, **açık rıza metinleri** (yüz/boy fotoğrafı, yurt dışı aktarım — hukuk kararına göre), Çerez Bildirimi (landing), hesap silme sayfası (web). Hepsi bu envantere dayanır ve **hukuk tarafından kontrol edilir**; E12 Lansman'ın engelleyicisidir. Alan adı A-10, sağlayıcılar A-3/A-4/A-2 kapanmadan metin son hâlini alamaz.

---

## Bir şey gerçekten olduğunda

1. **Nerede çalışıyor, ulaşılabilir mi?** Hiç çağırmadığımız açık bir kod yolu yamadır, olay değil. Hangisi olduğunu yazılı söyle.
2. **Maruziyet ne?** Hangi yüzey, hangi kullanıcılar, ne zamandan beri.
3. **Yamala ya da hafiflet.** Sürüm yükseltmesi varsa o. Yoksa yolu kapatan bir önlem — doğrulama, kapatılan bir özellik (AI kill switch, telefon OTP kanalını kapatmak dahil) — ve asıl düzeltme için ticket.
4. **Gönder.** Backend aynı gün. Mobil bir mağaza incelemesi; açık uygulamadaysa (ya da extension'daysa) bunu açıkça söyle.
5. **Yaz.** Ne oldu, ne yaptık, kendi aracımız yakalar mıydı.

**Kullanıcılara verileri açığa çıktığında ya da harekete geçmeleri gerektiğinde söyle.** Kimsenin ulaşmadığı bir bağımlılığı yamaladığımızda değil.

---

## Reading

- [GitHub Advisory Database](https://github.com/advisories)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) — A06: Vulnerable and Outdated Components
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/) — prompt injection
- [.NET security advisories](https://github.com/dotnet/announcements/issues?q=label%3ASecurity)
- [Expo SDK changelog](https://expo.dev/changelog)
- [KVKK](https://www.kvkk.gov.tr/)
