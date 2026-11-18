# Product Manager Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Rolün özeti
Ürün vizyonu, yol haritası ve gereksinimler sende. İş hedeflerini mühendislik planına çevirirsin ve her rolün net, uygulanabilir bir tanımla çalışmasını sağlarsın. Bu dosya aynı zamanda MVP → beta planının ve **verilmiş ürün kararlarının** tek kaynağıdır.

> **Teknik kararlar bu dosyada verilmez.** Yığın, mimari ve kurallar [TEAM_LEAD.md](TEAM_LEAD.md), [BACKEND_ENGINEER.md](BACKEND_ENGINEER.md), [MOBILE_ENGINEER.md](MOBILE_ENGINEER.md) ve [DEVOPS_ENGINEER.md](DEVOPS_ENGINEER.md)'de. Burada yalnızca onlara referans verilir.

> **Tasarım handoff'u:** `.claude/_handoff/droblet-handoff/` (varsa). Ürün kuralları, ekranlar ve metinler için **tek doğru kaynak** orası. Canlı kaynaklar (tasarım canvas'ı, ürün brifi, yasal metinler) handoff'taki klasörden yeniyse canlı kaynak geçerlidir. **Teknik yığın ekibin yığınıdır**; handoff'ta farklı bir mimari öneri varsa uygulanmaz — farklar §4'te yazılır.
>
> Handoff içeriği:
> - [`README.md`](../_handoff/droblet-handoff/README.md) — ürün brifi: ürün, 5 sekme, ekran → yetenek tablosu, Lambda adları, entity'ler, epic'ler E1–E12, gizlilik vaatleri, üyelik, tasarım sistemi, açık kararlar A-1…A-10.
> - [`SCREENS.md`](../_handoff/droblet-handoff/SCREENS.md) — 30 ekranın metni, tasarımdaki sırayla (01–30 + tasarım sistemi), her biri kaynak dosya adıyla (`Home.dc.html`, `Paywall.dc.html` …).
> - Canlı tasarım: https://claude.ai/artifact/UUAJnqCfrvDkh3yPPvnqw1 ("Droblet — Uygulama UX/UI", 2026-11-18).
> - Mağaza metinleri ve yasal metinler handoff'ta **yok** → E12'de yazılır, hukuk kontrolü ürün sahibinde.

---

## Özet

**Droblet**, kişisel gardırobu dijitalleştiren ve AI ile her gün ve her seyahat için kombin öneren mobil stil asistanıdır. Kullanıcı kıyafetlerini fotoğraflar; Droblet parçaları tanır (tür, renk, kumaş), arka planı temizler, ortama ve havaya göre günlük kombin ve haftalık plan, şehir ve tarihe göre bavul hazırlar; kombinleri ve mağaza ürünlerini **kullanıcının kendi fotoğrafı üzerinde** gösterir. Hedef: Türkiye'de kendi dolabını daha iyi kullanmak isteyen kadın, erkek ve genç (13–18) kullanıcılar; uygulama dili TR + EN. Ana fark: öneriler genel bir katalogdan değil **kullanıcının kendi dolabından** gelir ve sonuç **kendi bedeninde** görülür.

- **Slogan:** "Her sabah hazır bir kombin. Her seyahatte hazır bir bavul." (paywall, 05)
- **Vaat:** "Sabah 'ne giysem' derdi ve saatler süren bavul hazırlığı bitti. Dolabın artık senin için düşünüyor." (hoş geldin, 01)
- **Fark:** Kendi dolabından kombin + kendi fotoğrafında "üzerimde gör" + "her parça en az 2 kez giyilir" kuralıyla akıllı bavul; mağaza yalnızca eksik parçayı tamamlar, ödeme markanın kendi sitesinde.

**North Star (öneri — ürün sahibi onaylar):** **Haftalık giyinen kullanıcı** — bir takvim haftasında (Pzt–Paz, kullanıcının yerel saati) en az bir gün için kombinini kaydeden tekil kullanıcı sayısı. Sayılır: "Bunu giyiyorum" (06), takvimde "ne giydim" kaydı (09), Stilist önerisinde "Takvime ekle" (17) ya da haftalık planda bir güne kombin atanması (07) — hepsi `WearLog` / `PlanDay` yazar. Sayılmaz: yalnızca uygulamayı açmak, yalnızca parça eklemek, yalnızca "üzerimde gör" görüntülemek, mağaza gezmek, test/iç hesaplar. Gerekçe: vaat "her sabah hazır bir kombin"; kullanıcı kombini gerçekten benimsediğinde değer üretilmiş olur.

**Kim yapıyor:** Tüm geliştirme rollerini Claude üstlenir; ekip rehberleri her rolün çalışma talimatıdır. Ürün sahibi kararları verir, sprint demolarını onaylar, gerçek cihazda test eder ve hesapları (AWS, Apple, Google, AI sağlayıcıları, SMS vb.) yönetir.

**Plan:** S0 (hazırlık) + S1–Sn, iki haftalık sprintler; sabit tarih yok, her sprint sonunda gerçek cihazda demo. Handoff'ta kilometre taşları varsa sprintlere birebir eşlenir (§4).

**Kritik yol:** AI kalitesi ve maliyeti. (1) **Try-on** ("üzerimde gör", E6) — paywall'ın bir numaralı vaadi; sağlayıcı ve görsel başı maliyet açık (A-3). S0'da deneme → S0 sonunda karar → S4'te üretim. Kalite ya da maliyet tutmazsa paywall vaadi ve 06/07/08/17/19/22 ekranları etkilenir. (2) **Parça işleme** (E2, ItemProcessor) — gardırop dolmazsa Stilist, bavul ve palet uyumu çalışmaz; S0 denemesi → S2. (3) **Genç segmenti (A-5)** ve **katalog kaynağı (A-2)** ürün kararları; A-5 S1 onboarding'i, A-2 S6 mağazayı bekletir.

**Teknik temel:** Backend .NET 10 Lambda + **DynamoDB** tek tablo + SQS + SAM; mobil React Native (Expo) + TanStack Query. Ayrıntılar §5 ve [TEAM_LEAD.md](TEAM_LEAD.md).

**Tenant modeli:** kullanıcı = tenant (tek kişi, rol yok). Sosyal özellikler başka tenant'ın verisini **yalnızca** `VisibilityPolicy` üzerinden okur (Herkese açık / Yalnızca takipçiler / Gizli). Boy/yüz fotoğrafları ve try-on çıktıları hiçbir görünürlük ayarında paylaşılmaz. **Lambda'lar:** `Api`, `ItemProcessor` (SQS `item-process-request`), `Stylist` (SQS `stylist-request`), `TryOn` (SQS `tryon-request`), `Palette` (SQS `palette-request`), `Notifier` (EventBridge).

**İş modeli:** Droblet Üyelik — aylık ve yıllık abonelik, ücretsiz deneme (05). Yetki kullanıcıdadır (aile/organizasyon paketi yok). Satın alma doğrudan StoreKit 2 / Play Billing, doğrulama sunucuda. Fiyatlar, deneme süresi ve ücretsiz paket sınırları **Açık karar — ürün sahibi (A-1)**. Mağaza ürünlerinin ödemesi Droblet'te alınmaz, marka sitesine yönlendirilir; affiliate geliri olup olmayacağı **Açık karar — ürün sahibi (A-2)**.

**En büyük riskler:** (1) try-on AI maliyeti ve kalitesi (R-1, R-2), (2) parça tanıma ve arka plan temizleme kalitesi (R-3), (3) 13–18 yaş + KVKK ve yüz/boy fotoğrafı mahremiyeti (R-4, R-6). Önlemler §6'da.

---

## 1. Ekip yapısı

