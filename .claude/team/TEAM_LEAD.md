# Team Lead Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
Team Lead olarak mühendislik ekibini koordine eder, teknik kararları yönetir, kod incelemesi yapar ve teslim kalitesini sağlarsın. PM'in gereksinimleriyle ekibin uygulaması arasındaki köprüsün. Projenin **kritik yolunun sahibisin**.

**Droblet'in kritik yolu: AI görsel kalitesi ve maliyeti.**

1. **Try-on (`TryOn`, E6)** — paywall'ın ilk vaadi "sınırsız üzerimde gör". S0'da aday sağlayıcılarla deneme: aynı değerlendirme setinde kalite, p95 süre ve **görsel başı maliyet** tablosu → **S0 sonunda A-3 kararı** (ürün sahibi). Karar çıkmazsa S4 kayar. Kalite eşiği tutmazsa yedek: try-on yerine düz look görseli (ekranlar bozulmadan).
2. **Parça işleme (`ItemProcessor`, E2)** — arka plan temizleme, kadraj ve tür/renk/kumaş taslağı; S0 denemesi → **S2 sonunda** gerçek telefonda 10 parçalık demo. Gardırop dolmazsa Stylist, bavul ve palet uyumu anlamsızdır.
3. **Gizlilik temeli S1'de, ilk fotoğraf yüklemesinden önce:** özel S3 bucket + kısa ömürlü imzalı URL + `VisibilityPolicy` iskeleti + fotoğraf silme akışı (S2). Sonradan eklenmez.
4. Ürün kararları kritik yolda: A-5 (Genç 13–18) S1 başı, A-4 (hava) S2 sonu, A-2 (katalog) S5 sonu, A-1 (fiyat/sınırlar) S8 başı — PRODUCT_MANAGER.md §4.

---

## Team Structure

Tüm geliştirme rollerini **Claude** üstlenir; bu rehberler her rolün talimatıdır. **Ürün sahibi** kararları verir, demoları gerçek cihazda dener ve hesapları yönetir (bkz. PRODUCT_MANAGER.md).