| Rol | Kim | Sorumluluk | Rehber |
|---|---|---|---|
| **Ürün sahibi** | Kullanıcı | Kararlar, sprint demosu onayı, gerçek cihaz testi, hesaplar ve anahtarlar, mağaza gönderim onayı, hukuk kontrolünün takibi | — |
| Product Manager | Claude | PRD, backlog, kabul kriterleri, beta programı | bu dosya |
| Team Lead | Claude | Mimari, kod incelemesi, teknik karar kaydı, kritik yol | [TEAM_LEAD.md](TEAM_LEAD.md) |
| Backend Engineer | Claude | Lambda'lar, DynamoDB, domain servisleri, yetki ve satın alma doğrulama. Droblet: `VisibilityPolicy`, özel fotoğraf depolama ve silme akışı, katalog/edit global verisi, sepet (dış link) | [BACKEND_ENGINEER.md](BACKEND_ENGINEER.md) |
| Mobile Engineer | Claude | Expo uygulaması, native extension'lar, çevrimdışı kuyruk, bildirim, uygulama içi satın alma. Droblet: kamera ve toplu fotoğraf yükleme, try-on bekleme durumları; **MVP'de native widget extension yok** | [MOBILE_ENGINEER.md](MOBILE_ENGINEER.md) |
| AI Engineer | Claude | Prompt'lar, değerlendirme seti, kota ve maliyet. Droblet: parça tanıma + arka plan temizleme, kombin/bavul önerisi, try-on, renk paleti; görsel başı maliyet tablosu | [AI_ENGINEER.md](AI_ENGINEER.md) |
| UX/UI Designer | Claude | Eksik ekranların tasarımı (onaya sunulur), tasarım QA. Droblet: şifre sıfırlama, parça düzenle/sil, bildirim izni ön ekranı, silme onayları, boş durumlar, genç segmenti onay akışı (A-5) | [UX_DESIGNER.md](UX_DESIGNER.md) |
| Frontend Engineer | Claude | Landing, web sayfaları, web hesap silme, yasal sayfalar (MVP'de web profili yok — BACKLOG) | [FRONTEND_ENGINEER.md](FRONTEND_ENGINEER.md) |
| QA Engineer | Claude + ürün sahibi | Otomatik testler Claude'da; **gerçek cihaz testleri ürün sahibinde**. Droblet: görünürlük matrisi testleri (3 ayar × takipçi/takip etmeyen/sahip) | [QA_ENGINEER.md](QA_ENGINEER.md) |
| DevOps Engineer | Claude | `template.yaml`, CI/CD, EAS sürüm hattı, maliyet alarmları. Droblet: özel S3 fotoğraf bucket'ı, 4 SQS kuyruğu + DLQ, AI harcama alarmları | [DEVOPS_ENGINEER.md](DEVOPS_ENGINEER.md) |
| Security Engineer | Claude | Bağımlılık güvenliği, kullanıcı izolasyonu, KVKK/GDPR taslakları, kötüye kullanım. Droblet: fotoğraf erişimi (kısa ömürlü imzalı URL), reşit olmayan kullanıcılar (A-5), AI sağlayıcısının veri saklama koşulları | [SECURITY_ENGINEER.md](SECURITY_ENGINEER.md) |

Tüm roller Droblet'te kullanılır; çıkarılan rol yok.

### Claude'un yapamadıkları — ürün sahibinde

| İş | Ne zaman |
|---|---|
| AWS hesabı, deploy anahtarları, SSM'e sırların yazılması | S0 |
| Apple Developer + Google Play hesapları, uygulama kayıtları | **S0'da başlat** — onay süresi var |
| Abonelik / uygulama içi ürünler, vergi/banka bilgileri | S0'da başlat, satın alma sprintinde şart |
| AI sağlayıcı API anahtarları ve sağlayıcı panelinde harcama limiti | S0 |
| SES alan adı doğrulaması ve sandbox'tan çıkış talebi; SMS sağlayıcı hesabı | S0 (Droblet'te telefon girişi yok — SMS gerekmez; SES e-posta girişi ve şifre sıfırlama için şart) |
| Alan adı / DNS kayıtları | S1 |
| Her sprint demosunda **iki gerçek telefonla** (iOS + Android) test ve onay | Her sprint |
| KVKK/GDPR ve yasal metinlerin hukuk kontrolü | Lansmandan önce |
| Mağaza gönderimlerinin onayı (`mobile-release` ortamı) | Lansman sprinti+ |

Droblet'e özel:

| İş | Ne zaman |
|---|---|
| Try-on ve görsel işleme AI sağlayıcısının seçimi, hesabı, veri saklama sözleşmesi (A-3) | S0 (deneme raporundan sonra) |
| Hava durumu sağlayıcısı hesabı ve anahtarı (A-4) | S2 sonu |
| Katalog kaynağı: marka feed'i / affiliate ağı / elle — anlaşmalar ve erişim (A-2) | S5 sonu |
| Editör ve influencer içeriği, haklar; haftanın edit'i için ilk içerik (A-7) | S5 sonu |
| Değerlendirme seti için gerçek kıyafet fotoğrafları (onaylı, ekip içi) ve test boy/yüz fotoğrafları (açık rızalı) | S0 |
| 13–18 yaş politikası ve veli onayı için hukuk görüşü (A-5) | S1 başı |

---

## 2. İş akışları (workstream)