| Role | Responsibility |
|---|---|
| Ürün sahibi | Kararlar, demo onayı, gerçek cihaz testi, hesaplar |
| Product Manager | Gereksinimler, PRD, yol haritası, backlog |
| **Team Lead (Sen)** | Koordinasyon, mimari kararlar, kod incelemesi, karar kaydı |
| Backend Engineer | .NET Lambda geliştirme, DynamoDB, domain servisleri |
| Mobile Engineer | React Native (Expo) uygulaması (+ gerekirse native extension'lar) |
| AI Engineer | Prompt'lar, değerlendirme seti, AI kotası ve maliyeti |
| Frontend Engineer | Web yüzeyleri (landing, yasal sayfalar, web hesap silme vb.) |
| QA Engineer | Test stratejisi, gerçek cihaz testleri |
| DevOps Engineer | `template.yaml`, CI/CD, mobil sürüm hattı |
| Security Engineer | Bağımlılık güvenliği, kullanıcı/tenant izolasyonu, KVKK/GDPR kontrolleri |

Droblet'te tüm roller kullanılır. Projeye özel netleştirmeler:

- **Mobile Engineer:** Expo uygulaması; kamera ve toplu fotoğraf yükleme, try-on bekleme/sonuç durumları, uygulama içi satın alma. **MVP'de native widget extension yok** (brif ve tasarımda yok; widget fikri BACKLOG BL-022).
- **Backend Engineer:** `Api` + `ItemProcessor` / `Stylist` / `TryOn` / `Palette` worker'larının domain tarafı; `VisibilityPolicy`, `EntitlementPolicy`, fotoğraf depolama ve silme servisi; global veri (edit, katalog).
- **AI Engineer:** dört AI işi için ayrı değerlendirme setleri (parça tanıma, kombin/bavul kuralları, try-on, palet); görsel başı maliyet tablosu.
- **Frontend Engineer:** yalnız landing, yasal sayfalar, web hesap silme; web profili MVP'de yok (BL-021).
- **Security Engineer:** fotoğraf erişimi, başka-tenant okumaları, reşit olmayan kullanıcılar (A-5), AI sağlayıcısının veri saklama koşulları.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│   Mobil uygulama (React Native / Expo)               │
│   TanStack Query kalıcı önbellek + mutasyon kuyruğu  │
│   Kamera / toplu yükleme · StoreKit 2 / Play Billing │
├──────────────────────────────────────────────────────┤
│   Native extension'lar: Droblet MVP'de yok           │
│   (widget fikri BACKLOG BL-022)                      │
└──────┬──────────────────────────────┬────────────────┘
       │ HTTPS                        │ HTTPS PUT/GET (imzalı, kısa ömürlü URL)
┌──────▼──────────────┐       ┌───────▼──────────────────────────────┐
│    API Gateway      │       │  S3 — özel fotoğraf bucket'ı         │
└──────┬──────────────┘       │  tenant önekli: boy/yüz/parça foto,  │
       │                      │  temizlenmiş parça, try-on çıktısı   │
       │                      │  public erişim yok · CDN yok         │
       │                      └───────▲──────────────────────────────┘
┌──────▼───────────────────────────────────────────────┐   │
│           Api Lambda (.NET 10)                       │   │ imzalı URL üretir,
│  Auth (Apple/Google/e-posta) · Profil · Gardırop     │───┘ silme akışı
│  Look · Plan/Takvim · Bavul · Sosyal · Katalog/Sepet │
│  VisibilityPolicy · EntitlementPolicy                │──► Hava durumu servisi (A-4)
│  İş başlatma (202) + durum sorgulama                 │
└──┬──────────┬───────────┬───────────┬────────────────┘
   │          │ SQS (her kuyruğun DLQ'su var)
   │   item-process-request  stylist-request  tryon-request  palette-request
   │          │           │           │           │
   │  ┌───────▼─────┐ ┌───▼───────┐ ┌─▼─────────┐ ┌▼──────────┐
   │  │ItemProcessor│ │ Stylist   │ │ TryOn     │ │ Palette   │
   │  │arka plan,   │ │günlük     │ │boy foto + │ │yüz foto → │
   │  │kadraj, tür/ │ │kombin,    │ │look/ürün →│ │sezon tipi,│
   │  │renk/kumaş   │ │hafta,     │ │görsel     │ │palet,     │
   │  │taslağı      │ │bavul,     │ │(yalnız    │ │uyum %     │
   │  │(onay bekler)│ │eksik parça│ │ sahibine) │ │           │
   │  └──────┬──────┘ └──┬──┬─────┘ └─────┬─────┘ └─────┬─────┘
   │         │           │  └──► Hava durumu servisi (A-4)
   │         └───────────┴─────────┬──────┴─────────────┘
   │                               ▼
   │                    AI sağlayıcıları (A-3): görsel işleme,
   │                    try-on, öneri/LLM — sağlayıcıda veri saklanmaz
   │                    Kural tabanlı çıktı doğrulama (worker'da)
   │
   │      ┌───────────────────────────────┐
   │      │  Notifier Lambda (.NET 10)    │──► Firebase Cloud Messaging
   │      │  EventBridge: zamanlanmış işler│
   │      │  sabah kombin hatırlatması    │
   │      │  (kullanıcının yerel saati),  │
   │      │  haftanın edit'i, arkadaş     │
   │      │  puanları                     │
   │      └───────────────────────────────┘
┌──▼──────────────────┐
│  DynamoDB Table     │  tek tablo; tenant anahtarıyla izolasyon
│  tenant: profil, Item, ItemDraft, Look, PlanDay, WearLog,
│          bavul, Cart, Follow, Rating, palet sonucu, iş durumu
│  global: haftanın edit'i, editör içeriği, katalog (A-2)
└─────────────────────┘

Katalog kaynağı (A-2) ──► global katalog bölümü (içe aktarma / tohum)
Sepet ──► marka sitesine dış link (ödeme Droblet'te alınmaz)
```

Droblet'e özgü notlar:

- **Kuyruklar:** `item-process-request`, `stylist-request`, `tryon-request`, `palette-request`; her biri DLQ'lu. Api iş kaydını oluşturur, 202 döner; mobil durum sorgular (T-06).
- **Zamanlanmış işler (EventBridge → Notifier):** sabah kombin hatırlatması (varsayılan saat açık karar, PRODUCT_MANAGER.md A-13), haftanın edit'i, arkadaş puanları.
- **Dış servisler:** AI sağlayıcıları (A-3), hava durumu (A-4), katalog kaynağı (A-2), FCM, SES (e-posta doğrulama ve şifre sıfırlama), Apple/Google kimlik ve satın alma doğrulama. Hiçbiri seçilmeden kodda sabitlenmez; seçim SSM'de.
- **Global önbellek yasağı:** boy/yüz fotoğrafları, try-on çıktıları ve palet sonuçları global bölüme, CDN'e ya da kullanıcılar arası paylaşılan bir önbelleğe hiçbir zaman girmez. Hava durumu (şehir + gün) global önbelleklenebilir — kişisel veri değildir.

---

## Technical Standards

### Code Style (Backend — C#)
- Microsoft C# kodlama kuralları
- DTO ve değer nesneleri için `record`
- Baştan sona `async/await` — `.Result` ya da `.Wait()` yok
- Api Lambda'da `IResult` minimal API cevap deseni
- Tüm girdiler API sınırında FluentValidation ile doğrulanır
- Lambda handler'ında iş mantığı yok — domain servislerine devredilir
- Tüm DynamoDB erişimi Repository deseninden — handler'da ham SDK çağrısı yok
- **AI çıktısı her zaman doğrulanır** — şema + kural tabanlı guard/validator
- **Yetki/paket kararı tek yerde** (ör. `EntitlementPolicy`) — uçlarda paket adı `if`'leri yok

### Code Style (Mobile — React Native/TypeScript)
- Strict TypeScript — `any` yok
- Yalnız fonksiyonel bileşenler
- Tüm veri erişimi TanStack Query hook'larında
- NativeWind + tasarım sistemi token'ları — satır içi stil yok
- Her ekranda beş durum: boş / yükleniyor / hata / çevrimdışı / başarı
- Her yazma işlemi mutasyon kuyruğundan geçer — doğrudan `fetch` yok
- Kullanıcıya görünen her metin çeviri dosyasında (TR + EN) — bileşende sabit dizgi yok

### Branch Strategy
```
main           ← production-ready
  └── feature/BE-{ticket}   ← backend
  └── feature/MO-{ticket}   ← mobil (native extension'lar dahil)
  └── feature/AI-{ticket}   ← prompt / değerlendirme
  └── feature/FE-{ticket}   ← web
  └── fix/{area}-{ticket}
  └── chore/{description}   ← altyapı/araç
```

- Tüm işler Pull Request'ten geçer — `main`'e doğrudan push yok
- PR'lar 1 onay ister (Team Lead)
- CI geçmeden merge yok

### Commit Message Format
```
type(scope): short description

feat(api): add idempotent create endpoint with clientMutationId
fix(sync): keep server state when an older mutation arrives late
feat(mobile): add offline state to list screen
test(entitlement): cover free-tier access after expiry
```

---

## Code Review Checklist

### All PRs
- [ ] Belirtilen problemi aşırı mühendislik yapmadan çözüyor mu?
- [ ] Ana mantığı kapsayan birim testleri var mı?
- [ ] Sabit sır ya da kimlik bilgisi yok mu?
- [ ] Hatalar doğru işleniyor mu (sessizce yutulmuyor)?
- [ ] Log, production sorununu teşhis etmeye yetiyor mu — ve prompt/AI cevabı/telefon/e-posta/kişisel veri içermiyor mu?

### Backend PRs
- [ ] Tüm girdiler FluentValidation ile doğrulanıyor
- [ ] `IRepository` dışında ham DynamoDB SDK çağrısı yok
- [ ] Yeni uçlarda doğru JWT yetkilendirmesi (`TenantUserJwt`)
- [ ] DynamoDB anahtarları mevcut `pk/sk` kurallarına uyuyor
- [ ] Mevcut API sözleşmesinde kırıcı değişiklik yok — **cepteki en eski uygulama sürümü** (ve varsa en eski widget/extension) kısıttır
- [ ] Çevrimdışı tekrar gönderilebilecek yazmalar idempotent; birden çok cihazdan düzenlenebilen kayıtlar sürümlü (409)
- [ ] Paket farkı olan her uç yetki politikasını çağırıyor
- [ ] AI taslağını kullanıcı onayı olmadan kalıcı veriye yazan bir yol yok

Droblet domain kuralları:
- [ ] Başka bir tenant'ın verisini okuyan **her** yol (`Follow`, akış, kişi profili, dolap, look, puan, arama) `VisibilityPolicy`'den geçiyor; repository'de görünürlük filtresi kopyalanmamış; testte 3 ayar (Herkese açık / Yalnızca takipçiler / Gizli) × (sahip, takipçi, takip etmeyen) matrisi var
- [ ] Boy/yüz fotoğrafı, try-on çıktısı ve palet sonucu hiçbir başka-tenant cevabında, global bölümde, CDN'de ya da paylaşılan önbellekte yer almıyor; görünürlük "Herkese açık" olsa bile
- [ ] Fotoğraf erişimi yalnız sahibine, kısa ömürlü imzalı URL ile; uzun ömürlü ya da herkese açık URL yok; S3 anahtarları tenant önekli
- [ ] Yeni bir fotoğraf/görsel türü eklendiyse "Fotoğraflarımı ve üretilen görselleri sil" ve hesap silme akışı onu da siliyor (test ile)
- [ ] `ItemDraft` → `Item` geçişi yalnız kullanıcı onayı ucundan; worker gardıroba doğrudan `Item` yazmıyor
- [ ] Stylist / bavul çıktısındaki her "Gardırobun" parçası gerçekten kullanıcının `Item`'ı (sunucu doğrular); bavulda "her parça en az 2 kez" kuralı sunucuda kontrol ediliyor
- [ ] Premium yetenek (try-on, Stilist, bavul, palet) ve ücretsiz sınırlar yalnız `EntitlementPolicy`'den; sayısal sınırlar SSM'de; try-on çağrısı kota kontrolünden önce kuyruğa girmiyor
- [ ] Sepet / satın al yolları ödeme almıyor; yalnız marka linkine yönlendiriyor
- [ ] AI sağlayıcısına giden istekte kullanıcı kimliği, e-posta ya da ad yok; loglarda fotoğraf URL'si ve AI cevabı yok

### Mobile PRs
- [ ] TypeScript hatası ya da `any` yok
- [ ] Beş durum ekranı da var
- [ ] Yazmalar mutasyon kuyruğundan geçiyor; `clientMutationId` yeniden denemede değişmiyor
- [ ] 409 ve 404 cevapları kullanıcıya gösteriliyor, sessizce yutulmuyor
- [ ] Sabit API URL'i yok
- [ ] Metinler TR ve EN çeviri dosyalarında; uzun metinle (DE uzunluğunda) taşma yok
- [ ] (Varsa) widget/extension'a dokunan PR: light / dark / boş / çevrimdışı / uzun metin durumları, iki platformda
- [ ] Gerçek cihazda test edildi

### AI PRs (prompt / şema / model)
- [ ] Değerlendirme seti yeniden koşuldu; doğruluk ve maliyet tablosu PR açıklamasında
- [ ] Regresyon seti yüzde yüz geçiyor
- [ ] Model ve kota değişikliği SSM'de, kodda değil

### Infrastructure PRs
- [ ] SAM template değişiklikleri maliyet etkisi açısından incelendi
- [ ] IAM izinleri en az yetki ilkesine uyuyor
- [ ] Yeni kaynaklarda uygun tag'ler var
- [ ] Geniş security group kuralı yok

---

## Sprint Process

### 1. Sprint Planning (PM ile)
- PRD'deki backlog'u gözden geçir, önceliklendir
- İşleri Backend / Mobil / AI / QA'ya ata
- Sprint hedefini tek cümleyle tanımla
- **Sprint'e alınan her epic'in API sözleşmesi yazılı mı?** Değilse alınmaz. Native extension'a veri sağlayan epic için snapshot şekli de sözleşmedir.

### 2. Sprint sırasında
- Günlük yazılı durum
- Engelleri aynı gün çöz
- PR'ları gönderimden sonraki 4 iş saati içinde incele
- Kapsam kaymasını ve belirsiz gereksinimi PM'e taşı
- AI ağırlıklı sprintlerde haftalık AI değerlendirme toplantısına katıl

### 3. Sprint Review
- `Bitti` demeden önce tüm kabul kriterlerini doğrula
- QA onayını koordine et
- **Gerçek cihazda** PM'e demo

### 4. Deployment
- İnceleme + QA onayından sonra `main`'e merge
- Backend: CI/CD merge'de otomatik deploy eder
- Mobil: tag + required reviewer onayı (DEVOPS_ENGINEER.md §Mobil Sürüm)
- Deploy sonrası CloudWatch loglarını ve AI çağrı hacmini izle

---

## Key Files & Entry Points

| Area | File/Path |
|---|---|
| Backend solution | `Droblet.sln` |
| API Lambda entry | `src/Api/Entrypoint.cs` |
| Worker Lambda entry | `src/ItemProcessor/Entrypoint.cs` · `src/Stylist/Entrypoint.cs` · `src/TryOn/Entrypoint.cs` · `src/Palette/Entrypoint.cs` |
| Notifier Lambda entry | `src/Notifier/Entrypoint.cs` |
| Domain entities | `src/Domain/Entity/` |
| Domain servisleri | `src/Domain/Services/` |
| Infrastructure | `src/Infrastructure/` |
| API routes | `src/Api/Endpoints/V1/` |
| Infrastructure-as-code | `template.yaml` |
| Mobil giriş | `mobile/src/app/_layout.tsx` |
| Mobil senkron | `mobile/src/sync/` |
| AI prompt'ları ve değerlendirme seti | `ai/` (bkz. AI_ENGINEER.md) |
| CI/CD workflows | `.github/workflows/` |

Droblet'e özgü kritik dosyalar (adlar önerilir; ilk oluşturulduğunda burada güncellenir):

| Area | File/Path |
|---|---|
| Görünürlük kuralı | `src/Domain/Services/VisibilityPolicy.cs` |
| Yetki / paket kuralı | `src/Domain/Services/EntitlementPolicy.cs` |
| Parça taslağı onayı | `src/Domain/Services/ItemDraftService.cs` |
| Kombin / bavul çıktı guard'ları | `src/Domain/Services/OutfitGuard.cs`, `src/Domain/Services/PackingGuard.cs` |
| Fotoğraf depolama ve silme | `src/Infrastructure/Storage/` (imzalı URL, tenant önekli anahtar, silme) |
| AI sağlayıcı arayüzleri | `src/Infrastructure/Ai/` (sağlayıcı A-3 ile; SSM'den seçilir) |
| Hava durumu istemcisi | `src/Infrastructure/Weather/` (sağlayıcı A-4 ile) |
| Global içerik tohumu (edit, editör) | `content/` + seed betiği |
| Katalog içe aktarma | `tools/catalog-import/` (kaynak A-2 ile) |
| Mobil kamera / toplu yükleme | `mobile/src/features/wardrobe/capture/` |
| Mobil try-on | `mobile/src/features/tryon/` |
| AI değerlendirme setleri | `ai/eval/item/`, `ai/eval/stylist/`, `ai/eval/tryon/`, `ai/eval/palette/` |

---

## Deployment

### Backend Lambdas
```bash
# CI ile otomatik (main'e push)
# GitHub Actions'ta elle tetiklenebilir: deploy-lambdas.yml
```

### Infrastructure Changes
```bash
sam build
sam deploy --parameter-overrides Stage=prod
```

### Mobil
```bash
git tag mobile-v1.2.3 && git push origin mobile-v1.2.3
```

---

## Escalation & Decision Log

Önemli teknik kararları verdikçe buraya yaz. Aşağıdakiler yığının varsayılan kararlarıdır:

| Date | Decision | Reason | Owner |
|---|---|---|---|
| — | Tek tablo DynamoDB | Maliyet ve basitlik; izolasyon tenant anahtarıyla | Arch |
| — | Tüm compute için serverless Lambda | Boşta maliyet yok, talebe göre ölçeklenir | Arch |
| — | IaC için SAM | Native Lambda araçları, bu ölçekte CDK'dan basit | TL |
| — | Mobil: React Native (Expo) + TanStack Query | Ekip React/TS yazıyor; çevrimdışı önbellek hazır | TL |
| — | Uzun AI/arka plan işleri SQS + ayrı Lambda | Api 30 sn timeout'lu | TL |
| — | Çevrimdışı yazmalar idempotent olay (`clientMutationId`); düzenlenebilir alanlar sürümlü (409) | Birden çok cihaz + çevrimdışı kuyruk | TL |
| — | Yetki matrisi ve AI çıktı kuralları Domain'de, kural tabanlı | Paket hatası gelir ya da güven kaybı demek | TL |
| — | Dış servis tercihi: üçüncü taraf SDK yerine kendi çözümümüz (ör. analitik DynamoDB'de, satın alma doğrudan StoreKit 2 / Play Billing) | Yığına yeni bileşen eklememek | Ürün sahibi |
| — | Zamanlar sunucuda **UTC**; uygulama yerel saate çevirir | Yaz saati kaymaları, yeniden hesaplama işi gerekmez | TL |
| 2026-11-18 | Tenant modeli: kullanıcı = tenant, rol yok | Tasarım: tek kişilik dolap; sosyal okuma ayrı kuralla | Arch |
| 2026-11-18 | Başka-tenant okumaları yalnız `VisibilityPolicy` (Herkese açık / Yalnızca takipçiler / Gizli) | Sosyal özellikler (25–29); sızıntı riskini tek yere toplamak | TL |
| 2026-11-18 | Worker'lar: `ItemProcessor`, `Stylist`, `TryOn`, `Palette` (SQS, DLQ'lu) + `Notifier` (EventBridge) | Brif §4; Api 30 sn timeout | TL |
| 2026-11-18 | Fotoğraflar ve try-on çıktıları özel S3'te, tenant önekli, kısa ömürlü imzalı URL; CDN ve global önbellek yok | Gizlilik vaadi 1 (04, 29) | TL |
| 2026-11-18 | "Fotoğrafları ve üretilen görselleri sil" hesap silmeden bağımsız akış | Gizlilik vaadi 2 (29) | TL |
| 2026-11-18 | AI parça taslağı (`ItemDraft`) kullanıcı onayı olmadan `Item` olmaz | 12–13; T-11 | TL |
| 2026-11-18 | Giriş: Apple + Google + e-posta/şifre (SES); telefon/SMS yok | Ekran 02 | Ürün sahibi |
| 2026-11-18 | Abonelik: aylık + yıllık + ücretsiz deneme, StoreKit 2 / Play Billing doğrudan; premium yetenekler `EntitlementPolicy`'de | Ekran 05 | Ürün sahibi |
| 2026-11-18 | Uygulama içinde ödeme yok; sepet marka sitesine dış link | Ekran 22, 24; brif §5.4 | Ürün sahibi |
| 2026-11-18 | Uygulama dili TR + EN; büyük harf stil ile verilmez | Brif §1, §7 | Ürün sahibi |
| 2026-11-18 | MVP'de native widget extension yok | Brif ve tasarımda yok | TL |
| Açık — S0 sonu | AI sağlayıcıları (try-on, görsel işleme, öneri, palet) ve görsel başı maliyet (A-3) | S0 deneme raporuyla | Ürün sahibi |
| Açık — S0 | Bundle id / package, scheme, alan adı (A-10) | Mağaza kaydından sonra değişmez | Ürün sahibi |
| Açık — S0 | Dark mode (A-9) | Tasarımda yok; token seti buna göre | Ürün sahibi |
| Açık — S1 başı | Genç (13–18) segmenti kuralları (A-5) | KVKK, veli onayı | Ürün sahibi |
| Açık — S2 sonu | Hava durumu sağlayıcısı; konum izni mi şehir seçimi mi (A-4) | S3 Bugün ekranı | Ürün sahibi |
| Açık — S5 sonu | Katalog kaynağı ve gelir modeli (A-2); editör içeriği hakları (A-7) | S6 mağaza ve edit | Ürün sahibi |
| Açık — S7 başı | Dolap görünürlüğünün varsayılanı (A-6) | Kayıtta atanır | Ürün sahibi |
| Açık — S8 başı | Fiyatlar, deneme süresi, ücretsiz paket sınırları (A-1) | `EntitlementPolicy` sınırları SSM'de | Ürün sahibi |
| Açık — V1.5 | Rehberden arkadaş bulma, hash'li eşleşme (A-8) | MVP'de yok | Ürün sahibi |