| İş akışı | Kapsam | Bağımlılıklar |
|---|---|---|
| **A. Mobil uygulama** | 5 sekme (Bugün, Gardırop, Stilist, Keşfet, Profil); onboarding 01–05; kamera + toplu yükleme; try-on bekleme ve sonuç; takvim; mağaza + sepet (dış link); sosyal; paywall + restore; gizlilik ve silme | Backend'in API sözleşmesi (her epic öncesi), eksik ekran tasarımları |
| **B. Backend** | `Api` (auth, profil, gardırop, look, plan/takvim, bavul, sosyal, katalog, sepet, yetki, iş başlatma + durum); `VisibilityPolicy`, `EntitlementPolicy`; özel S3 fotoğraf depolama + silme; global veri (edit, katalog); `Notifier` | DevOps altyapısı (`template.yaml`) |
| **C. AI** | `ItemProcessor` (arka plan, kadraj, tür/renk/kumaş/sezon taslağı), `Stylist` (günlük kombin, haftalık plan, bavul, eksik parça), `TryOn`, `Palette`; değerlendirme setleri; görsel başı maliyet ve kota | Worker Lambda'ları, değerlendirme verisi, A-3 |
| **D. Tasarım ve QA** | Eksik ekranların tasarımı, sprint başında ekran geçişi, test senaryoları, gerçek cihaz kontrol listesi | A, B, C'nin sprint çıktıları; gerçek cihaz testi ürün sahibinde |
| **E. Lansman ve büyüme** | Landing, KVKK aydınlatma metni, Kullanım Koşulları, Gizlilik Politikası (01'de link), web hesap silme, mağaza listeleri ve ekran görüntüleri, yaş derecelendirmesi, kapalı beta, davet linki | Mağaza hesapları (S0), metrik olayları, A-5, A-10 |

**Sözleşme kuralı:** Mobil, her epic'e başlamadan önce backend uç noktalarının istek/cevap şekillerini yazılı olarak sabitler (BACKEND_ENGINEER.md §Uç nokta haritası). Sözleşmesi olmayan epic sprint'e alınmaz. Native extension'lar (widget vb.) ile uygulama arasındaki veri şekli de bir sözleşmedir.

---

## 3. Epic ve backlog

**Öncelik:** Must = beta'da yoksa beta yok · Should = beta'da olmalı, kayarsa hemen sonra · Could = zaman kalırsa.

### Epic listesi

| Epic | Kapsam | Sprint |
|---|---|---|
| E0 — Temel | Kimlik, navigasyon, i18n, analitik, ayarlar, hesap silme, dark mode, erişilebilirlik (Droblet: dark mode tasarımda yok → A-9) | S0–S2 |
| E1 — Hesap ve onboarding | 01–04: hoş geldin, Apple/Google/e-posta kayıt, stil profili, beden ve fotoğraf | S1 |
| E2 — Gardırop ve parça ekleme | 10–13: gardırop, parça detayı, kamera ile ekle, toplu ekle (ItemProcessor) | S2 |
| E3 — Look'lar | 14–15: lookbook, favoriler, look oluştur (5 slot) | S3 |
| E4 — Bugün, haftalık plan, takvim | 06–09 (08 hariç → E8): günün kombini, hava, "Bunu giyiyorum", haftalık plan, takvim | S3–S4 |
| E5 — Stilist ve bavul | 16–19: kombin önerisi (3 öneri), bavul listesi + günlük look'lar | S3–S5 |
| E6 — Üzerimde gör / try-on | Look, kombin ve mağaza ürününü kullanıcının boy fotoğrafında gösterme (06, 07, 08, 15, 17, 19, 22) | S4, S6 |
| E7 — Renk paleti | 30: sezon tipi, yakışan/kaçınılacak tonlar, gardırop uyum oranı | S5 |
| E8 — Keşfet, edit ve mağaza | 08, 20–24: haftanın edit'i, mağaza, ürün, kombin oluşturucu, sepet (ödeme marka sitesinde) | S6 |
| E9 — Sosyal | 25–27: takip, kişi profili, arkadaş akışı, puanlama, görünürlük | S7 |
| E10 — Üyelik | 05: paywall, deneme, restore, sunucu doğrulama, yetki | S8 |
| E11 — Profil, gizlilik, silme | 28–29: profil, dolap görünürlüğü, fotoğraf + üretilen görsel silme, bildirim tercihleri, hesap silme | S2 (fotoğraf silme), S7–S8 |
| E12 — Lansman | Landing, yasal sayfalar, web hesap silme, mağaza listeleri, kapalı beta | S9 |

### Backlog

**Kullanıcı hikâyesi formatı:** "<Rol> olarak <ne> yaparım / isterim" — kabul kriterleri test edilebilir, ilgili tasarım dosyası adıyla; paket sınırları ve "Kabul testi" maddeleri açıkça yazılır.

| ID | Epic | Kullanıcı hikâyesi | Kabul kriterleri | Öncelik | Sprint | Durum |
|---|---|---|---|---|---|---|
| US-001 | E0 | Kullanıcı olarak 5 sekmeyle (Bugün, Gardırop, Stilist, Keşfet, Profil) gezinirim | Stilist orta sekme (`TasarimSistemi.dc.html`); her ekranda boş / yükleniyor / hata / çevrimdışı / başarı | Must | S0–S1 | Yapılacak |
| US-002 | E0 | Kullanıcı olarak uygulamayı Türkçe ya da İngilizce kullanırım | Tüm metinler TR + EN çeviri dosyalarında; büyük harf etiketler kaynakta büyük harfle, stil ile değil | Must | S0 | Yapılacak |
| US-003 | E0 | Ürün sahibi olarak §8 olaylarını görürüm | Olaylar Api → DynamoDB (TTL); parametrelerde kişisel veri ve fotoğraf yok | Must | S1 | Yapılacak |
| US-004 | E0 | Kullanıcı olarak uygulamayı Dynamic Type / font ölçeği ve ekran okuyucuyla kullanırım | Kontrast ≥ 4.5:1 (token'lar), dokunma ≥ 44; dark mode A-9 kararına göre | Must | S0–S2 | Yapılacak |
| US-005 | E0 | Kullanıcı olarak bildirim iznini önce açıklamayla görürüm | Ön ekran (tasarım eksik → UX), sonra sistem izni; Android 13+ `POST_NOTIFICATIONS`; reddedilince akış devam eder | Should | S4 | Yapılacak |
| US-006 | E0 | Kullanıcı olarak ayarlar, geri bildirim ve SSS'ye ulaşırım | 28 › Ayarlar (`Profil.dc.html`, `Ayarlar.dc.html`); dil seçimi | Should | S7 | Yapılacak |
| US-010 | E1 | Yeni kullanıcı olarak vaadi görüp başlarım | `Main.dc.html`: "Hemen başla", "Zaten hesabım var", Kullanım Koşulları ve Gizlilik Politikası linkleri | Must | S1 | Yapılacak |
| US-011 | E1 | Kullanıcı olarak Apple, Google ya da e-posta + şifre ile hesap açar / giriş yaparım | `Kayit.dc.html`; iOS'ta Apple görünür; e-posta doğrulama ve şifre sıfırlama (tasarım eksik → UX) SES ile | Must | S1 | Yapılacak |
| US-012 | E1 | Kullanıcı olarak stil profilimi oluştururum | `OnbStil.dc.html`: Kadın/Erkek/Genç tek seçim; tam **3** etiket (4.'sü seçilemez); bütçe 3 seçenekten biri; sonradan değiştirilebilir | Must | S1 | Yapılacak |
| US-013 | E1 | Kullanıcı olarak boy, kilo, beden ve boy/yüz fotoğrafımı eklerim ya da atlarım | `OnbFoto.dc.html`; "Atla" çalışır, sonra Profil'den eklenir; gizlilik metni ekranda; fotoğraflar özel S3'te, yalnız sahibine imzalı kısa ömürlü URL | Must | S1 | Yapılacak |
| US-014 | E1 | Genç (13–18) kullanıcı olarak yaşıma uygun kısıtlarla kayıt olurum | **A-5 kapanmadan sprint'e alınmaz**; karar şekline göre yaş doğrulama, veli onayı, sosyal/fotoğraf kısıtları; karar gelmezse öneri: beta'da Genç seçeneği kapalı (ürün sahibi onaylar) | Must | S1–S2 | Engelli (A-5) |
| US-020 | E2 | Kullanıcı olarak gardırobumu kategori, sezon ve renkle filtrelerim | `Gardirop.dc.html`: parça sayısı, Tümü/Üst/Alt/Elbise/Dış giyim/Ayakkabı, sezon, renk, "En yeni" sıralama; Parçalar/Looklar/Bavullar alt sekmeleri | Must | S2 | Yapılacak |
| US-021 | E2 | Kullanıcı olarak bir parçanın detayını görürüm | `Parca.dc.html`: kategori, sezon, beden, renk, kumaş, giyilme sayısı (`WearLog`'dan), ilgili look'lar, "Bununla kombin yap" → Stilist | Must | S2 | Yapılacak |
| US-022 | E2 | Kullanıcı olarak kamerayla tek parça eklerim, AI'ın önerdiği alanları onaylarım | `Ekle.dc.html`: çek → ItemProcessor taslağı (tür, renk, kumaş, sezon) → kullanıcı düzeltir/onaylar → kayıt. **Kabul testi:** onaysız taslak gardıroba yazılmaz; işlem başarısızsa elle girişe düşer | Must | S2 | Yapılacak |
| US-023 | E2 | Kullanıcı olarak birden çok fotoğrafı toplu eklerim | `TopluEkle.dc.html`: ilerleme "8 / 12"; arka plan temizleme, kadraj, alan doldurma; düşük güvenli alan "Kategoriyi kontrol et" uyarısı; seçilenleri ekle; toplu üst sınır SSM'de (sayı A-1 ile) | Must | S2–S3 | Yapılacak |
| US-024 | E2 | Kullanıcı olarak bir parçayı düzenler ya da silerim | Tasarım eksik → UX; silinen parça look'larda "parça kaldırıldı" olarak görünür; `version` ile 409 | Must | S2 | Yapılacak |
| US-030 | E3 | Kullanıcı olarak look'larımı lookbook'ta görürüm | `Looklar.dc.html`: sayı, Tümü/Favoriler/Ofis/Akşam/Hafta sonu/Seyahat filtresi; puan yalnız E9 varsa görünür | Must | S3 | Yapılacak |
| US-031 | E3 | Kullanıcı olarak 5 slottan look oluştururum | `LookYeni.dc.html`: ad, ortam, Üst/Alt/Dış giyim/Ayakkabı/Çanta-Aksesuar; "3 / 5 parça seçildi"; gardıroptan seç (mağazadan seç E8 ile); en az 1 parça | Must | S3 | Yapılacak |
| US-032 | E3 | Kullanıcı olarak look'u favorilerime eklerim | Favoriler filtresi; çevrimdışı çalışır | Should | S3 | Yapılacak |
| US-040 | E4 | Kullanıcı olarak Bugün ekranında hava ve ortama göre günün kombinini görürüm | `Home.dc.html`: tarih, sezon, hava + şehir (A-4), günün ortamı, günün kombini (Stylist), "Senin üzerinde" görsel (E6, yoksa düz look), hafta şeridi | Must | S3 | Yapılacak |
| US-041 | E4 | Kullanıcı olarak "Bunu giyiyorum" ile günü kaydederim | `WearLog` yazılır, parça giyilme sayıları artar; idempotent (`clientMutationId`); çevrimdışı kuyruklanır | Must | S3 | Yapılacak |
| US-042 | E4 | Kullanıcı olarak önümüzdeki 7 günü planlarım | `Hafta.dc.html`: gün başına ortam, "Öner" (tek gün), "Haftamı planla" (7 gün, Stylist async), "Kombin seçilmedi" durumu | Must | S4 | Yapılacak |
| US-043 | E4 | Kullanıcı olarak takvimde ne giyeceğimi ve ne giydiğimi görürüm | `Takvim.dc.html`: ay görünümü, plan + kayıt, "Bu ay N gün kayıtlı", "En çok giyilen"; "Rapor" düğmesi MVP'de yok (BACKLOG) | Should | S4 | Yapılacak |
| US-044 | E4 | Kullanıcı olarak sabah kombin hatırlatması alırım | Notifier; kullanıcının yerel saatine göre; 29'da kapatılabilir; varsayılan saat Açık karar — ürün sahibi | Should | S4 | Yapılacak |
| US-050 | E5 | Kullanıcı olarak ortam ve havaya göre kombin önerisi isterim | `Stilist.dc.html`: Ofis/Akşam yemeği/Hafta sonu/Düğün/Seyahat/Spor; hava; "Sadece gardırobum" anahtarı; async, durum sorgulanır | Must | S3 | Yapılacak |
| US-051 | E5 | Kullanıcı olarak 3 öneriyi açıklamasıyla görür, birini takvime eklerim | `DanismanSonuc.dc.html`: "Öneri 1 / 3", ad, açıklama, parçalar "Gardırobun"/"Önerilen"; önerilen parça yalnız katalogda varsa (E8) ve "Sadece gardırobum" kapalıysa; "Takvime ekle" → `PlanDay`. **Kabul testi:** öneri kullanıcının olmayan bir parçayı "Gardırobun" diye gösteremez (sunucu doğrular) | Must | S3–S4 | Yapılacak |
| US-052 | E5 | Kullanıcı olarak şehir ve tarihe göre bavul hazırlatırım | `Bavul.dc.html`: şehir, gidiş, dönüş, seyahat tipi (İş/Akşam yemeği/Gezi), "Sadece kabin"; geçmiş seyahatler listesi | Must | S5 | Yapılacak |
| US-053 | E5 | Kullanıcı olarak bavul listesini ve günlük look'ları görür, hazırladıklarımı işaretlerim | `BavulDetay.dc.html`: şehir hava tahmini, parça ve look sayısı, "Her parça en az 2 kez giyiliyor" (sunucu kuralı), günlük look'lar, "3 / 9 hazır" işaretleme (çevrimdışı) | Must | S5 | Yapılacak |
| US-060 | E6 | Kullanıcı olarak bir look'u / öneriyi kendi boy fotoğrafımda görürüm | 06, 07, 15, 17, 19'daki "Üzerimde gör"; async, bekleme durumu; boy fotoğrafı yoksa 04'e yönlendirir; çıktı yalnız sahibine, global önbelleğe girmez; "AI önizleme" etiketi | Must | S4 | Yapılacak |
| US-061 | E6 | Kullanıcı olarak mağaza ürününü üzerimde görürüm | `Urun.dc.html` Ürün / Üzerimde; edit'te "Senin üzerinde" (08) | Must | S6 | Yapılacak |
| US-062 | E6 | Ücretsiz kullanıcı olarak try-on sınırıma geldiğimde paywall'u görürüm | Sınır `EntitlementPolicy` + SSM; sayı A-1; sınır kullanıcıya önceden gösterilir | Must | S8 | Engelli (A-1) |
| US-070 | E7 | Kullanıcı olarak yüz fotoğrafımdan renk paletimi çıkarırım | `RenkPaleti.dc.html`: sezon tipi, yakışan tonlar, kaçınılacak tonlar, "Yüz fotoğrafından AI ile çıkarıldı"; yüz fotoğrafı yoksa yükleme akışı | Must | S5 | Yapılacak |
| US-071 | E7 | Kullanıcı olarak gardırobumun paletimle uyum oranını ve uyumsuz parçaları görürüm | "%64 uyumlu", "Uyumsuz parçaları gör" → filtreli gardırop | Should | S5 | Yapılacak |
| US-072 | E7 | Kullanıcı olarak paletime uygun ürünleri görürüm | Katalog (E8) varsa; yoksa bölüm gizli | Could | S6 | Yapılacak |
| US-080 | E8 | Kullanıcı olarak Keşfet'te editör içeriği, mağaza ve arkadaşları görürüm | `Kesfet.dc.html`: MVP'de Editör / Mağaza / Arkadaşlar; Influencer ve Dizi outfitleri gizli (BACKLOG) | Must | S6 | Yapılacak |
| US-081 | E8 | Kullanıcı olarak haftanın edit'ini görür, look'u satın almaya geçerim | `Edit.dc.html`: haftalık stil, look açıklaması, ürün satırları, toplam; "Look'u satın al" → sepete ekler (ödeme marka sitesinde); içerik kaynağı A-7 | Must | S6 | Yapılacak |
| US-082 | E8 | Kullanıcı olarak mağazada ürün arar ve filtrelerim | `Magaza.dc.html`: arama, kategori, marka/renk/beden, "En yeni"; katalog kaynağı A-2; fiyat yoksa satır fiyatsız gösterilir | Must | S6 | Engelli (A-2) |
| US-083 | E8 | Kullanıcı olarak ürün detayında beden seçer, gardıroba ya da sepete eklerim | `Urun.dc.html`: beden, "Gardırobundaki N parçayla uyumlu" + Göster, "Ödeme ve teslimat … kendi mağazasında tamamlanır" metni | Must | S6 | Yapılacak |
| US-084 | E8 | Kullanıcı olarak kombini mağaza ve gardırop parçalarıyla tamamlarım | `KombinOlusturucu.dc.html`: her slot Mağaza/Gardırobum; "Lookbook'a kaydet", "N ürünü satın al" → sepet; "Parçamı tamamla" girişi | Should | S6 | Yapılacak |
| US-085 | E8 | Kullanıcı olarak sepetimi markaya göre gruplu görür, markanın sitesinde öderim | `Sepet.dc.html`: marka grupları, marka toplamı, "X'te öde" dış link; genel toplam; Droblet ödeme almaz | Must | S6 | Yapılacak |
| US-090 | E9 | Kullanıcı olarak dolabımı kimin görebileceğini seçerim | `Ayarlar.dc.html`: Herkese açık / Yalnızca takipçiler / Gizli; varsayılan A-6; tüm başka-tenant okumaları `VisibilityPolicy`'den. **Kabul testi:** 3 ayar × (sahip, takipçi, takip etmeyen) matrisi | Must | S7 | Yapılacak |
| US-091 | E9 | Kullanıcı olarak kullanıcı adıyla arar, takip ederim | `Arkadaslar.dc.html` arama + "Takip et"; Gizli dolapta da profil adı görünür, dolap görünmez | Should | S7 | Yapılacak |
| US-092 | E9 | Kullanıcı olarak bir kişinin profilini ve izin verdiği dolabını görürüm | `Kisi.dc.html`: ad, kullanıcı adı, stil etiketleri, parça/look sayısı, Looklar/Dolap/Seyahatler — görünürlüğe göre; "Stil uyumu %" MVP'de yok (BACKLOG) | Should | S7 | Yapılacak |
| US-093 | E9 | Kullanıcı olarak takip ettiklerimin look'larını görür ve puanlarım | `Akis.dc.html`: hikâye şeridi, look kartı, ortalama puan, puanlayan sayısı, "Parçaları gör"; kendi look'umu puanlayamam; try-on görseli akışta asla görünmez | Should | S7 | Yapılacak |
| US-094 | E9 | Kullanıcı olarak davet linkini paylaşırım | Sistem paylaşım sayfası; link mağaza sayfasına gider (web profili yok); alan adı A-10 | Could | S7 | Yapılacak |
| US-100 | E10 | Kullanıcı olarak aylık/yıllık üyeliği ve ücretsiz denemeyi görür, başlatırım | `Paywall.dc.html`: 4 fayda, Yıllık "En avantajlı", Aylık "Esnek", fiyat/dönem/deneme/yenileme mağazadan; "İstediğin zaman iptal et"; fiyatlar A-1 | Must | S8 | Engelli (A-1) |
| US-101 | E10 | Kullanıcı olarak satın alımlarımı geri yüklerim | "Satın alımları geri yükle" her zaman görünür; doğrulama sunucuda | Must | S8 | Yapılacak |
| US-102 | E10 | Kullanıcı olarak üyeliğim bitince verimi kaybetmem | Abonelik bitince parçalar/look'lar/bavullar kalır; yalnız premium yetenekler `EntitlementPolicy`'ye göre kapanır | Must | S8 | Yapılacak |
| US-110 | E11 | Kullanıcı olarak profilimde özetimi görürüm | `Profil.dc.html`: ad, kullanıcı adı, etiketler, parça/look/takipçi, stil fotoğrafı durumu, istatistikler, seyahat arşivi, renk paletim, üyelik, gizlilik özeti | Must | S7 | Yapılacak |
| US-111 | E11 | Kullanıcı olarak fotoğraflarımı ve üzerimde üretilen görselleri silerim | `Ayarlar.dc.html` "Fotoğraflarımı ve üretilen görselleri sil"; hesap silmeden bağımsız; S3 nesneleri + türetilmiş görseller + kayıtlar silinir; onay ekranı (UX). **Kabul testi:** silme sonrası eski imzalı URL'ler de çalışmaz | Must | S2 | Yapılacak |
| US-112 | E11 | Kullanıcı olarak hesabımı ve tüm verimi uygulamadan ve web'den silerim | "Hesabımı sil"; tüm tenant verisi + S3; başkalarının akışındaki puan/takip kayıtları da temizlenir | Must | S8 | Yapılacak |
| US-113 | E11 | Kullanıcı olarak bildirim türlerini ayrı ayrı açıp kapatırım | Sabah kombin hatırlatması, Haftanın edit'i, Arkadaş puanları | Should | S7 | Yapılacak |
| US-120 | E12 | Ziyaretçi olarak landing'de ürünü ve yasal metinleri görürüm | Landing, Kullanım Koşulları, Gizlilik Politikası, KVKK aydınlatma (hukuk kontrolü ürün sahibinde) | Must | S9 | Yapılacak |
| US-121 | E12 | Kullanıcı olarak web'den hesap silme talebi veririm | Google Play kuralı; US-112 ile aynı silme akışı | Must | S9 | Yapılacak |
| US-122 | E12 | Ürün sahibi olarak mağaza listelerini ve yaş derecelendirmesini onaylarım | TR + EN metinler, ekran görüntüleri, gizlilik etiketleri (fotoğraf, AI işleme), yaş derecelendirmesi A-5'e göre | Must | S9 | Yapılacak |
| US-123 | E12 | Beta kullanıcısı olarak TestFlight / Play kapalı test ile uygulamayı alırım | Beta büyüklüğü ürün sahibinde; North Star ölçümü açık | Must | S9 | Yapılacak |

**Her projede E0'da bulunması gereken temel hikâyeler** (kabul kriterleri projeye göre yazılır):
- Giriş (platformun zorunlu kıldığı sağlayıcılar dahil; iOS'ta başka sosyal giriş varsa Apple zorunlu)
- Navigasyon iskeleti; her ekranda boş / yükleniyor / hata / çevrimdışı / başarı
- i18n ilk günden — tüm metinler çeviri dosyalarında
- Temel olay ölçümü (§8)
- Hesap ve tüm verinin uygulamadan **ve web'den** silinmesi (Google Play kuralı)
- Ayarlar, geri bildirim, SSS
- Dark mode ve erişilebilirlik: Dynamic Type / font ölçeği, VoiceOver / TalkBack etiketleri, kontrast ≥ 4.5:1, 44 pt / 48 dp dokunma alanı
- Bildirim izni: önce kendi açıklama ekranımız, sonra sistem izni; Android 13+ `POST_NOTIFICATIONS`; reddedilince akış devam eder
- (Abonelik varsa) paywall'da fiyat, dönem, deneme ve yenileme koşulları; Restore Purchases her zaman görünür; doğrulama sunucuda; abonelik bitince veri kaybolmaz

Droblet'te bunların karşılığı: giriş US-011, navigasyon US-001, i18n US-002, olaylar US-003, silme US-111/US-112/US-121, ayarlar US-006, erişilebilirlik US-004 (dark mode A-9), bildirim izni US-005, paywall US-100–US-102.

---

## 4. Yol haritası ve sprint planı

Sabit tarih yok. Her sprint sonunda gerçek telefonda demo ve ürün sahibi onayı. Her sprint runnable bir çıktı ve kısa bir demo notuyla biter.

| Sprint | Handoff | Hedef | Demo edilebilir çıktı | Kritik yol |
|---|---|---|---|---|
| **S0** Hazırlık | Tasarım sistemi | Repo ve altyapı iskeleti, tasarım token'ları, i18n, analitik sarmalayıcı, hata raporlama; en büyük teknik belirsizlik için deneme; bileşen vitrini. Droblet: **try-on ve parça işleme denemeleri** (aday sağlayıcılar, kalite + görsel başı maliyet + süre tablosu); özel S3 bucket | Telefonda iskelet uygulama; deneme raporu + karar | ⚠️ Mağaza, SES başvuruları; ⚠️ A-3 kararı; A-9, A-10 |
| **S1** Backend çekirdeği | 01–04 | Kimlik, kullanıcı/profil, çekirdek domain, yetki altyapısı. Droblet: Apple/Google/e-posta, stil ve beden profili, fotoğraf yükleme, `VisibilityPolicy` ve `EntitlementPolicy` iskeleti | Telefonda giriş; çekirdek verinin ham hali; onboarding uçtan uca | ⚠️ A-5 (Genç segmenti) |
| **S2** Gardırop | 10–13, 29 (fotoğraf silme) | E2: gardırop, parça detayı, ItemProcessor (tek + toplu), onay akışı; US-111 fotoğraf silme | Telefonda 10 kıyafet çek → onayla → gardırop; fotoğraf silme | ItemProcessor kalitesi; A-4 kararı sprint sonuna |
| **S3** Look'lar + günün kombini | 06, 14–17 | E3; Stylist worker (günlük kombin + 3 öneri); Bugün ekranı, hava, "Bunu giyiyorum" | Hava + ortama göre öneri; giyim kaydı | Hava sağlayıcısı (A-4) |
| **S4** Try-on + plan | 07, 09 | E6 (look/öneri try-on), haftalık plan, takvim, sabah bildirimi | Kendi fotoğrafında look; 7 günlük plan | ⚠️ TryOn kalite/maliyet; kota alarmı |
| **S5** Bavul + palet | 18–19, 30 | E5 bavul; E7 renk paleti ve gardırop uyumu | Londra bavulu örneğinin gerçek dolapla üretimi; palet sonucu | A-2, A-7 kararları sprint sonuna |
| **S6** Keşfet ve mağaza | 08, 20–24 | E8: haftanın edit'i, mağaza, ürün + try-on, kombin oluşturucu, sepet → marka sitesi | Edit'ten sepete, sepetten marka sitesine | ⚠️ Katalog verisi (A-2) |
| **S7** Sosyal + profil | 25–28 | E9 (takip, profil, akış, puan, görünürlük), US-110, US-113 | İki hesapla görünürlük matrisi demosu | A-6, A-5 (gençlerde sosyal) |
| **S8** Üyelik + silme | 05, 29 | E10 paywall, deneme, restore, sunucu doğrulama, ücretsiz sınırlar; US-112 hesap silme | Sandbox satın alma; sınırda paywall; hesap silme | ⚠️ A-1 fiyat ve sınırlar; mağaza ürünleri |
| **S9** Lansman hazırlığı | — | E12: landing, yasal sayfalar, web hesap silme, mağaza listeleri, kapalı beta dağıtımı | Mağaza incelemesine gönderilebilir aday | Hukuk kontrolü; mağaza incelemesi |
| **Beta** | — | Hata düzeltme, kapalı beta (**büyüklük ürün sahibinde**) | Beta başladı; ilk hafta North Star | |

### Kritik yol

```
S0 try-on denemesi ──► A-3 karar (sağlayıcı + görsel başı maliyet) ──► S4 TryOn ──► S6 ürün try-on ──► S8 ücretsiz sınır (A-1) ──► beta
S0 parça işleme denemesi ──► S2 ItemProcessor ──► S3 Stylist (dolu gardırop) ──► S5 bavul + palet uyumu
S1 A-5 kararı (Genç 13–18) ──► S1 onboarding segmenti ──► S7 sosyal kısıtları ──► S9 yaş derecelendirmesi
S1 özel S3 + VisibilityPolicy ──► S2 fotoğraf silme ──► S7 sosyal okumalar
S2 sonu A-4 (hava) ──► S3 Bugün + Stilist ──► S5 bavul hava tahmini
S5 sonu A-2 (katalog) + A-7 (edit içeriği) ──► S6 mağaza + edit ──► eksik parça önerisi
S0 mağaza hesapları + abonelik ürünleri ──► S8 satın alma ──► S9 gönderim
```

### Handoff yol haritasından ve mimarisinden farkı

| Konu | Handoff | Bu plan | Neden |
|---|---|---|---|
| Mimari | Tasarım mimari önermez; brif ekibin yığınını kullanır | Aynı — fark yok | — |
| Alt gezinme | Tasarım sistemi "5 sekme" der; bazı ekranlarda alt menüde 4 etiket görünür (Bugün · Gardırop · Keşfet · Profil) | 5 sekme, Stilist ortada (brif §2) | Brif ve tasarım sistemi bölümü bağlayıcı |
| Keşfet | Editör / Mağaza / Influencer / Arkadaşlar / Dizi outfitleri | MVP'de Editör / Mağaza / Arkadaşlar | İçerik hakları ve lisans açık (A-7) → BACKLOG |
| Takvim "Rapor" | 09'da düğme var | MVP'de yok | Önce giyim kaydı verisi birikmeli → BACKLOG |
| Sosyal keşif | Rehberden bul, sana benzeyen dolaplar, stil uyumu %, influencer dolapları | MVP'de kullanıcı adıyla arama + takip | A-8 açık; eşleştirme algoritması beta verisi ister → BACKLOG |
| "Look'u satın al" / "N ürünü satın al" | Satın al düğmeleri | Sepete ekler, ödeme marka sitesinde | Brif §5.4: Droblet ödeme almaz |
| Dark mode | Tasarımda yok | E0 şablonu dark mode ister; A-9 kararına kadar yalnız açık tema token'ları | Açık karar |
| Eksik ekranlar | Şifre sıfırlama, parça düzenle/sil, bildirim izni ön ekranı, silme onayları, Genç onay akışı yok | UX tasarlar, onaya sunar | E0/E1/E11 gereği |

### Riskli bağımlılıklar

- **Mağaza hesapları ve uygulama içi ürünler** (vergi/banka, deneme teklifleri) satın alma sprintini bekletebilir; S0'da başlatılır.
- **SES sandbox'tan çıkış ve SMS sağlayıcısı** onaylanmazsa giriş yalnız Apple/Google ile demo edilir.
- **AI sağlayıcısı (A-3):** S0 sonunda karar çıkmazsa S4 try-on kayar; paywall'ın ilk faydası etkilenir.
- **Katalog kaynağı (A-2) ve edit içeriği (A-7):** S5 sonuna kadar çıkmazsa S6 boş katalogla demo edilir; eksik parça önerisi gizlenir.
- **Genç segmenti (A-5):** hukuk görüşü S1 başına yetişmezse beta'da Genç seçeneği kapalı tutulması önerilir (ürün sahibi onaylar).
- **Hava sağlayıcısı (A-4):** S3 Bugün ekranını bekletir.

---

## 5. Teknik kararlar listesi

Ekip standardı olan kararlar her projede geçerlidir; projeye özel kararlar altına eklenir.

| # | Konu | Karar | Gerekçe | Durum |
|---|---|---|---|---|
| T-01 | Backend | .NET 10 Lambda, Minimal API, FluentValidation, Serilog, xUnit | Ekip standardı | Mevcut |
| T-02 | Veri | **DynamoDB** tek tablo; tenant anahtarıyla izolasyon, `tenant#{tenantId}#…`; global veri ayrı bölümlerde | Ekip standardı | Mevcut |
| T-03 | Altyapı | AWS SAM, GitHub Actions, `eu-central-1`, SSM | Ekip standardı | Mevcut |
| T-04 | Mobil | React Native (Expo), TS strict, TanStack Query, NativeWind, `expo-secure-store` | Ekip standardı | Mevcut |
| T-05 | Kimlik | JWT + refresh; sağlayıcılar projeye göre (iOS'ta sosyal giriş varsa Apple zorunlu) | Mağaza kuralı | Droblet: Apple + Google + e-posta/şifre (02); telefon/SMS girişi yok. Tasarımdan, 2026-11-18 |
| T-06 | Asenkron işler | SQS + worker Lambda'ları; Api 202 döner, mobil sorgular | Api 30 sn timeout | Ekip standardı |
| T-07 | Çevrimdışı | TanStack Query kalıcı önbellek + mutasyon kuyruğu; native extension'lar yalnız yerel önbellekten okur | Ekip standardı | Ekip standardı |
| T-08 | Çakışma | Tekrar gönderilebilen yazmalar idempotent (`clientMutationId`); düzenlenebilir alanlar `version` ile, 409 + güncel kayıt | Birden çok cihaz + çevrimdışı | Ekip standardı |
| T-09 | Senkron sıklığı | Periyodik yenileme (ön plan + açık ekran); WebSocket yok | Ekip standardı | Ekip standardı |
| T-10 | E-posta | `IEmailService` iki uygulamalı: **SES** (varsayılan) ve **SMTP**; seçim SSM'de | Ekip standardı | Ekip standardı |
| T-11 | AI çıktısı (AI varsa) | Model önerir, sunucu doğrular (şema + kural); kullanıcı onayı olmadan kalıcı veriye yazılmaz; sağlayıcı/model/kota SSM'de | AI hata yapabilir | Ekip standardı |
| T-12 | Yetki (paket varsa) | Yetki politikası Domain'de tek yerde, kural tabanlı ve birim testli; sayısal sınırlar SSM'de; istemci yalnız sunucunun verdiği yetkiyi gösterir | Hata ya gelir kaybı ya güven kaybı | Ekip standardı |
| T-13 | Kimlikler | Bundle id / package, scheme, alan adı | Mağaza kaydından sonra değişmez | Açık karar — ürün sahibi (A-10), S0 |
| T-14 | Tenant | Kullanıcı = tenant, rol yok; başka tenant'ın verisi yalnız `VisibilityPolicy` ile okunur | Brif §4; sosyal özellikler | Tasarımdan, 2026-11-18 |
| T-15 | Worker'lar | `ItemProcessor`, `Stylist`, `TryOn`, `Palette` (her biri kendi SQS kuyruğu + DLQ); `Notifier` EventBridge ile | Brif §4; T-06 | Tasarımdan, 2026-11-18 |
| T-16 | Fotoğraf depolama | Boy/yüz/parça fotoğrafları ve try-on çıktıları **özel S3** bucket'ında, tenant önekli anahtarlar; erişim yalnız sahibine kısa ömürlü imzalı URL; CDN / herkese açık önbellek yok; try-on ve palet çıktıları hiçbir zaman global önbelleğe girmez | Gizlilik vaadi 1 | Tasarımdan, 2026-11-18 |
| T-17 | Fotoğraf silme | "Fotoğraflarımı ve üretilen görselleri sil" hesap silmeden bağımsız bir akış; orijinaller + türetilmiş görseller + kayıtlar | Gizlilik vaadi 2 | Tasarımdan, 2026-11-18 |
| T-18 | Parça taslağı | ItemProcessor `ItemDraft` üretir; kullanıcı onayıyla `Item` olur (T-11'in Droblet uygulaması); temizlenmiş görsel taslakla birlikte saklanır | 12–13 "Kaydetmeden önce her parçayı kontrol et" | Tasarımdan, 2026-11-18 |
| T-19 | AI sağlayıcıları | Try-on, görsel işleme, öneri ve palet sağlayıcıları; arayüz arkasında, SSM'den seçilir; seçim ölçütü kalite + görsel başı maliyet + veri saklamama | Maliyet ve gizlilik | Açık karar — ürün sahibi (A-3), S0 sonu |
| T-20 | Hava durumu | Sağlayıcı ve konum izni / şehir seçimi | Bugün, Stilist, bavul | Açık karar — ürün sahibi (A-4), S2 sonu |
| T-21 | Katalog ve ödeme | Katalog global veri; uygulama içinde ödeme yok, sepet marka sitesine dış link; kaynak ve affiliate | Brif §5.4 | Ödeme kararı tasarımdan (2026-11-18); kaynak Açık karar — ürün sahibi (A-2) |
| T-22 | Abonelik | StoreKit 2 / Play Billing doğrudan, sunucu doğrulama; aylık + yıllık + ücretsiz deneme; fiyat ve sınırlar | Paywall (05) | Yapı tasarımdan (2026-11-18); fiyat/sınır Açık karar — ürün sahibi (A-1) |
| T-23 | Dil ve pazar | TR + EN; ₺ | Brif §1 | Tasarımdan, 2026-11-18 |
| T-24 | Native widget | MVP'de native widget extension yok | Brif ve tasarımda yok | Tasarımdan, 2026-11-18 |
| T-25 | Dark mode | Tasarımda yok | E0 şablonu ister | Açık karar — ürün sahibi (A-9), S0 |
| T-26 | Rehber eşleşmesi | Kişi listesinin sunucuya gidip gitmeyeceği (hash'li eşleşme) | KVKK | Açık karar — ürün sahibi (A-8); MVP'de yok |

---

## 6. Riskler

| # | Risk | Olasılık | Etki | Önlem |
|---|---|---|---|---|
| R-1 | **Try-on AI maliyeti** — görsel başı maliyet yüksek; "sınırsız üzerimde gör" vaadi abonelik gelirini aşabilir | Yüksek | Yüksek | S0 denemesinde görsel başı maliyet tablosu; aynı (kullanıcı, fotoğraf, look) için kullanıcıya özel sonuç önbelleği; günlük kullanıcı başı tavan (SSM) "sınırsız" metnine rağmen kötüye kullanımı keser (ürün sahibi onaylar); sağlayıcı panelinde sert limit; kill switch |
| R-2 | **Try-on kalitesi** — beden/kalıp yanlış, yüz bozulması, güven kaybı | Yüksek | Yüksek | Değerlendirme seti (farklı beden ve ten); "AI önizleme" etiketi (17); kalite eşiği tutmazsa try-on yerine düz look gösterilir |
| R-3 | **Parça tanıma ve arka plan temizleme kalitesi** — yanlış kategori/renk kullanıcıyı yorar, gardırop dolmaz | Orta | Yüksek | Taslak + onay akışı; düşük güvenli alan uyarısı ("Kategoriyi kontrol et"); alan bazlı düzeltme oranı ölçülür (§8); elle giriş her zaman mümkün |
| R-4 | **13–18 yaş + KVKK** — reşit olmayanın fotoğrafı, sosyal görünürlük, veli onayı; boy/yüz fotoğrafının hassasiyeti | Orta | Yüksek | A-5 hukuk görüşü S1 başı; karar yoksa beta'da Genç seçeneği kapalı (öneri); açık rıza metni 04'te; mağaza yaş derecelendirmesi |
| R-5 | **Katalog kaynağı** — feed yoksa mağaza, edit, eksik parça ve palet ürünleri boş kalır | Orta | Orta | A-2 S5 sonu; katalog bölümleri veri yokken gizlenir; çekirdek değer (gardırop + Stilist + bavul) katalogsuz çalışır |
| R-6 | **Fotoğraf gizliliği** — imzalı URL sızıntısı, yanlış görünürlük, global önbelleğe karışma, AI sağlayıcısında saklama | Düşük | Yüksek | T-16/T-17; kısa ömürlü URL; `VisibilityPolicy` dışında başka-tenant okuması yok (kod incelemesi); sağlayıcı sözleşmesinde veri saklamama şartı (A-3); silme testleri |
| R-7 | **Başka tenant'ın verisinin sızması** (sosyal) | Düşük | Yüksek | Tek `VisibilityPolicy`; 3 ayar × 3 izleyici test matrisi; Security Engineer incelemesi |
| R-8 | **İçerik hakları** — editör/influencer görselleri, dizi outfitleri | Orta | Orta | A-7; MVP'de yalnız hakkı net editör içeriği |
| R-x | **Mağaza incelemesi** (abonelik metinleri, sosyal giriş, hesap silme) | Orta | Orta | Paywall kuralları; lansman sprintinde tampon |
| R-x | **SMS OTP maliyeti ve dolandırıcılık** (SMS pumping; telefon girişi varsa) | Orta | Orta | Hız sınırı, ülke izin listesi, harcama alarmı (SECURITY_ENGINEER.md). Droblet'te telefon girişi yok → şu an geçersiz |
| R-x | **AI maliyeti bütçeyi aşar** (AI varsa) | Düşük | Orta | Kota; sağlayıcı panelinde sert limit; çağrı alarmı; kill switch. Droblet'te try-on nedeniyle olasılık R-1'de yükseltildi |

---

## 7. Ritüeller ve iletişim

Geliştirmeyi tek bir ajan (Claude) yaptığı için ritüeller hafif:

| Ritüel | Ne zaman | Çıktı |
|---|---|---|
| Sprint başlangıcı | Sprint'in ilk oturumu | Sprint hedefi + seçilen hikâyeler + gerekiyorsa ürün sahibine sorular |
| Sözleşme | Her epic'ten önce | Uç nokta şekilleri BACKEND_ENGINEER.md'ye yazılır |
| Tasarım onayı | Eksik ekran gereken sprintten önce | Taslaklar ürün sahibine sunulur |
| AI değerlendirme | Prompt/model değişikliğinde | Doğruluk + maliyet tablosu |
| Sprint demo | Sprint sonu | **Ürün sahibi iki gerçek telefonda** (iOS + Android) dener; onay ya da düzeltme listesi |

**Karar alma:** Ürün kararları ve teknik yığına ekleme kararları ürün sahibinde. Claude, bu dosyadaki ya da handoff'taki açık bir konuda kendi başına karar vermez; varsayımını yazar ve sorar ("ask, don't guess").

**İlerleme:** Backlog bu dosyada; durum `Yapılacak / Devam / İncelemede / Bitti`. Ürün sahibi onayı olmadan `Bitti` yok. Kodda tamamlanan her hikâye, iki gerçek telefonla demo onaylanana kadar `İncelemede`dir.

---

## 8. Başarı metrikleri

| Metrik | Tanım | Beta hedefi |
|---|---|---|
| **North Star** | Haftalık giyinen kullanıcı (öneri — ürün sahibi onaylar): haftada en az bir gün `wear_logged` ya da `outfit_accepted` olan tekil kullanıcı; tanım §Özet | **[ürün sahibi belirler]** |
| Tutma | D7 / D30 | **[ürün sahibi belirler]** |
| Dönüşüm, iptal (ücretli ürünse) | Paywall görüntüleme → deneme → ücretli; deneme sonu iptal | Ölçülür |
| Gardırop aktivasyonu | İlk 7 günde ≥ N parça ekleyen kullanıcı oranı (N ürün sahibinde) | Ölçülür |
| AI taslak doğruluğu | Onaylanan taslaklarda alan bazında düzeltilmeden kabul oranı (tür, renk, kumaş) | Ölçülür |
| Öneri kabulü | `outfit_suggested` → `outfit_accepted` oranı | Ölçülür |
| Try-on | Başarı oranı, p95 süre, kullanıcı başı haftalık sayı, görsel başı maliyet | Ölçülür; maliyet tavanı A-3 ile |
| Onboarding fotoğrafı | 04'te boy / yüz fotoğrafı ekleyen oranı | Ölçülür |
| Marka yönlendirme | `checkout_redirect` / `cart_added` | Ölçülür |

Olaylar (kendi analitiğimiz: mobil → Api → DynamoDB, TTL'li; rapor betikle; üçüncü taraf SDK yok). Parametrelerde ad, e-posta, fotoğraf, serbest metin yok:

- Onboarding: `onboarding_step{step}` · `signup{method}` · `login{method}` · `style_profile_saved{segment,budget,tagCount}` · `body_profile_saved{hasBodyPhoto,hasFacePhoto,skipped}`
- Gardırop: `item_capture_started{mode}` (`single|bulk`) · `item_draft_ready{mode,latencyMs,confidence}` · `item_draft_confirmed{fieldsEdited}` · `item_draft_discarded{reason}` · `item_deleted{}`
- Look: `look_created{occasion,slotCount,source}` (`wardrobe|store|mixed`) · `look_favorited{}`
- Bugün ve plan: `today_viewed{hasOutfit}` · `wear_logged{source}` (`today|calendar`) · `week_planned{days}` · `day_suggest_requested{occasion}` · `calendar_viewed{month}`
- Stilist: `outfit_suggest_requested{occasion,onlyWardrobe}` · `outfit_suggested{count,latencyMs}` · `outfit_accepted{occasion,via}` (`calendar|wear`) · `missing_item_shown{}`
- Bavul: `packing_created{days,tripType,cabinOnly}` · `packing_item_checked{}` · `packing_viewed{}`
- Try-on: `tryon_requested{target}` (`look|suggestion|product|packing`) · `tryon_completed{target,latencyMs,cached}` · `tryon_failed{reason}` · `tryon_blocked{reason}` (`noPhoto|limit`)
- Palet: `palette_requested{}` · `palette_completed{season,matchPct}`
- Keşfet ve mağaza: `edit_viewed{week}` · `product_viewed{brand,source}` · `cart_added{brand,source}` · `checkout_redirect{brand,itemCount}`
- Sosyal: `follow{source}` · `unfollow{}` · `look_rated{score}` · `profile_viewed{relation}` · `invite_shared{}` · `visibility_changed{to}`
- Üyelik: `paywall_viewed{source}` · `trial_started{plan}` · `purchase{plan}` · `restore{result}` · `entitlement_blocked{feature}`
- Gizlilik: `photos_deleted{scope}` · `account_deleted{}` · `notification_pref_changed{type,enabled}`

---

## Verilen kararlar

Sormadan yeniden açılmaz.

| # | Konu | Karar |
|---|---|---|
| 1 | Ekip | Tüm geliştirme rollerini Claude üstlenir; teknik yığın ekibin yığınıdır |
| 2 | Platformlar | iOS + Android mobil uygulama (Expo); web yalnız landing, yasal sayfalar, web hesap silme |
| 3 | Dil ve pazar | Uygulama TR + EN; pazar Türkiye, para birimi ₺ |
| 4 | Hedef segment | Onboarding'de Kadın · Erkek · Genç (13–18); Genç segmentinin kuralları A-5 |
| 5 | Görsel yön ve ton | Tasarım sistemi token'ları (krem zemin, Cormorant Garamond + Jost); "Sakin, editoryal, kişisel", sen dili, kısa cümleler; büyük harf stil ile verilmez, metin kaynakta yazılır |
| 6 | Gezinme | 5 sekme: Bugün · Gardırop · Stilist (orta) · Keşfet · Profil; Gardırop alt sekmeleri Parçalar / Looklar / Bavullar |
| 7 | Giriş | Apple, Google, e-posta + şifre |
| 8 | Paketler | Droblet Üyelik: aylık + yıllık, ücretsiz deneme; fiyatlar ve deneme süresi A-1 |
| 9 | Premium yetenekler | Sınırsız "üzerimde gör", kişisel stil danışmanı (günlük kombin), akıllı bavul, renk paleti analizi (05) |
| 10 | Ödeme | Mağaza ürünlerinin ödemesi Droblet'te alınmaz; marka sitesine yönlendirilir; sepet markaya göre gruplanır |
| 11 | Fotoğraf gizliliği | Boy/yüz fotoğrafları ve try-on çıktıları yalnız sahibine açık; hiçbir görünürlük ayarında paylaşılmaz; istenince hesap silmeden bağımsız silinir |
| 12 | AI taslağı | AI'ın algıladığı parça alanları kullanıcı onayı olmadan gardıroba kaydedilmez |
| 13 | Dolap görünürlüğü | Herkese açık / Yalnızca takipçiler / Gizli — kullanıcı seçer; varsayılan A-6 |
| 14 | North Star | Haftalık giyinen kullanıcı — **öneri, ürün sahibi onaylar** |
| 15 | MVP kapsamı | Influencer içerikleri, Dizi outfitleri, rehberden bul, sana benzeyen dolaplar / stil uyumu %, takvim raporu, web profili MVP dışı (BACKLOG) — **öneri, ürün sahibi onaylar** |

Paket/yetki matrisi (birebir uygulanır; sunucuda `EntitlementPolicy`, istemcide yalnız sunucunun verdiği yetki):

| Yetenek | Free | Droblet Üyelik |
|---|---|---|
| Gardırop: parça ekleme (tek + toplu, AI taslağı) | Var; parça / toplu işlem sınırı Açık karar — ürün sahibi (A-1) | Var; sınır A-1 |
| Look oluşturma, lookbook, favoriler | Paywall'da yok → Free'de var varsayımı, A-1 ile teyit | Var |
| "Üzerimde gör" (try-on) | Sınırlı mı, hiç mi: Açık karar — ürün sahibi (A-1) | **Sınırsız** (kötüye kullanım tavanı R-1) |
| Kişisel stil danışmanı (günlük kombin, Stilist önerisi, haftalık plan) | Açık karar — ürün sahibi (A-1) | Var |
| Akıllı bavul | Açık karar — ürün sahibi (A-1) | Var |
| Renk paleti analizi | Açık karar — ürün sahibi (A-1) | Var |
| Bugün, giyim kaydı, takvim | Paywall'da yok → Free'de var varsayımı, A-1 ile teyit | Var |
| Keşfet, haftanın edit'i, mağaza, sepet | Paywall'da yok → Free'de var varsayımı, A-1 ile teyit | Var |
| Sosyal (takip, akış, puanlama) | Paywall'da yok → Free'de var varsayımı, A-1 ile teyit (gençlerde A-5) | Var |
| Fotoğraf silme, hesap silme, veri | Her zaman var | Her zaman var |
| Abonelik bitince | Veri silinmez; Free sınırları uygulanır | — |

## Hâlâ açık olanlar

Sorulur, tahmin edilmez. Kapanan kararlar üstü çizilir ve karar yanına yazılır.

| # | Konu | Ne zamana |
|---|---|---|
| A-1 | ~~Fiyatlar, deneme süresi~~ **Kapandı 2026-11-18:** fiyat ve deneme mağazadan gelir; temsili aylık ₺199,99 / yıllık ₺1.499,99 / 7 gün; ayda 30 AI görseli; ek paket temsili 20 görsel ₺79,99. Ücretsiz pakette AI yok (brief) | Gerçek TL kademeleri mağaza ürünleri açılınca |
| A-2 | Gelir modeli **kapandı 2026-11-18:** affiliate ağı **ve** doğrudan marka anlaşması; katalog admin panelinden. **Açık:** katalog güncelleme yöntemi (elle / marka feed'i) | S5 sonu |
| A-3 | **Kapandı 2026-11-18:** metin GPT-6 Astra, görsel GPT Image 2.5 Sunburst. **Açık:** arka plan temizleme çözümü; görsel başı maliyet ve veri saklama koşulları spike'ta ölçülür | S0 sonu (deneme raporuyla) |
| A-4 | Hava durumu sağlayıcısı; konum izni mi şehir seçimi mi | S2 sonu |
| A-5 | **Faz 1 için kapandı (brief):** yalnız Kadın; Genç = faz 1b, ebeveyn hesabı zorunlu, profil varsayılan gizli | Faz 1b öncesi |
| A-6 | Dolap görünürlüğünün varsayılanı; profil/look'ların web'de paylaşılabilir linki | S7 başı (varsayılan); web linki V2 |
| A-7 | **Kısmen kapandı (brief):** influencer'larla anlaşma yok, gerçek isim yayında kullanılmaz. **Açık:** editör içeriği kaynağı, "Dizi outfitleri" lisansı | S5 sonu |
| A-8 | Rehberden arkadaş bulma: kişi listesi sunucuya gidecek mi (hash'li eşleşme) | V1.5 öncesi (MVP'de yok) |
| A-9 | **Kapandı (brief):** faz 1'de karanlık mod yok; token'lar sonradan eklemeye uygun | — |
| A-10 | **Kapandı 2026-11-18:** bundle id / package `com.alatech.droplet`, scheme `droplet`, alan adı `droblet.alatech.co`. Ürün adı "Droblet" ile yazım farkı mağaza kaydından önce teyit edilmeli | S0 (mağaza kaydı) |
| A-11 | North Star tanımının onayı (öneri: haftalık giyinen kullanıcı) | S1 (olaylar yazılmadan) |
| A-12 | MVP kapsam önerisinin onayı (BACKLOG'a ertelenenler) | S0 |
| A-13 | Sabah kombin hatırlatmasının varsayılan saati | S4 |

---

## Yol haritası — MVP sonrası

Ayrıntılar [BACKLOG.md](BACKLOG.md)'de.

| Sürüm | Özellik |
|---|---|
| V1.5 | Influencer içerikleri ve dolapları, rehberden arkadaş bul, sana benzeyen dolaplar + stil uyumu %, takvim raporu, gardırop istatistikleri derinleştirme, kombin hatırlatmasında takvim ortamı |
| V2 | Dizi outfitleri, web profili / paylaşılabilir look linki, ana ekran widget'ı (günün kombini), ikinci el / kullanılmayan parça önerisi, marka iş ortaklıkları |

---

## Tech Context

| Bileşen | Teknoloji |
|---|---|
| Mobil | React Native (Expo) + TypeScript; gerekirse native extension'lar; StoreKit / Play Billing |
| Backend API | .NET 10 Lambda (C#) — `Api` |
| Asenkron işler | .NET 10 Lambda worker'ları (SQS) |
| Bildirimler | .NET 10 Lambda — `Notifier` + Firebase Cloud Messaging |
| Veritabanı | AWS DynamoDB (tek tablo) |
| E-posta / SMS | AWS SES / SMTP · SMS sağlayıcısı projeye göre |
| Altyapı | AWS SAM / CloudFormation, `eu-central-1` |
| Kimlik | JWT + projeye göre sağlayıcılar |
| Landing | Next.js statik export |

Droblet'e özel:

| Bileşen | Değer |
|---|---|
| Worker Lambda'lar | `ItemProcessor` (`item-process-request`), `Stylist` (`stylist-request`), `TryOn` (`tryon-request`), `Palette` (`palette-request`); `Notifier` (EventBridge) |
| Fotoğraf depolama | Özel S3 bucket (tenant önekli, imzalı kısa ömürlü URL, CDN yok) |
| Kimlik sağlayıcıları | Apple, Google, e-posta + şifre (SES); SMS yok |
| AI sağlayıcısı | Açık karar — ürün sahibi (A-3) |
| Hava durumu | Açık karar — ürün sahibi (A-4) |
| Katalog | Açık karar — ürün sahibi (A-2) |
| Alan adı, bundle id, scheme | Açık karar — ürün sahibi (A-10) |
| Native widget | MVP'de yok |
