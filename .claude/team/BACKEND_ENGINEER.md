# Backend Engineer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
Droblet'in backend'ini oluşturan .NET 10 Lambda fonksiyonları sende: HTTP için `Api`, uzun işler için SQS ile tetiklenen `ItemProcessor`, `Stylist`, `TryOn` ve `Palette` Lambda'ları ve zamanlanmış işler için `Notifier`. Backend kod tabanı, DynamoDB şemasının evrimi, altyapı değişiklikleri, domain mantığı ve (varsa) **çevrimdışı senkronun sunucu tarafı** senin sorumluluğunda.

Ürün özeti ve ekranlar: [README.md](../_handoff/droblet-handoff/README.md), [SCREENS.md](../_handoff/droblet-handoff/SCREENS.md). Epic numaraları (E1–E12) ve açık kararlar (A-1…A-10) oradaki numaralarla kullanılır.

| Lambda | Tetikleyici | Görev |
|---|---|---|
| `Api` | API Gateway HTTP | Auth, profil, gardırop, look, plan/takvim, bavul, sosyal, katalog, sepet, yetki; uzun işleri başlatır ve durumunu döndürür |
| `ItemProcessor` | SQS `item-process-request` | Parça fotoğrafı → arka plan temizleme, kadraj, alan doldurma ve tür/renk/kumaş/sezon **önerisi** (taslak; kullanıcı onaylar) |
| `Stylist` | SQS `stylist-request` | Günlük kombin (3 öneri), haftalık plan, bavul listesi + günlük look'lar, eksik parça ("Parçamı tamamla") önerisi |
| `TryOn` | SQS `tryon-request` | "Üzerimde gör": parça / look / mağaza ürününü kullanıcının boy fotoğrafında görselleştirir; çıktı yalnız sahibine açıktır |
| `Palette` | SQS `palette-request` | Yüz fotoğrafından sezon tipi, yakışan ve kaçınılacak tonlar |
| `Notifier` | EventBridge Scheduler | Sabah kombin hatırlatması, haftanın edit'i, arkadaş puanları; abonelik yaşam döngüsü |

**Tenant modeli.** Kullanıcı verisi tenant bölümlerinde durur; kullanıcı izolasyonu `IApiContext.TenantId` ve `tenant#{tenantId}` anahtar kuralıyla sağlanır. Tek kullanıcılı üründe her hesap kayıtta kişisel bir tenant alır (kullanıcı = tenant); çok kullanıcılı üründe tenant bir organizasyon/hanedir. `my-tenants` / `switch-tenant` altyapısı her durumda kalır.

**Droblet'te tenant = tek kullanıcı.** Her hesap kayıtta (Apple / Google / e-posta) kişisel bir tenant alır; hane/organizasyon yok, **rol yok** — tenant'ın tek kullanıcısı her şeyinin sahibidir. `my-tenants` / `switch-tenant` altyapısı yerinde kalır ama istemci kullanmaz.

**Sosyal okumalar (E9) tek istisnadır** ve yalnız okumadır: bir kullanıcı başka bir tenant'ın verisini (look, dolap parçaları, geçmiş seyahatler, profil kartı) **yalnızca `VisibilityPolicy` üzerinden** okuyabilir. Politika sahibin dolap görünürlüğünü (`Public` = Herkese açık / `FollowersOnly` = Yalnızca takipçiler / `Private` = Gizli) ve okuyan ile sahip arasındaki takip ilişkisini değerlendirir. Başka bir tenant'ın partition'ını okuyan her kod yolu (uç, servis, sorgu) bu politikadan geçer; politikayı atlayan ikinci bir yol yazılmaz. Başka tenant'a **yazma** yalnız iki yerdedir: takip (karşı tarafın `follower` kaydı) ve puan (`Rating`) — ikisi de önce `VisibilityPolicy`'den geçer. Boy/yüz fotoğrafı, try-on görselleri, palet sonucu, beden profili, sepet, plan ve giyim kaydı **hiçbir görünürlük ayarında** başkasına açılmaz.

Genç (13–18) segmentinde yaş doğrulama, veli onayı ve sosyal/fotoğraf özelliklerinin kısıtlanması **Açık karar (A-5)**; karar verilene kadar `Teen` segmentli hesaplar keşif listelerine (`PublicProfileIndex`) girmez.

**Global veri ≠ kullanıcı verisi.** Tüm kullanıcıların okuduğu paylaşılan veri (katalog, içerik, referans veri) global bölümlerde, kullanıcıya ait veri tenant bölümlerinde durur.

| Global (tüm kullanıcılar okur, kullanıcı yazamaz) | Tenant (`tenant#{tenantId}#…`) |
|---|---|
| Haftanın edit'i (`Edit`) ve editör look'ları | Profil (`TenantEntity`: ad, @kullanıcı adı, dolap görünürlüğü) |
| Influencer/editör içerikleri (`Creator`, `CreatorLook`) — kaynak ve haklar Açık karar (A-7) | `StyleProfile` (segment, 3 stil etiketi, bütçe), `BodyProfile` (boy, kilo, beden) |
| Dizi outfitleri (`SeriesOutfit`) — lisans Açık karar (A-7) | Fotoğraflar (`Photo`: boy, yüz — özel S3) |
| Mağaza kataloğu (`Brand`, `CatalogProduct`: ürün, fiyat, beden, satış linki) — kaynak Açık karar (A-2) | Parçalar (`Item`), parça taslakları (`ItemDraft`) |
| Referans veri: renk sözlüğü, sezon tipleri, şehirler | Look'lar (`Look`), look puan özeti, aldığı puanlar (`Rating`) |
| Hava tahmini önbelleği (`WeatherForecast`, şehir + gün; sağlayıcı Açık karar A-4) | Plan günleri (`PlanDay`), giyim kaydı (`WearLog`) |
| AI önbelleği: **yalnız global girdiden** üretilenler — katalog ürünü görselleri (arka planı temizlenmiş), katalog ürünü öznitelikleri, edit/creator look'larının flat-lay görselleri | Bavullar (`Trip`, `TripItem`, `TripDay`) |
| `@kullanıcı adı` → tenant dizini (`Handle`), keşif dizini (`PublicProfileIndex`) — yalnız işaretçi, içerik değil | Sepet (`CartLine`), takip (`Following`/`Follower`), verdiği puanlar (`RatingGiven`) |
| | Palet sonucu (`PaletteResult`), try-on görselleri (`TryOnImage`), işler, kotalar, yetki |

Kullanıcının fotoğrafından türeyen hiçbir şey (parça görseli, try-on çıktısı, palet) global bölüme ya da global önbelleğe girmez.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | .NET 10 / C# |
| Hosting | AWS Lambda |
| API Framework | ASP.NET Core Minimal APIs |
| Database | AWS DynamoDB (single-table) |
| Messaging | AWS SQS, SNS |
| Scheduling | AWS EventBridge Scheduler |
| Config | AWS SSM Parameter Store |
| Auth | JWT Bearer + Google OAuth + Apple + e-posta/telefon OTP |
| Validation | FluentValidation |
| Logging | Serilog |
| Testing | xUnit |
| IaC | AWS SAM (`template.yaml`) |
| AI | `IAiProvider` arkasında tek sağlayıcı — ölçümle seçilir (bkz. [AI_ENGINEER.md](AI_ENGINEER.md)) |
| Email | `IEmailService` — `SesEmailService` (varsayılan) ve `SmtpEmailService`; seçim SSM `Email.Provider` |
| SMS | `ISmsService` — telefon OTP; sağlayıcı ülke önekine göre yönlendirilebilir |
| Push | `IPushProvider` — Firebase Cloud Messaging HTTP v1 |
| In-app purchase (proje gerektirirse) | StoreKit 2 / Google Play Billing — doğrulama sunucuda (`IPurchaseVerifier`), dış servis yok |

**Droblet'te dış servisler:**

| Alan | Durum |
|---|---|
| Giriş | Apple, Google, e-posta (ekran 02). E-posta girişi mevcut OTP akışıyla çalışır. Ekran 02'deki "Şifre" alanı yığının şifresiz (OTP) kararıyla çelişir → ürün sahibine sorulur; karar verilmeden şifre saklanmaz |
| SMS | **Yok** — telefonla giriş tasarımda yok. `Sms.Provider` boş kalır; telefon kanalı `503 sms_unavailable` döner. `ISmsService` arayüzü yerinde kalır |
| E-posta | `SesEmailService` (varsayılan) — OTP ve hesap e-postaları |
| AI — görsel işleme (arka plan temizleme, kadraj, alan doldurma), görsel tanıma (tür/renk/kumaş), try-on, LLM (stilist açıklamaları, kombin/bavul), yüz → palet | **Açık karar (A-3)** — sağlayıcı(lar) ve görsel başı maliyet. Hepsi `IAiProvider` arkasında, iş türüne göre ayrı yetenek arayüzleriyle (`IImageCleanup`, `IGarmentVision`, `ITryOnRenderer`, `IStylistModel`, `IPaletteAnalyzer`); seçim SSM'de |
| Hava durumu | `IWeatherProvider` — sağlayıcı ve konum izni / şehir seçimi **Açık karar (A-4)** |
| Mağaza kataloğu | `ICatalogSource` — marka feed'i / affiliate ağı / elle: **Açık karar (A-2)** |
| Satın alma | **Var** — Droblet Üyelik (aylık + yıllık, ücretsiz deneme): StoreKit 2 / Play Billing doğrudan, `IPurchaseVerifier`. Ürün ödemesi Droblet'te **alınmaz**; marka sitesine yönlendirilir |
| Dosya | Özel S3 kovası (kullanıcı fotoğrafları ve türevleri, yalnız presigned URL ile) + global görsel kovası (katalog/içerik görselleri) — `IObjectStorage` |
| Push | FCM HTTP v1 (`IPushProvider`) |

---

## Project Structure

```
src/
├── Api/                    # Lambda — HTTP API
│   ├── Entrypoint.cs
│   ├── Endpoints/V1/       # Route handlers (one class per endpoint)
│   │   ├── Auth/
│   │   ├── Catalog/        # global (salt okunur): marka, ürün
│   │   ├── Content/        # global (salt okunur): edit, creator, dizi outfitleri
│   │   ├── Weather/        # global önbellekli hava tahmini
│   │   └── Tenant/         # kullanıcı/tenant kapsamlı uçlar: {Resource}/
│   ├── Infrastructure/
│   │   ├── Contract/       # IEndpoint, GetPagedResponse
│   │   └── Extensions/     # StartupExtensions, ValidationExtensions
│   ├── Contracts/          # Shared request/response records + validators
│   └── appsettings.json
│
├── ItemProcessor/          # Lambda — SQS item-process-request: parça fotoğrafı → taslak
│   ├── Entrypoint.cs
│   └── Services/
├── Stylist/                # Lambda — SQS stylist-request: kombin, hafta, bavul, eksik parça
│   ├── Entrypoint.cs
│   └── Services/
├── TryOn/                  # Lambda — SQS tryon-request: üzerimde gör
│   ├── Entrypoint.cs
│   └── Services/
├── Palette/                # Lambda — SQS palette-request: yüz → renk paleti
│   ├── Entrypoint.cs
│   └── Services/
│
├── Notifier/               # Lambda — EventBridge: zamanlanmış bildirimler / işler
│   ├── Entrypoint.cs
│   └── appsettings.json
│
├── Domain/                 # Shared domain layer (no AWS dependencies)
│   ├── Entity/
│   │   └── Base/           # IEntity, IVersionedEntity
│   ├── Domain/             # DTOs, mappers, domain models, events
│   ├── Services/           # Domain service interfaces + saf kurallar (policy, validator, scheduler…)
│   ├── Manager/            # IRepository, IEventManager
│   ├── Context/            # IApiContext
│   ├── Options/
│   ├── Enum/               # JobStatus, … (domain enum'ları)
│   ├── Constant/           # DynamoDbConstant
│   └── Extensions/
│
└── Infrastructure/
    ├── Repository.cs
    ├── Manager/            # EventManager (SQS/SNS)
    ├── Context/            # ApiContext (reads tenantId from JWT)
    └── Services/
        └── Providers/      # IAiProvider implementasyonu, IPushProvider (FCM), ISmsService, IPurchaseVerifier

tests/
├── ApiTests/
├── DomainTests/
├── InfrastructureTests/
├── ItemProcessorTests/
├── StylistTests/
├── TryOnTests/
├── PaletteTests/
└── NotifierTests/
```

**`Endpoints/V1/Tenant/` kaynakları:** `Profile/`, `StyleProfile/`, `BodyProfile/`, `Photo/`, `Item/`, `ItemDraft/`, `Look/`, `Today/`, `PlanDay/`, `WearLog/`, `Stylist/`, `Trip/`, `TryOn/`, `Palette/`, `Cart/`, `People/` (sosyal okumalar — `VisibilityPolicy`), `Follow/`, `Feed/`, `Invite/`, `Job/`, `Entitlement/`, `User/` (cihaz, bildirim tercihleri), `Feedback/`, `Event/`.

**Worker Lambda'ları:** `ItemProcessor`, `Stylist`, `TryOn`, `Palette` (ayrıntı: §Lambda'lar — SQS).

**`Domain/Services` altındaki saf kurallar** (AWS'siz, birim testli; ayrıntı §3): `EntitlementPolicy`, `VisibilityPolicy`, `ItemDraftRules`, `OutfitSlotRules`, `PackingRules`, `PaletteCompatibilityRules`, `WardrobeMatchRules`, `StyleMatchRules`, `WearStatsRules`, `TryOnOutputPolicy`, `StylistOutputGuard`, `GarmentVisionGuard`, `PaletteOutputGuard`, `ReminderRules`.

**`Enum/`:** `Segment` (Women, Men, Teen) · `StyleTag` (Minimal, Classic, QuietLuxury, Street, Boho, Sporty, Romantic, OfficeChic, Colorful, Vintage) · `Budget` (HighStreet, Mixed, LuxuryTouch) · `ItemCategory` (Top, Bottom, Dress, Outerwear, Shoes, Bag, Accessory) · `Season` (Spring, Summer, Autumn, Winter) · `Occasion` (Office, Dinner, Weekend, Wedding, Travel, Sport) · `TripType` (Business, Dinner, Sightseeing) · `OutfitSlot` (Top, Bottom, Outerwear, Shoes, BagAccessory) · `ClosetVisibility` (Public, FollowersOnly, Private) · `PhotoKind` (Body, Face) · `ItemDraftStatus` (Uploaded, Processing, Ready, Failed) · `ItemSource` (Photo, CatalogProduct) · `LookSource` (Manual, Stylist, Builder) · `TryOnTargetKind` (Item, Look, Product, EditLook, Suggestion) · `JobKind` (ItemProcess, StylistOutfit, StylistWeek, StylistPack, StylistComplete, TryOn, Palette) · `JobStatus` · `JobFailure` (ProviderError, Timeout, GuardRejected, SourceDeleted, NoFaceDetected) · `Tier` (Free, Premium) · `Capability` (§Yetki) · `NotificationType` (MorningOutfit, WeeklyEdit, FriendRatings).

> Tasarımda Look ortamı "Akşam", Stilist ortamı "Akşam yemeği" yazıyor; tek `Occasion.Dinner` değeri öneriliyor — PM teyit eder. Sezon tipi kümesi (ör. "Sıcak Sonbahar") AI_ENGINEER.md'de sabitlenir ve global referans verisidir, enum değildir.

---

## Implementation Examples

Aşağıdaki örneklerde `ItemEntity` / `ActivityEventEntity` genel yer tutucudur; desen aynen uygulanır, adlar projenin domain'ine göre değişir. Droblet'te `ItemEntity` gardırop parçasıdır; gerçek alanları §DynamoDB Key Patterns'tedir (örnekteki `State`/`Note` yerine kategori, renk, kumaş, giyilme sayısı…). Olay deseni (`clientMutationId` + `occurredAt` + makbuz) Droblet'te `WearLogEntity` ("Bunu giyiyorum") ve bavul hazırlık işaretlemesinde kullanılır.

### 1. Entity

Tüm entity'ler `src/Domain/Entity/` altında ve `IEntity` uygular.

```csharp
// src/Domain/Entity/Base/IEntity.cs
public interface IEntity
{
    [JsonPropertyName("pk")] public string Pk { get; }
    [JsonPropertyName("sk")] public string Sk { get; }
}

// src/Domain/Entity/Base/IVersionedEntity.cs
// Aynı hesabın birden fazla cihazından (ya da istemcisinden) düzenlenebilen her entity bunu uygular.
public interface IVersionedEntity : IEntity
{
    [JsonPropertyName("version")] public long Version { get; set; }
}
```

**Global entity (UserEntity — pk tenant öneki taşımaz):**

```csharp
// src/Domain/Entity/UserEntity.cs
public class UserEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk();
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")]          public string  Id          { get; set; } = null!;
    [JsonPropertyName("tenantId")]    public string  TenantId    { get; set; } = null!;
    [JsonPropertyName("displayName")] public string? DisplayName { get; set; }
    [JsonPropertyName("email")]       public string? Email       { get; set; }            // telefonla girişte yok
    [JsonPropertyName("phone")]       public string? Phone       { get; set; }            // E.164
    [JsonPropertyName("createdAt")]   public DateTime CreatedAt  { get; set; }
    // Şifre alanı yok: giriş OTP, Apple ya da Google ile

    public static string GetPk() => "users";
    public static string GetSk(string id) => id;
}
```

> Telefonla giriş e-postasız hesap demek; bu yüzden kullanıcı anahtarı e-posta değil `id`'dir. Sağlayıcı kimliği → kullanıcı eşlemesi `AuthIdentityEntity`'dedir (§DynamoDB Key Patterns).

**Tenant kapsamlı, sürümlü entity (ItemEntity):**

```csharp
// src/Domain/Entity/ItemEntity.cs
public class ItemEntity : IVersionedEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(Id);

    [JsonPropertyName("id")]       public string Id       { get; set; } = null!;   // ULID, istemci üretir (çevrimdışı oluşturma için)
    [JsonPropertyName("tenantId")] public string TenantId { get; set; } = null!;

    // Sunucu kuralıyla hesaplanan durum — yalnız ilgili domain kuralı yazar
    [JsonPropertyName("state")]          public ItemState State          { get; set; }
    [JsonPropertyName("lastActivityAt")] public DateTime? LastActivityAt { get; set; }

    // Kullanıcının düzenlediği alan
    [JsonPropertyName("note")] public string? Note { get; set; }

    [JsonPropertyName("version")]   public long     Version   { get; set; }
    [JsonPropertyName("updatedAt")] public DateTime UpdatedAt { get; set; }

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#item";
    public static string GetSk(string id) => id;
}
```

**TTL'li, zaman sıralı entity (ActivityEventEntity):**

```csharp
// src/Domain/Entity/ActivityEventEntity.cs
public class ActivityEventEntity : IEntity
{
    [JsonPropertyName("pk")] public string Pk => GetPk(TenantId);
    [JsonPropertyName("sk")] public string Sk => GetSk(OccurredAt, Id);

    [JsonPropertyName("id")]               public string   Id               { get; set; } = null!;
    [JsonPropertyName("tenantId")]         public string   TenantId         { get; set; } = null!;
    [JsonPropertyName("itemId")]           public string   ItemId           { get; set; } = null!;
    [JsonPropertyName("source")]           public string   Source           { get; set; } = null!;
    [JsonPropertyName("occurredAt")]       public DateTime OccurredAt       { get; set; }   // cihaz zamanı — çevrimdışı olay saatler sonra gelebilir
    [JsonPropertyName("clientMutationId")] public string   ClientMutationId { get; set; } = null!;

    // Ham olaylar sınırlı süre tutulur; süre KVKK/GDPR metnine girer.
    [JsonPropertyName("ttl")] public long Ttl => OccurredAt.AddDays(400).ToUnixTimeSeconds();

    public static string GetPk(string tenantId) => $"tenant#{tenantId}#activity";
    // Zaman sıralı sk: geçmiş sayfalaması ve "şu andan sonra ne oldu" sorgusu için
    public static string GetSk(DateTime occurredAt, string id) => $"{occurredAt.ToUnixTimeMilliseconds():D13}#{id}";
}
```

**Yeni entity kuralları:**
- Her zaman statik `GetPk()` / `GetSk()` yardımcıları — uç noktalar anahtarı entity oluşturmadan kurar
- Her özellikte `[JsonPropertyName]` — DynamoDB serileştirmesi buna bağlı
- Tenant kapsamlı entity'lerin `pk`'sinde `tenantId` bulunmalı
- Kendiliğinden silinecekse `long` döndüren `Ttl` özelliği (Unix saniye)
- **Birden fazla cihazdan düzenlenebilen entity `IVersionedEntity` uygular** — bkz. §Senkron ve çakışma

---

### 2. DTO / Mapper

DTO'lar `src/Domain/Domain/` altında; mapper'lar entity üzerinde statik extension metotlardır ve DTO ile aynı dosyada durur.

```csharp
// src/Domain/Domain/ItemDto.cs
public record ItemDto(
    string Id,
    ItemState State,
    DateTime? LastActivityAt,
    bool IsStale,              // hesaplanan alan örneği
    string? Note,
    long Version,
    DateTime UpdatedAt);

public static class ItemDtoMapper
{
    public static ItemDto ToDto(this ItemEntity entity, DateTime now) => new(
        entity.Id,
        entity.State,
        entity.LastActivityAt,
        entity.LastActivityAt is { } last && last < now.AddDays(-7),
        entity.Note,
        entity.Version,
        entity.UpdatedAt);
}
```

`now` dışarıdan verilir (`TimeProvider`); mapper saati kendisi okumaz — testte zaman sabitlenebilsin.

---

### 3. Domain Service Interface

Arayüzler `src/Domain/Services/` altında; AWS bağımlılığı yok.

```csharp
// src/Domain/Services/IActivityService.cs
public interface IActivityService
{
    Task<RecordActivityResult> RecordAsync(
        string tenantId,
        string itemId,
        string source,
        DateTime occurredAt,
        string clientMutationId,
        CancellationToken cancellationToken);
}
```

**Saf kurallar da burada yaşar** ve AWS'siz test edilir:

```csharp
// src/Domain/Services/ItemStateRules.cs
// Entity durumunu yalnız bu sınıf değiştirir — tüm istemciler aynı yoldan geçer.
public static class ItemStateRules
{
    public static ItemStateChange Next(ItemStateSnapshot current, ActivityInput input, DateTime occurredAt) { /* ... */ }
}

// src/Domain/Services/EntitlementPolicy.cs   (paket/yetki farkı varsa)
// Yetki matrisi burada, tek yerde. Sayısal sınırlar SSM'den gelir.
public static class EntitlementPolicy
{
    public static EntitlementDecision Check(Tier tier, Capability capability, UsageSnapshot usage, EntitlementLimits limits) { /* ... */ }
}
```

**Droblet'in saf kuralları ve değişmezleri:**

| Kural | Değişmez |
|---|---|
| `EntitlementPolicy` | Yetenek → paket matrisi yalnız burada (§Yetki ve satın alma). Premium: sınırsız try-on, günlük stilist, akıllı bavul, palet analizi. Ücretsiz paket sınırları **Açık karar (A-1)** — sayılar SSM'de, matris kodda. Abonelik bitince veri silinmez; yalnız yeni iş başlatma kısıtlanır |
| `VisibilityPolicy` | `CanView(viewer, owner, relation, resource)`. Sahip = okuyan → her şey. Başkası için: `Item`, `Look`, geçmiş `Trip` → `Public` ise her oturum açmış kullanıcı, `FollowersOnly` ise yalnız sahibi takip eden, `Private` ise kimse. `BodyPhoto`, `FacePhoto`, `TryOnImage`, `PaletteResult`, `BodyProfile`, `CartLine`, `PlanDay`, `WearLog`, gelecek tarihli `Trip` → **her zaman false**. Profil kartı (ad, @kullanıcı adı, stil etiketleri) `Public`/`FollowersOnly`'de görünür; `Private` hesabın aramada görünüp görünmeyeceği **Açık karar (A-6)**. Politika her istekte güncel görünürlük + takip kaydıyla çağrılır (önbelleklenmiş karar yok) |
| `ItemDraftRules` | AI önerisi `Item`'a yalnız kullanıcı onayıyla dönüşür. Onay isteği her taslak için kullanıcının son hâlini (kategori, en az bir renk zorunlu; kumaş, sezon, beden, ad opsiyonel) taşır — sunucu AI alanını kendiliğinden kopyalamaz. Düşük güvenli işaretli taslak ("Kategoriyi kontrol et") yalnız `reviewed = true` ile onaylanabilir — "Tümünü seç" işaretli taslağı atlar. Onay tek transaction: makbuz + `Item` + taslağın silinmesi; aynı `clientMutationId` ikinci `Item` üretmez. `Failed` taslak elle doldurularak onaylanabilir (kural tabanlı yedek = boş alanlar) |
| `OutfitSlotRules` | 5 slot: `Top` (Üst), `Bottom` (Alt), `Outerwear` (Dış giyim), `Shoes` (Ayakkabı), `BagAccessory` (Çanta / Aksesuar). Slot başına en fazla bir parça; parçanın kategorisi slotla eşleşmeli (`Dress` → `Top` slotuna yerleşir ve `Bottom`'ı kapatır — tasarımda açık değil, PM teyit eder). Slot kaynağı yalnız **kendi `Item`'ı** ya da **katalog ürünü**; başka tenant'ın parçası slota giremez. Kaydetmek için en az bir dolu slot; daha yüksek alt sınır PM kararı |
| `PackingRules` | Bavul listesindeki **her parça seyahatin günlük look'larında en az 2 kez** kullanılır ("Her parça en az 2 kez giyiliyor") — sabit koddadır, config değildir. Her seyahat gününün bir look'u vardır; günlük look'lar yalnız bavul listesindeki parçalardan oluşur; `cabinOnly` ise parça sayısı `Packing.CabinMaxItems`'ı aşamaz (değer Açık karar — ürün sahibi). 1 günlük seyahatte "en az 2 kez" kuralının davranışı tanımsız → PM kararı |
| `PaletteCompatibilityRules` | Gardırop uyum oranı (%64) **AI değil**, deterministik hesaptır: parçanın ana rengi global renk sözlüğü üzerinden palet sonucundaki "yakışan" ailelerle eşleşirse uyumlu, "kaçınılacak" ailelerle eşleşirse uyumsuz. İkisine de düşmeyen (nötr) parçaların paya/paydaya katılımı AI_ENGINEER.md ile sabitlenir. Okumada hesaplanır; saklanmaz. "Uyumsuz parçaları gör" aynı kuraldan liste döner |
| `WardrobeMatchRules` | "Gardırobundaki 7 parçayla uyumlu": ürün ↔ parça uyumu kategori tamamlayıcılığı + renk uyum tablosu (global referans veri) ile kural tabanlı hesaplanır; AI çağrılmaz |
| `StyleMatchRules` | "%82 stil uyumu": iki kullanıcının stil etiketleri ve dolap öznitelikleri (kategori/renk dağılımı) üzerinden kural tabanlı; yalnız okuyanın görebildiği (`VisibilityPolicy`) veriyle hesaplanır. Formül PM/AI_ENGINEER ile yazılı sabitlenir |
| `WearStatsRules` | Giyilme sayısı ve "en çok giyilen" yalnız `WearLog` olaylarından türetilir; aynı gün aynı parça iki kez sayılmaz; silinen olay sayıyı geri alır |
| `TryOnOutputPolicy` | Try-on çıktısı: yalnız sahibinin S3 önekine yazılır, yalnız sahibine kısa ömürlü presigned GET ile verilir, `VisibilityPolicy`'de hiçbir izin yolu yoktur, global önbelleğe **asla** girmez, kaynak boy fotoğrafı silinince silinir. Worker çıktıyı yalnız kaynak boy fotoğrafı yazma anında hâlâ aktifse kaydeder |
| `GarmentVisionGuard` | ItemProcessor çıktısı: kategori/renk/kumaş/sezon değerleri enum ve global renk sözlüğünde olmalı; güven eşiği altı alan işaretlenir (silinmez, uydurulmaz) |
| `StylistOutputGuard` | Stylist çıktısındaki her `itemId` tenant'ta var ve silinmemiş; her `productId` katalogda ve `retired` değil; `wardrobeOnly = true` ise ürün yok; her öneri `OutfitSlotRules`'tan geçer; bavul `PackingRules`'tan geçer; açıklama uzunluğu sınırlı |
| `PaletteOutputGuard` | Sezon tipi global sezon tipi listesinde; tonlar renk sözlüğünde; yakışan ve kaçınılacak listeleri kesişmez |

---

### 4. Infrastructure Service Implementation

Implementasyonlar `src/Infrastructure/Services/` altında ve `IRepository`'ye bağlı. Örnek: idempotent + sürümlü, eşzamanlılıkta yeniden deneyen olay kaydı.

```csharp
// src/Infrastructure/Services/ActivityService.cs
public class ActivityService : IActivityService
{
    private const int MaxVersionRetries = 3;
    private readonly IRepository _repository;

    public ActivityService(IRepository repository)
    {
        _repository = repository;
    }

    public async Task<RecordActivityResult> RecordAsync(
        string tenantId, string itemId, string source,
        DateTime occurredAt, string clientMutationId, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < MaxVersionRetries; attempt++)
        {
            var item = await _repository.GetAsync<ItemEntity>(
                ItemEntity.GetPk(tenantId), ItemEntity.GetSk(itemId), cancellationToken);

            if (item == null) return RecordActivityResult.NotFound;

            // 1. Çevrimdışı istemciden geç gelen eski bir olay yazılır ama durumu geri saramaz
            if (occurredAt > (item.LastActivityAt ?? DateTime.MinValue))
                item.Apply(ItemStateRules.Next(item.ToSnapshot(), ActivityInput.From(source), occurredAt));

            var activity = ActivityEventEntity.Create(tenantId, itemId, source, occurredAt, clientMutationId);
            var receipt  = new MutationReceiptEntity { TenantId = tenantId, ClientMutationId = clientMutationId };

            // 2. Makbuz + olay + entity tek transaction'da — aynı olay iki kez uygulanamaz
            var outcome = await _repository.SaveWithReceiptAsync(receipt, [activity, item], cancellationToken);

            switch (outcome)
            {
                case TransactOutcome.Applied:          return RecordActivityResult.Applied(item);
                case TransactOutcome.DuplicateReceipt: return RecordActivityResult.AlreadyApplied;
                // 3. Başka bir cihaz aynı kaydı aynı anda değiştirdi: olay olduğu için kullanıcıya 409 gösterilmez — yeniden oku, yeniden uygula
                case TransactOutcome.VersionConflict:  continue;
            }
        }

        throw new InvalidOperationException($"Activity {clientMutationId} could not be applied after {MaxVersionRetries} attempts.");
    }
}
```

---

### 5. IRepository Usage

DynamoDB'ye **tek** erişim yolu `IRepository`'dir. Handler'larda ya da servislerde AWS SDK doğrudan kullanılmaz.

```csharp
// src/Domain/IRepository.cs
public interface IRepository
{
    // Single item
    Task<bool>  SaveAsync(IEntity entity, CancellationToken ct = default);
    Task<T?>    GetAsync<T>(string pk, string sk, CancellationToken ct = default) where T : new();
    Task<bool>  DeleteAsync(string pk, string sk, CancellationToken ct = default);

    // Collection queries
    Task<List<T>> GetAllAsync<T>(string pk, CancellationToken ct = default);
    Task<List<T>> GetAllAsync<T>(string pk, string sk, SkOperator op, CancellationToken ct = default);

    // Pagination
    Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(
        string pk, string? pagedToken, int? limit, CancellationToken ct = default);
    Task<(List<T> entities, string? pageToken, long count)> GetPagedAsync<T>(
        string pk, SkOperator op, string? sk, string? pagedToken, int? limit, CancellationToken ct = default);

    // Batch
    Task BatchWriteAsync(List<IEntity> itemList, CancellationToken ct = default);
    Task BatchWriteAsync(List<IEntity> putItemList, List<IEntity> deleteItemList, CancellationToken ct = default);
    Task BatchDeleteAsync(List<IEntity> itemList, CancellationToken ct = default);
    Task BatchDeleteAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new();
    Task<List<T>> BatchGetAsync<T>(List<T> entities, CancellationToken ct = default) where T : IEntity, new();

    // GSI queries
    Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, CancellationToken ct = default);
    Task<List<T>> QueryGsiAsync<T>(DynamoDbConstant.IndexDefinition index, string gsiPk, string gsiSk, SkOperator op, CancellationToken ct = default);

    // Atomic operations
    Task<bool> AtomicIncrementInMapAsync(string pk, string sk, string mapAttributeName, string mapKey, int increment = 1, CancellationToken ct = default);

    // ── Çevrimdışı senkron / çok cihaz gerektiren projelerde ──
    // Koşullu yazım: kayıttaki version == expectedVersion ise yazar, version'ı +1 yapar; değilse false
    Task<bool> SaveIfVersionAsync(IVersionedEntity entity, long expectedVersion, CancellationToken ct = default);
    // Makbuz yoksa (attribute_not_exists) makbuzu ve öğeleri yazar; IVersionedEntity öğelerde okunan version koşulu
    // uygulanır ve +1 yapılır — tek TransactWriteItems. Hangi koşulun düştüğünü ayırt eder.
    Task<TransactOutcome> SaveWithReceiptAsync(IEntity receipt, IReadOnlyList<IEntity> items, CancellationToken ct = default);
}
```

Son iki metot mevcut deseni değiştirmez; SDK çağrısı yine yalnız `Repository.cs`'te kalır.

**Sık kullanım:**

```csharp
// Tenant'ın tüm kayıtları (küçük koleksiyon — tek partition, sayfalamaya gerek yok)
var items = await repository.GetAllAsync<ItemEntity>(
    ItemEntity.GetPk(tenantId), cancellationToken);

// Olay geçmişi, sayfalı, yeniden eskiye
var (events, nextPageToken, count) = await repository.GetPagedAsync<ActivityEventEntity>(
    ActivityEventEntity.GetPk(tenantId), pageToken, limit, cancellationToken);

// Kota sayacı: tenant başına aylık
await repository.AtomicIncrementInMapAsync(
    UsageEntity.GetPk(tenantId), UsageEntity.GetSk(UsagePeriod.Month(DateTime.UtcNow)),
    "counts", "aiJob", 1, cancellationToken);
```

---

### 6. Endpoint — GET (route param)

Her uç nokta `IEndpoint` uygulayan bir sınıftır. Bir dosya = bir HTTP metodu. Dosya yolu URL'i yansıtır.

```csharp
// src/Api/Endpoints/V1/Tenant/Item/Get.cs
public class Get : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var entity = await repository.GetAsync<ItemEntity>(
            ItemEntity.GetPk(apiContext.TenantId),
            ItemEntity.GetSk(id),
            cancellationToken);

        if (entity == null)
            return Results.NotFound();

        return Results.Ok(entity.ToDto(timeProvider.GetUtcNow().UtcDateTime));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/item/{id}", Handler)
            .Produces<ItemDto>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization("TenantUserJwt")
            .WithSummary("Get item")
            .WithDescription("Returns a single item of the current tenant.")
            .WithTags("Tenant Item");
    }
}
```

---

### 7. Endpoint — GET ALL

```csharp
// src/Api/Endpoints/V1/Tenant/Item/GetAll.cs
public class GetAll : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] TimeProvider timeProvider,
        CancellationToken cancellationToken)
    {
        var entities = await repository.GetAllAsync<ItemEntity>(
            ItemEntity.GetPk(apiContext.TenantId), cancellationToken);

        var now = timeProvider.GetUtcNow().UtcDateTime;
        return Results.Ok(entities.Select(x => x.ToDto(now)).ToList());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/item", Handler)
            .Produces<List<ItemDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization("TenantUserJwt")
            .WithSummary("Get items")
            .WithDescription("Returns all items of the current tenant. Filtered lists are built on the device.")
            .WithTags("Tenant Item");
    }
}
```

Koleksiyon küçükse ve zaten çevrimdışı önbellekte durması gerekiyorsa filtrelenmiş listeler cihazda kurulur; büyük koleksiyonlarda sayfalı uç (§8) kullanılır.

---

### 8. Endpoint — GET PAGED

```csharp
// src/Api/Endpoints/V1/Tenant/Activity/GetPaged.cs
public class GetPaged : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromQuery] string? pageToken,
        [FromQuery] int? limit,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        CancellationToken cancellationToken)
    {
        var (entities, nextPageToken, count) = await repository.GetPagedAsync<ActivityEventEntity>(
            ActivityEventEntity.GetPk(apiContext.TenantId), pageToken, limit, cancellationToken);

        return Results.Ok(new GetPagedResponse<ActivityEventDto>(
            entities.Select(x => x.ToDto()).ToList(), nextPageToken, count));
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapGet("v1/tenant/activity", Handler)
            .Produces<GetPagedResponse<ActivityEventDto>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization("TenantUserJwt")
            .WithSummary("Get activity history")
            .WithDescription("Returns the paged activity history, newest first.")
            .WithTags("Tenant Activity");
    }
}
```

---

### 9. Endpoint — POST (body + validation + kuyruk)

Uzun süren (ör. AI) iş: Api yetkiyi ve kotayı kontrol eder, işi kaydeder ve worker kuyruğuna koyar, sonucu beklemez.

```csharp
// src/Api/Endpoints/V1/Tenant/Job/Post.cs
public class Post : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromBody] CreateJobRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IRepository repository,
        [FromServices] IEventManager eventManager,
        [FromServices] IEntitlementService entitlementService,
        [FromServices] IAiQuotaService quotaService,
        [FromServices] IValidator<CreateJobRequest> validator,
        CancellationToken cancellationToken)
    {
        // 1. Validate
        var validationResult = await validator.ValidateAsync(request, cancellationToken);
        if (!validationResult.IsValid)
            return Results.BadRequest(validationResult.Errors.ToProblemDetails());

        // 2. Yetki — karar EntitlementPolicy'de
        var decision = await entitlementService.CheckAsync(apiContext.TenantId, Capability.AiJob, cancellationToken);
        if (!decision.Allowed)
            return Results.Problem(decision.Reason, statusCode: StatusCodes.Status403Forbidden);

        // 3. Kota ayrılır; worker başarısız olursa iade eder — başarısız çağrı kotadan düşmez
        if (!await quotaService.TryReserveAsync(apiContext.TenantId, AiJobKind.Default, request.RequestId, cancellationToken))
            return Results.Problem("monthly_limit_reached", statusCode: StatusCodes.Status429TooManyRequests);

        // 4. İşi kaydet
        var job = new JobEntity
        {
            Id        = request.RequestId,     // istemci üretir — aynı istek iki kez gönderilirse aynı iş
            TenantId  = apiContext.TenantId,
            Input     = request.Input,
            Status    = JobStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };
        await repository.SaveAsync(job, cancellationToken);

        // 5. Kuyruğa koy, 202 dön — istemci GET v1/tenant/job/{id} ile sorgular
        await eventManager.PublishAsync(new JobRequestedEvent(job.TenantId, job.Id), cancellationToken);
        return Results.Accepted($"/v1/tenant/job/{job.Id}", job.ToDto());
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPost("v1/tenant/job", Handler)
            .Produces<JobDto>(StatusCodes.Status202Accepted)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces<ProblemDetails>(StatusCodes.Status403Forbidden)
            .Produces<ProblemDetails>(StatusCodes.Status429TooManyRequests)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization("TenantUserJwt")
            .WithSummary("Create job")
            .WithDescription("Queues a long-running job for the worker.")
            .WithTags("Tenant Job");
    }
}

public record CreateJobRequest(string RequestId, string Input);

public class CreateJobRequestValidator : AbstractValidator<CreateJobRequest>
{
    public CreateJobRequestValidator()
    {
        RuleFor(x => x.RequestId).NotEmpty().Length(26);   // ULID
        RuleFor(x => x.Input).NotEmpty().MaximumLength(500);
    }
}
```

> Hata metinleri sunucuda kod olarak döner (`monthly_limit_reached`); kullanıcıya görünen cümle istemcinin çeviri dosyasındadır.

---

### 10. Endpoint — PUT (sürümlü güncelleme + çakışma)

```csharp
// src/Api/Endpoints/V1/Tenant/Item/Put.cs
public class Put : IEndpoint
{
    private static async Task<IResult> Handler(
        [FromRoute] string id,
        [FromBody] UpdateItemRequest request,
        [FromServices] IApiContext apiContext,
        [FromServices] IItemService itemService,
        [FromServices] IValidator<UpdateItemRequest> validator,
        CancellationToken cancellationToken)
    {
        var validationResult = await validator.ValidateAsync(request, cancellationToken);
        if (!validationResult.IsValid)
            return Results.BadRequest(validationResult.Errors.ToProblemDetails());

        var result = await itemService.UpdateAsync(apiContext.TenantId, id, request, cancellationToken);

        return result switch
        {
            { IsNotFound: true } => Results.NotFound(),
            // 409 gövdesi güncel kaydı taşır: istemci "Bu kaydı başka bir cihazda değiştirdin" seçimini bununla kurar
            { IsConflict: true } => Results.Conflict(result.Current),
            _                    => Results.Ok(result.Current)
        };
    }

    public RouteHandlerBuilder MapEndpoint(IEndpointRouteBuilder endpoints)
    {
        return endpoints.MapPut("v1/tenant/item/{id}", Handler)
            .Produces<ItemDto>(StatusCodes.Status200OK)
            .Produces<ProblemDetails>(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status404NotFound)
            .Produces<ItemDto>(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status500InternalServerError)
            .RequireAuthorization("TenantUserJwt")
            .WithSummary("Update item")
            .WithDescription("Updates editable item fields if baseVersion matches. Server-computed state is not changed here.")
            .WithTags("Tenant Item");
    }
}
```

---

### 11. Request + Validator (paylaşılan Contracts dosyası)

```csharp
// src/Api/Contracts/Contracts.cs
public record UpdateItemRequest(string? Note, long BaseVersion);

public record ItemUpsertRequest(
    string Id,            // ULID, istemciden — çevrimdışı ekleme
    string Title,
    string? Description,
    IReadOnlyList<string> Tags);

public record ActivityItem(
    string ItemId,
    string Source,
    DateTime OccurredAt,
    string ClientMutationId);

public record ActivityBatchRequest(IReadOnlyList<ActivityItem> Items);

public class ItemUpsertRequestValidator : AbstractValidator<ItemUpsertRequest>
{
    public ItemUpsertRequestValidator()
    {
        RuleFor(x => x.Id).NotEmpty().Length(26);
        RuleFor(x => x.Title).NotEmpty().MaximumLength(80);
        RuleFor(x => x.Description).MaximumLength(300);
        RuleFor(x => x.Tags).Must(t => t.Count <= 10);
    }
}

public class ActivityBatchRequestValidator : AbstractValidator<ActivityBatchRequest>
{
    public ActivityBatchRequestValidator(TimeProvider timeProvider)
    {
        RuleFor(x => x.Items).NotEmpty().Must(i => i.Count <= 100);
        RuleForEach(x => x.Items).ChildRules(item =>
        {
            item.RuleFor(i => i.ClientMutationId).NotEmpty().Length(26);
            // Çevrimdışı olay günlerce bekleyebilir ama gelecekten gelemez (5 dk saat kayması payı)
            item.RuleFor(i => i.OccurredAt)
                .Must(d => d <= timeProvider.GetUtcNow().UtcDateTime.AddMinutes(5))
                .Must(d => d >= timeProvider.GetUtcNow().UtcDateTime.AddDays(-30));
        });
    }
}
```

---

### 12. IEndpoint — otomatik kayıt

Uç noktaları tek tek kaydetmezsin. `StartupExtensions.MapEndpointsCore()` assembly'leri tarar ve her `IEndpoint` implementasyonunda `MapEndpoint()` çağırır.

```csharp
// src/Api/Infrastructure/Extensions/StartupExtensions.cs
public static IEndpointRouteBuilder MapEndpointsCore(
    this IEndpointRouteBuilder endpoints,
    IEnumerable<Assembly> assemblies)
{
    var endpointTypes = assemblies
        .SelectMany(a => a.GetTypes())
        .Where(t => typeof(IEndpoint).IsAssignableFrom(t));

    foreach (var endpointType in endpointTypes)
    {
        if (endpointType.IsInterface) continue;

        var endpoint = Activator.CreateInstance(endpointType);
        if (endpoint is IEndpoint endpointItem)
            endpointItem.MapEndpoint(endpoints);
    }

    return endpoints;
}
```

**Yani**: `IEndpoint` uygulayan yeni bir sınıf yeterli — rota bir sonraki build'de canlıdır.

---

### 13. IApiContext — aktif kullanıcı

Handler içinde `TenantId` her zaman `IApiContext`'ten alınır. JWT elle çözülmez, tenant id'si **asla** istek gövdesinden okunmaz.

```csharp
// src/Domain/Context/IApiContext.cs
public interface IApiContext
{
    public string TenantId { get; }
    public string UserId   { get; }   // e-posta değil: telefonla girişte e-posta yok
}
```

Tenant kullanıcı uçları `RequireAuthorization("TenantUserJwt")` ister. **Paket/abonelik bilgisi JWT'de taşınmaz** — paket token yaşarken değişebilir (satın alma, bitiş, iade). `IEntitlementService` paketi her istekte kayıttan okur (kısa önbellekle) ve kararı `EntitlementPolicy`'ye bırakır.

**Droblet'te rol yok** — tenant'ın tek kullanıcısı sahibidir; tüm tenant uçları `TenantUserJwt` ister. Yetki iki politikadan geçer:
- **`EntitlementPolicy`** — paket farkı (try-on, stilist, bavul, palet, ücretsiz sınırlar A-1).
- **`VisibilityPolicy`** — başka bir tenant'ın verisine okuma. `v1/tenant/people/{handle}/…` ve `v1/tenant/feed` uçları sahibin `tenantId`'sini `Handle` dizininden çözer, ilişkiyi (`Following`) okur, politikaya sorar; `false` ise **404** döner (kaydın varlığı sızdırılmaz). Bu uçlar dışında hiçbir handler `IApiContext.TenantId` dışında bir tenant anahtarı kurmaz.

---

## Lambda — Api

**Trigger**: API Gateway HTTP
**Entry point**: `src/Api/Entrypoint.cs`

### Kimlik — e-posta + şifre, Apple, Google
Giriş seçenekleri (02 ekranı + brief §4.1): **Apple** (iOS'ta zorunlu), **Google**, **e-posta + şifre**. Telefon/SMS yok. Ürün sahibi kararı: handoff README §9.3.
1. `POST v1/auth/register { name, email, password }` → şifre en az 8 karakter; karma **PBKDF2-SHA256** (≥ 600.000 tur, tuzlu) `CredentialEntity`'de. Kullanıcı **ve tenant'ı** oluşturulur → JWT + refresh. E-posta zaten kayıtlıysa `409 email_taken`.
2. `POST v1/auth/login { email, password }` → JWT + refresh. Yanlış e-posta ya da şifre aynı cevabı verir (`401 invalid_credentials`); e-posta + IP başına hız sınırı.
3. `POST v1/auth/password/forgot { email }` → her durumda `202`; hesap varsa tek kullanımlık, hash'lenmiş, 30 dk TTL'li sıfırlama token'ı (`PasswordResetEntity`) ve **deep link**'li e-posta (`https://droblet.alatech.co/reset-password?token=…` → uygulama açılır).
4. `POST v1/auth/password/reset { token, newPassword }` → şifre değişir, kullanıcının tüm refresh token'ları iptal edilir.

**E-posta** `IEmailService` üzerinden gider ve iki uygulaması vardır (karar 2026-11-18: SES yerine **SendGrid**):
- `SendGridEmailService` — SendGrid v3 Mail Send, SDK'sız düz HTTPS (varsayılan). API anahtarı SSM SecureString `/droblet/{stage}/api/Email` → `Email:SendGrid:ApiKey`. Tıklama ve açılma takibi mesaj başına kapalı (sıfırlama linki yeniden yazılmasın).
- `SmtpEmailService` — standart SMTP yedeği. Kimlik bilgileri SSM'de.

Hangisinin kullanılacağı SSM `Email.Provider` (`SendGrid` | `Smtp`) ile seçilir. Şablonlar desteklenen dillerde (istekteki `Accept-Language`'a göre), düz metin + HTML, iki uygulamada ortaktır.

**SMS** `ISmsService` üzerinden gider. Sağlayıcı yapılandırılmamışsa telefon kanalı `503 sms_unavailable` döner ve istemci e-postaya yönlendirir. SMS ücretli ve kötüye kullanıma açık: hız sınırı ve ülke izin listesi için bkz. SECURITY_ENGINEER.md.

**Google ve Apple:** Google OAuth standart akış. **Apple ile giriş** aynı desende: `POST v1/auth/apple { identityToken, nonce, fullName? }` → Apple'ın public key'leriyle `identityToken` doğrulanır (`iss`, `aud` = `com.alatech.droplet`, `nonce`) → JWT çifti. Apple adı yalnız ilk girişte gönderir; o an kaydedilir. Sağlayıcı kimliği (`sub`) `AuthIdentityEntity`'de kullanıcıya bağlanır.

### Responsibilities
- Kimlik doğrulama (e-posta + şifre, Google, Apple → JWT), kayıtta tenant oluşturma
- Global (salt okunur) veri uçları
- Tenant kapsamlı CRUD ve domain işlemleri
- Uzun işleri başlatma ve sonucunu döndürme (worker kuyruğu)
- Yetki, satın alma doğrulama, mağaza bildirimleri (proje gerektirirse)
- Cihaz kaydı (push token), bildirim tercihleri
- Geri bildirim, analitik olayları
- Hesap ve veri silme

**Droblet'e özgü (epic'lerle):**
- **E1** Onboarding: stil profili, beden profili, boy/yüz fotoğrafı yükleme (presigned PUT, özel S3), @kullanıcı adı benzersizliği
- **E2** Gardırop: parça CRUD, fotoğraf yükleme, `ItemProcessor` işini başlatma, taslakların **kullanıcı onayıyla** `Item`'a dönüşmesi, üründen gardıroba ekleme
- **E3** Look CRUD (5 slot, gardırop ya da katalog), favori, look puan özeti
- **E4** Bugün snapshot'ı (hava + plan + look), haftalık plan günleri, "Bunu giyiyorum" giyim kaydı, takvim ay özeti
- **E5** Stilist işleri (kombin, hafta, bavul, eksik parça) ve önerilerin kullanıcı onayıyla Look/PlanDay/Trip'e yazılması; bavul hazırlık işaretleme
- **E6** Try-on işi başlatma, tenant içi try-on önbelleği, görsel için presigned GET
- **E7** Palet analizi işi, palet sonucu, gardırop uyum oranı ve "paletime uygun ürünler"
- **E8** Global içerik ve katalog okuma, ürün ↔ gardırop uyumu, sepet (markaya göre gruplu), markaya yönlendirme linki
- **E9** Takip, akış, kişi profili, dolap keşfi, puanlama — hepsi `VisibilityPolicy`'den
- **E10** Üyelik satın alma doğrulama, geri yükleme, mağaza bildirimleri
- **E11** Dolap görünürlüğü, "Fotoğraflarımı ve üretilen görselleri sil" (hesap silmeden bağımsız), bildirim tercihleri, hesap silme (karşı tenant'lardaki takip ve puan kayıtları dahil)

### Uç nokta haritası

Tenant kapsamlı tüm uçlar `v1/tenant/*` altındadır. Ortak altyapı uçları:

```
POST   v1/auth/register                              → AllowAnonymous: ad, e-posta, şifre → kullanıcı + tenant + JWT (hız sınırlı)
POST   v1/auth/login                                 → AllowAnonymous: e-posta + şifre → JWT + refresh (hız sınırlı)
POST   v1/auth/password/forgot                       → AllowAnonymous: her durumda 202; sıfırlama e-postası
POST   v1/auth/password/reset                        → AllowAnonymous: token + yeni şifre
POST   v1/auth/google                                → AllowAnonymous: Google akışı
POST   v1/auth/apple                                 → AllowAnonymous: identityToken doğrula → JWT + refresh
POST   v1/auth/refresh

GET    v1/tenant/profile
PUT    v1/tenant/profile                             → sürümlü (409 olabilir)

GET    v1/tenant/job/{id}                            → uzun iş durumu + sonucu (POST ile 202 dönen işler)

GET    v1/tenant/entitlement                         → (proje gerektirirse) paket, kaynak, bitiş, kalan kotalar
POST   v1/tenant/entitlement/purchase                → StoreKit 2 JWS / Play purchaseToken doğrula → yetki
POST   v1/tenant/entitlement/restore                 → satın alımları geri yükle
POST   v1/store/apple/notifications                  → AllowAnonymous: App Store Server Notifications v2
POST   v1/store/google/notifications                 → AllowAnonymous: Play RTDN (Pub/Sub push)

PUT    v1/tenant/user/me/device                      → push token kaydı / yenileme
DELETE v1/tenant/user/me/device/{deviceId}
GET    v1/tenant/user/me/notifications               → bildirim saatleri, günlük sınır, türler, sessiz saatler
PUT    v1/tenant/user/me/notifications

POST   v1/tenant/feedback                            → geri bildirim
POST   v1/tenant/event                               → analitik olayları (toplu, en fazla 50)

DELETE v1/auth/me                                    → hesap silme (uygulama ve web sayfası aynı uç)
```

**Droblet domain uçları** (ekran numaraları SCREENS.md'den; `[E:…]` = `EntitlementPolicy` yeteneği, `[Q]` = kota rezervasyonu, `[V]` = `VisibilityPolicy`, `[idem]` = `clientMutationId`/`requestId` ile idempotent, `[409]` = `baseVersion` ile sürümlü). Aksi yazılmadıkça hepsi `TenantUserJwt`.

```
# Auth ek (01–02, 29)
POST   v1/auth/logout                                → refresh token iptali + cihaz kaydı silinir ("Çıkış yap")

# E1 — Profil ve onboarding (03–04, 28)
PUT    v1/tenant/profile/handle                      → @kullanıcı adı al/değiştir; Handle dizininde koşullu yazım (alınmışsa 409 handle_taken)
GET    v1/tenant/profile/stats                       → parça, look, takipçi, bavul sayıları (28)
GET    v1/tenant/style-profile
PUT    v1/tenant/style-profile                       → segment, tam 3 stil etiketi, bütçe [409]
GET    v1/tenant/body-profile
PUT    v1/tenant/body-profile                        → boy, kilo, beden [409]
POST   v1/tenant/photo/upload-url                    → { kind: body|face, contentType } → presigned PUT (özel S3, kısa ömür, boyut sınırlı)
PUT    v1/tenant/photo/{kind}                        → yüklenen nesneyi aktif boy/yüz fotoğrafı yapar; eskisi ve ondan türeyen try-on görselleri silinir [idem]
GET    v1/tenant/photo                               → aktif fotoğrafların meta verisi + kısa ömürlü presigned GET
DELETE v1/tenant/photo                               → "Fotoğraflarımı ve üretilen görselleri sil": boy + yüz fotoğrafı, TÜM TryOnImage, palet kaynağı (29) — hesap silmeden bağımsız

# E2 — Gardırop ve parça ekleme (10–13)
GET    v1/tenant/item                                → tüm parçalar (filtre/sıralama cihazda: kategori, sezon, renk, en yeni)
GET    v1/tenant/item/{id}                           → parça detayı + giyilme sayısı + bu parçalı look'lar (11)
PUT    v1/tenant/item/{id}                           → kullanıcı alanları (ad, kategori, renk, kumaş, sezon, beden) [409]
DELETE v1/tenant/item/{id}                           → parça + görseli; look slotlarında "silinmiş parça" olarak işaretlenir
POST   v1/tenant/item/upload-url                     → { count } → parça fotoğrafları için presigned PUT listesi (tekli 12, toplu 13)
POST   v1/tenant/item-draft                          → { requestId, photoKeys[] } → taslak başına ItemProcessor işi; 202 [E:ItemProcessing] [Q] [idem]
GET    v1/tenant/item-draft                          → bekleyen taslaklar + durum ("8 / 12") + öneriler + işaretli alanlar
DELETE v1/tenant/item-draft/{id}                     → taslağı ve S3 nesnelerini at
POST   v1/tenant/item-draft/confirm                  → { items: [{ draftId, clientMutationId, reviewed, alanlar… }] } → ItemDraftRules → Item [E:WardrobeItem] [idem]
POST   v1/tenant/item/from-product                   → { clientMutationId, productId, size } → katalog ürününden Item ("Gardıroba ekle", 22) [E:WardrobeItem] [idem]

# E3 — Look'lar (14–15, 23)
GET    v1/tenant/look                                → lookbook + puan özeti (4.6); filtre (favori, ortam) cihazda
GET    v1/tenant/look/{id}
POST   v1/tenant/look                                → { id (ULID), ad, ortam, slotlar } → OutfitSlotRules [idem]
PUT    v1/tenant/look/{id}                           → ad, ortam, slotlar, favori [409]
DELETE v1/tenant/look/{id}

# E4 — Bugün, haftalık plan, takvim (06–09)
GET    v1/tenant/today?date=                         → tek çağrıda: tarih, sezon, hava, PlanDay, günün look'u, edit özeti (06)
GET    v1/tenant/plan-day?from=&to=                  → haftalık plan / takvim (07, 09)
PUT    v1/tenant/plan-day/{date}                     → ortam, lookId [409]
POST   v1/tenant/wear-log                            → "Bunu giyiyorum": { clientMutationId, date, occurredAt, lookId | itemIds[] } [idem]
DELETE v1/tenant/wear-log/{date}/{id}                → giyim kaydını geri al
GET    v1/tenant/wear-log?month=yyyy-MM              → ay takvimi (09)
GET    v1/tenant/wear-log/summary?month=yyyy-MM      → "10 gün kayıtlı", en çok giyilen, rapor (09)
GET    v1/weather?cityId=&from=&to=                  → global önbellekli tahmin (sağlayıcı ve konum/şehir A-4)

# E5 — Stilist ve bavul (16–19)
POST   v1/tenant/stylist/outfit                      → { requestId, date, occasion, cityId, wardrobeOnly } → 3 öneri; 202 [E:DailyStylist] [Q] [idem]
POST   v1/tenant/stylist/week                        → { requestId, weekStart, günlük ortamlar } → 7 günlük plan; 202 [E:DailyStylist] [Q] [idem]
POST   v1/tenant/stylist/complete                    → { requestId, itemIds? } → "Parçamı tamamla" katalog önerisi; 202 [E:CompleteLook] [Q] [idem]
POST   v1/tenant/stylist/suggestion/{jobId}/{index}/accept
                                                     → "Takvime ekle"/"Kaydet": öneriyi kullanıcı onayıyla Look (+ PlanDay) olarak yazar [idem]
GET    v1/tenant/trip                                → bavullar + geçmiş seyahatler (18)
GET    v1/tenant/trip/{id}                           → bavul detayı: liste, günlük look'lar, hazırlık sayısı, şehir hava tahmini (19)
POST   v1/tenant/trip                                → { id, cityId, startDate, endDate, tripTypes[], cabinOnly } [idem]
PUT    v1/tenant/trip/{id}                           → seyahat alanları [409]
DELETE v1/tenant/trip/{id}
POST   v1/tenant/trip/{id}/pack                      → { requestId } → bavul listesi + günlük look'lar; 202 [E:SmartSuitcase] [Q] [idem]
POST   v1/tenant/trip/{id}/pack/{jobId}/accept       → taslağı kullanıcı onayıyla TripItem + TripDay olarak yazar [idem]
PUT    v1/tenant/trip/{id}/item/{itemId}             → hazırlık işareti { packed, clientMutationId, occurredAt } [idem]

# E6 — Üzerimde gör (06, 07, 08, 15, 17, 19, 22)
POST   v1/tenant/tryon                               → { requestId, target: { kind, id } } → 202; boy fotoğrafı yoksa 422 body_photo_required [E:TryOn] [Q] [idem]
GET    v1/tenant/tryon?kind=&id=                     → aynı hedef + aynı boy fotoğrafı için tenant içi var olan görsel (yeniden üretmeden)
GET    v1/tenant/tryon/{id}                          → görsel meta + kısa ömürlü presigned GET (yalnız sahibi)

# E7 — Renk paleti (30)
POST   v1/tenant/palette/analyze                     → { requestId } → 202; yüz fotoğrafı yoksa 422 face_photo_required [E:PaletteAnalysis] [Q] [idem]
GET    v1/tenant/palette                             → sezon tipi, yakışan/kaçınılacak tonlar, gardırop uyum oranı (PaletteCompatibilityRules)
GET    v1/tenant/palette/mismatch                    → "Uyumsuz parçaları gör"
GET    v1/tenant/palette/products                    → "Paletime uygun ürünler" (katalog, kural tabanlı)
DELETE v1/tenant/palette                             → palet sonucunu sil

# E8 — Keşfet, edit, mağaza, sepet (08, 20–24)
GET    v1/content/edit/current                       → haftanın edit'i (dil bölümlü)
GET    v1/content/edit/{id}                          → look'lar, stil notu, ürün satırları, toplam fiyat (08)
GET    v1/content/creator                            → influencer/editör listesi (A-7)
GET    v1/content/creator/{id}/look                  → creator look'ları (A-7)
GET    v1/content/series-outfit                      → dizi outfitleri (lisans A-7; karar verilmeden boş döner)
GET    v1/catalog/brand
GET    v1/catalog/product?category=&brand=&color=&size=&q=&sort=&pageToken=   → sayfalı (21); serbest metin aramanın kapsamı katalog büyüklüğüne (A-2) bağlı
GET    v1/catalog/product/{id}                       → ürün detayı, bedenler (22)
GET    v1/tenant/catalog/product/{id}/match          → "Gardırobundaki N parçayla uyumlu" + parça listesi (WardrobeMatchRules)
GET    v1/tenant/cart                                → markaya göre gruplu satırlar, marka ara toplamları, genel toplam (güncel katalog fiyatıyla) (24)
POST   v1/tenant/cart/line                           → { lines: [{ clientMutationId, productId, size }] } — tekli ya da "Look'u satın al" / "2 ürünü satın al" [idem]
DELETE v1/tenant/cart/line/{lineId}
POST   v1/tenant/cart/checkout/{brandId}             → markanın kendi mağazasına yönlendirme linki ("… 'da öde"); ödeme Droblet'te alınmaz; link parametreleri/affiliate A-2

# E9 — Sosyal (25–27) — okumaların hepsi [V], reddedilen okuma 404
GET    v1/tenant/feed?pageToken=                     → takip edilenlerin look'ları + puan özeti (25)
GET    v1/tenant/people?q=                           → @kullanıcı adı önek araması (27)
GET    v1/tenant/people/suggested                    → "Sana benzeyen dolaplar" (yalnız PublicProfileIndex'teki hesaplar) + stil uyumu %
GET    v1/tenant/people/{handle}                     → profil kartı, sayılar, stil uyumu %, takip durumu (26)
GET    v1/tenant/people/{handle}/look                → [V]
GET    v1/tenant/people/{handle}/item                → "Dolabını keşfet" [V]
GET    v1/tenant/people/{handle}/trip                → yalnız tamamlanmış seyahatler, şehir + ay (öneri; A-6 ile onaylanır) [V]
PUT    v1/tenant/people/{handle}/look/{lookId}/rating → { score, clientMutationId } — kişi başı look başı tek puan, üzerine yazar [V] [idem]
POST   v1/tenant/follow/{handle}                     → takip et (iki taraflı kayıt tek transaction) [idem]
DELETE v1/tenant/follow/{handle}                     → takipten çık
GET    v1/tenant/invite/link                         → davet linki (alan adı A-10)
POST   v1/tenant/people/contacts-match               → rehberden bul — yalnız A-8 kararından sonra açılır (hash'li eşleşme)

# E11 — Gizlilik (29)
PUT    v1/tenant/profile/visibility                  → { closetVisibility, baseVersion } — varsayılan değer Açık karar (A-6) [409]
```

Puan ölçeği: tasarımdaki 4,6 / 4,7 ortalamalarından 1–5 çıkarılmıştır — PM teyit eder. Takip onayı tasarımda yok: takip anında gerçekleşir; bu durumda "Yalnızca takipçiler" pratikte herkese açığa yakındır → onay akışı gerekip gerekmediği **Açık karar (A-6)** kapsamında ürün sahibine sorulur.

İstemci ile her epic'ten önce bu uçların istek/cevap şekli yazılı olarak sabitlenir (bkz. PRODUCT_MANAGER.md).

### Native widget snapshot (proje gerektirirse)
Widget'ların tek veri kaynağı tek bir snapshot ucudur (ör. `GET v1/tenant/widget/snapshot`); widget kodu ağa çıkmaz, uygulama bu paketi yerel önbelleğe yazar ve zaman çizelgesini kurar.
- **Küçük ve kendi başına yeterli:** widget'ın göstereceği her şey pakette — widget ikinci bir sorgu yapamaz.
- **Yetkiye göre:** paket farkı varsa snapshot içeriği `EntitlementPolicy`'ye göre kurulur.
- **Uzun metin:** kısaltma kuralı widget'ta değil tasarımda; sunucu tam metni gönderir.
- **Sürümlü:** pakette `schemaVersion`. Ana ekrandaki en eski widget eski şekli okur — alan kaldırmak kırıcı değişikliktir.

### Yetki ve satın alma (proje gerektirirse)
- Aktif paket, kullanıcının **aktif yetki kayıtlarının en yükseğidir** (`EntitlementEntity`; `source` ile kaynağı ayrılır: `store`, `promo`, …).
- Satın alma akışı: istemci yalnız kimlik gönderir (Apple `transactionId`, Google `purchaseToken`); durum **App Store Server API** / **Play Developer API**'den okunur. Mağaza bildirimi yalnız yeniden okumayı tetikler.
- **Abonelik bitince kullanıcı verisi silinmez**; `EntitlementPolicy` ücretsiz paket sınırlarını uygular.
- Mağaza tarafında uygulanamayan ürün kuralları (abonelik başlangıcı, deneme uygunluğu) varsa seçenekler yazılı sunulur, karar verilmeden uygulanmaz.

**Droblet paketleri:** `Free` ve `Premium` ("Droblet Üyelik" — aylık ve yıllık, ücretsiz deneme). Fiyatlar, deneme süresi ve ücretsiz paket sınırları **Açık karar (A-1)**; ürün kimlikleri bundle id'ye bağlı **Açık karar (A-10)** — `Store.ProductIds`'e karar sonrası yazılır. Promosyon / referans kuralı tasarımda yok; `EntitlementEntity.source` yalnız `store`.

| `Capability` | Free | Premium |
|---|---|---|
| `TryOn` — "üzerimde gör" | Açık karar (A-1) | **Sınırsız** (aylık kota yok; kötüye kullanıma karşı yalnız dakikalık hız sınırı — SECURITY_ENGINEER.md) |
| `DailyStylist` — günlük kombin + haftamı planla | Açık karar (A-1) | Var ("Kişisel stil danışmanı") |
| `SmartSuitcase` — bavul listesi + günlük look'lar | Açık karar (A-1) | Var ("Akıllı bavul") |
| `PaletteAnalysis` — yüzden palet | Açık karar (A-1) | Var ("Renk paleti analizi") |
| `ItemProcessing` — AI ile parça tanıma/temizleme | Açık karar (A-1) | Açık karar (A-1) — paywall'da yazmıyor |
| `WardrobeItem` — gardırop parça sayısı | Açık karar (A-1) | Açık karar (A-1) |
| `CompleteLook` — "Parçamı tamamla" | Açık karar (A-1) | Açık karar (A-1) |
| Look, plan, takvim, sepet, sosyal, katalog | Var | Var |

- Otomatik "Senin üzerinde" önizlemeleri (Bugün, Edit, Kombin önerisi) birer `TryOn` işidir; ücretsiz pakette kotadan düşüp düşmeyeceği ya da düz (flat-lay) görünüme mi düşeceği **Açık karar (A-1)**. Yetkisi yoksa istemci flat-lay gösterir; sunucu kendiliğinden try-on başlatmaz.
- Abonelik bitince üretilmiş try-on görselleri, palet sonucu ve bavullar **silinmez**; yalnız yeni iş başlatma politikaya göre kısıtlanır.
- Deneme uygunluğu mağaza tarafında uygulanır; uygulanamayan bir kural çıkarsa seçenekler yazılı sunulur (A-1).

### Adding a New Endpoint — Checklist
1. `src/Api/Endpoints/V1/{Area}/{Resource}/{Verb}.cs` oluştur
2. `IEndpoint` uygula — açılışta otomatik kaydolur
3. Request `record` + `AbstractValidator<T>` aynı dosyada (paylaşılıyorsa `Contracts.cs`)
4. `TenantId` için `IApiContext`, DB için `IRepository`, mantık için domain servisleri
5. Herhangi bir DB çağrısından önce doğrula
6. Tüm durum kodlarını `MapEndpoint`'te beyan et
7. Paket farkı varsa **`EntitlementPolicy`'den geç**; sunucu hesaplı durumu değiştiriyorsa **ilgili domain kuralından ve olay kaydından geç** (aynı serviste, ayrı bir yerde değil)
8. `tests/ApiTests/` altında birim testi

---

## Lambda'lar — ItemProcessor, Stylist, TryOn, Palette (SQS)

**Trigger**: SQS — `item-process-request` → `ItemProcessor`, `stylist-request` → `Stylist`, `tryon-request` → `TryOn`, `palette-request` → `Palette` (her kuyruğun DLQ'su DEVOPS_ENGINEER.md'de)
**Entry point**: `src/ItemProcessor/Entrypoint.cs`, `src/Stylist/Entrypoint.cs`, `src/TryOn/Entrypoint.cs`, `src/Palette/Entrypoint.cs`
**Timeout**: 120 sn (TryOn ve görsel işleme süresi A-3 sağlayıcısıyla ölçülür; 120 sn yetmezse ayrı karar olarak yazılır)

### Responsibilities (genel AI işi deseni)
1. `{Job}RequestedEvent`'i al, `JobEntity`'yi `Processing` yap
2. Gerekli bağlamı oku; mümkünse cevap önce **doğrulanmış global veriden** beslenir
3. `IAiProvider` çağrısı — yapılandırılmış (şemalı) çıktı
4. Çıktıyı bir guard/validator'dan geçir (şema, referanslar gerçekten var mı, uzunluk sınırları, içerik filtresi). Geçmeyen çıktı `Failed(GuardRejected)` olur; **düzeltilmez**. Gerekirse kural tabanlı bir yedeğe düşülür
5. `Completed` → kota rezervasyonu kesinleşir. `Failed` (`ProviderError`, `Timeout`, `GuardRejected`) → **kota iade edilir**
6. **AI çıktısı kullanıcı verisine kullanıcı onayı olmadan yazılmaz** — worker taslak üretir, kalıcı kayıt kullanıcı onayladıktan sonra ayrı bir uçla oluşur

Prompt'lar, şema ve kurallar [AI_ENGINEER.md](AI_ENGINEER.md)'de.

Tüm worker'larda ortak: işin `tenantId`'si mesajdan gelir ve worker **yalnız o tenant'ın** partition'ını ve S3 önekini okur/yazar. Kullanıcı fotoğrafından türeyen hiçbir çıktı global bölüme ya da global önbelleğe yazılmaz. Sağlayıcılar **Açık karar (A-3)**.

#### ItemProcessor — `item-process-request`
| | |
|---|---|
| Girdi | `ItemProcessRequestedEvent(tenantId, jobId, draftId)`; `ItemDraft.originalKey` (özel S3: `tenant/{tenantId}/item-original/{draftId}`) |
| İş | Arka plan temizleme, kadraj düzeltme, alan doldurma → işlenmiş görsel; görsel tanıma → kategori, renk(ler), kumaş, sezon, ad önerisi + alan başına güven |
| Çıktı | İşlenmiş görsel `tenant/{tenantId}/item/{draftId}.webp`; `ItemDraft` → `Ready` (öneriler + işaretli alanlar) ya da `Failed` |
| Guard | `GarmentVisionGuard`: değerler enum/renk sözlüğünde; eşik altı alan **işaretlenir** ("Kategoriyi kontrol et"), uydurulmaz. Görselde giysi yoksa `Failed(GuardRejected)` |
| Yazmaz | `Item` — taslak yalnız `POST v1/tenant/item-draft/confirm` ile parçaya döner |
| Yedek | Başarısızlıkta orijinal fotoğraf + boş alanlar; kullanıcı elle doldurur. Kota iade |

#### Stylist — `stylist-request`
| `JobKind` | Girdi | Çıktı (iş sonucu = taslak) |
|---|---|---|
| `StylistOutfit` | Tarih, ortam, şehir → hava (global önbellek), `wardrobeOnly`, parça öznitelikleri (fotoğraf değil), `StyleProfile`, varsa `PaletteResult`, `wardrobeOnly = false` ise katalog adayları | 3 öneri: ad ("Gece Laciverti"), slotlar (itemId / productId), açıklama, eksik parça önerisi (katalog) |
| `StylistWeek` | Hafta başı, gün başına ortam, hava, gardırop | 7 gün × öneri (gün başı bir look taslağı) |
| `StylistPack` | `Trip` (şehir, tarihler, tipler, `cabinOnly`), şehir hava tahmini, gardırop | Bavul listesi (itemId'ler) + gün başına look + gün etiketi ("Uçuş + akşam yemeği") |
| `StylistComplete` | Seçili parçalar ya da gardırop özeti, bütçe, katalog adayları | Eksik parça için katalog ürünleri + gerekçe |

- **Guard:** `StylistOutputGuard` (referanslar gerçek, `wardrobeOnly`, `OutfitSlotRules`, açıklama uzunluğu); `StylistPack` ayrıca `PackingRules` ("her parça en az 2 kez", kabin sınırı). Geçmeyen çıktı düzeltilmez → `Failed(GuardRejected)`.
- **Kural tabanlı yedek:** `StylistOutfit` → kullanıcının o ortamdaki mevcut look'larından seçim; `StylistPack` → `PackingRules` ile açgözlü (greedy) kural tabanlı bavul.
- **Yazmaz:** `Look`, `PlanDay`, `TripItem`, `TripDay` — yalnız `…/accept` uçlarıyla, kullanıcı onayından sonra.
- LLM'e kullanıcı fotoğrafı gönderilmez; yalnız öznitelikler (kategori, renk, kumaş, sezon) ve kimlikler gider.

#### TryOn — `tryon-request`
| | |
|---|---|
| Girdi | `TryOnRequestedEvent(tenantId, jobId, target{kind, id}, bodyPhotoId)`; boy fotoğrafı (özel S3); hedefin giysi görselleri: kendi `Item` görseli ya da katalog ürününün **global** arka planı temizlenmiş görseli |
| Hedef sınırı | `Item`/`Look`/`Suggestion` yalnız aynı tenant'tan; `Product`/`EditLook` katalog/global içerikten. Başka tenant'ın parçası ya da look'u hedef olamaz |
| Çıktı | `tenant/{tenantId}/tryon/{tryOnImageId}.webp` + `TryOnImageEntity` (sk: `{bodyPhotoId}#{kind}#{id}#{targetVersion}` — aynı hedef ikinci kez üretilmez) |
| Guard | `TryOnOutputPolicy`: yazmadan hemen önce `bodyPhotoId` hâlâ aktif mi? Değilse (kullanıcı sildi/değiştirdi) çıktı atılır, S3 nesnesi silinir, `Failed(SourceDeleted)`, kota iade. Sağlayıcı içerik filtresi (A-3). Çıktı global önbelleğe **asla** yazılmaz |

#### Palette — `palette-request`
| | |
|---|---|
| Girdi | `PaletteRequestedEvent(tenantId, jobId, facePhotoId)`; yüz fotoğrafı (özel S3) |
| Çıktı | `PaletteResultEntity`: sezon tipi, yakışan tonlar, kaçınılacak tonlar, `sourcePhotoId`, model sürümü. Gardırop uyum oranı burada **hesaplanmaz** (`PaletteCompatibilityRules`, okumada) |
| Guard | `PaletteOutputGuard`; tek yüz algılanmazsa `Failed(NoFaceDetected)`, kota iade. Yazmadan önce `facePhotoId` hâlâ aktif mi kontrol edilir (değilse `SourceDeleted`) |
| Not | Palet sonucu yalnız metin/renk listesidir; yüz fotoğrafının kopyası ya da kırpıntısı saklanmaz. Yüz fotoğrafı silinince `sourcePhotoId` boşalır, sonuç kalır (kullanıcı `DELETE v1/tenant/palette` ile ayrıca siler) — öneri, PM teyit eder |

---

## Lambda — Notifier (EventBridge)

**Trigger**: EventBridge — zamanlama başına bir handler, aynı assembly'de
- `Reminder` — **15 dakikada bir** (`cron(0/15 * * * ? *)`); slot bölümü saat, çeyrek bir `ReminderRules.IsDueNow` kuralıyla
- `Lifecycle` — **günlük**

**Entry point**: `src/Notifier/Entrypoint.cs`

### Zamanlanmış hatırlatma deseni
1. Kullanıcının seçtiği saatler ve sessiz saatler **UTC** saklanır; uygulama yerel saatte gösterir. İlk varsayılan cihazın/profilin saat diliminden bir kez UTC'ye çevrilir. Her saat `ReminderSlotEntity`'ye (`pk = reminderutc#{HH}`) yazılır; şu anki UTC saatinin bölümü okunur
2. Yalnız gerçekten yapılacak bir şeyi olan kullanıcıya gönder
3. Sessiz saatler ve günlük sınır uygulanır; gönderilen sayı `NotificationPrefEntity`'de günlük tutulur
4. `IPushProvider` (Firebase Cloud Messaging HTTP v1, iOS ve Android); `UNREGISTERED` token'ı hemen sil

### Yaşam döngüsü (günlük)
- Abonelik/yetki bitişi yaklaşan kullanıcılara bir kez
- Periyodik özetler (tür açıksa)
- Pazarlama bildirimleri yalnız pazarlama rızası verenlere

**Droblet bildirim türleri** (ekran 29'daki üç anahtar = `NotificationType`):

| Tür | Tetik | "Yapacak bir şey" koşulu | Varsayılan saat |
|---|---|---|---|
| `MorningOutfit` — Sabah kombin hatırlatması | `Reminder` (15 dk) | Bugün için `PlanDay`'de look var ya da kullanıcı `DailyStylist` yetkili | 07:30 yerel — **öneri**, ürün sahibi onaylar |
| `WeeklyEdit` — Haftanın edit'i | `Reminder`, haftada bir | Yeni yayımlanmış `Edit` var ve kullanıcı henüz açmadı | Pazartesi 09:00 yerel — **öneri** |
| `FriendRatings` — Arkadaş puanları | `Reminder`, günde en fazla bir özet | Son bildirimden bu yana look'larına yeni puan geldi | 19:00 yerel — **öneri** |
| Abonelik bitişi / deneme sonu | `Lifecycle` | Bitişe yaklaşan yetki | — (süreler A-1'e bağlı) |

- Üç türün ilk açık/kapalı varsayılanı tasarımda yok → ürün sahibi kararı (öneri: push izni verildiğinde üçü de açık).
- Sabah kombininin bildirimden önce Stylist ile **önceden üretilmesi** maliyet kararıdır → **Açık karar (A-1 / A-3)**; karar verilene kadar bildirim yalnız mevcut plana bakar.
- **Ton:** "Sakin, editoryal, kişisel." Sen dili, kısa cümle, ünlem ve aciliyet dili yok ("Bugün ofis günü. Lacivert blazer hazır."). Metin sunucuda kod + parametre olarak kurulur, cümle TR/EN çeviri dosyasındadır. Bildirim metninde başka kullanıcının puanı kişi adıyla verilebilir; fotoğraf ya da try-on görseli bildirime **konmaz**.

---

## DynamoDB Key Patterns

Ortak altyapı entity'leri:

| Entity | pk | sk |
|---|---|---|
| `UserEntity` | `"users"` | userId |
| `AuthIdentityEntity` (sağlayıcı kimliği → userId) | `"authidentity"` | `{provider}#{subject}` (apple sub, google sub, E.164 telefon, küçük harf e-posta) |
| `RefreshTokenEntity` | `"RefreshToken"` | token |
| `LoginCodeEntity` (kod hash'i, deneme sayısı, TTL 10 dk) | `"logincode"` | `{channel}#{destination}` |
| `TenantEntity` (profil/ayarlar; sürümlü) | `"tenant"` | tenantId |
| `UserTenantIndexEntity` | `"user#{userId}#tenant"` | tenantId |
| `MutationReceiptEntity` (idempotency, TTL 30 gün) | `"tenant#{tenantId}#mutation"` | clientMutationId |
| `JobEntity` (uzun iş durumu; TTL) | `"tenant#{tenantId}#job"` | jobId |
| `UsageEntity` (kota sayaçları + rezervasyonlar; TTL) | `"tenant#{tenantId}#usage"` | `{kind}#{yyyy-MM}` |
| `EntitlementEntity` (tier, source, startsAt, expiresAt) | `"tenant#{tenantId}#entitlement"` | `{source}#{id}` |
| `PurchaseEntity` | `"tenant#{tenantId}#purchase"` | originalTransactionId |
| `PurchaseIndexEntity` (mağaza bildirimi → tenant) | `"purchase"` | originalTransactionId |
| `NotificationPrefEntity` | `"tenant#{tenantId}#notifpref"` | userId |
| `ReminderSlotEntity` | `"reminderutc#{HH}"` | tenantId |
| `DeviceEntity` | `"tenant#{tenantId}#device"` | deviceId |
| `FeedbackEntity` | `"feedback#{yyyy-MM}"` | `{unix ms}#{ulid}` |
| `AnalyticsEventEntity` (TTL 400 gün) | `"analytics#{yyyy-MM-dd}"` | `{unix ms}#{ulid}` |

**Droblet — tenant entity'leri** (hepsi hesap silme listesinde):

| Entity | pk | sk | Not |
|---|---|---|---|
| `TenantEntity` (ek alanlar) | `"tenant"` | tenantId | `displayName`, `handle`, `closetVisibility` (varsayılan A-6), `segment`, `language`; sürümlü |
| `StyleProfileEntity` | `"tenant#{tenantId}#styleprofile"` | `"current"` | segment, 3 `StyleTag`, `Budget`; sürümlü |
| `BodyProfileEntity` | `"tenant#{tenantId}#bodyprofile"` | `"current"` | boy (cm), kilo (kg), beden; sürümlü. Başkasına hiç açılmaz |
| `PhotoEntity` | `"tenant#{tenantId}#photo"` | `{kind}#{photoId}` | `kind` = body / face; `s3Key`, `active`, `createdAt`. Kind başına tek aktif |
| `ItemEntity` | `"tenant#{tenantId}#item"` | itemId (ULID, istemci) | ad, `ItemCategory`, renkler, kumaş, sezonlar, beden, `source` (Photo / CatalogProduct), `productId?`, `imageKey`, `wearCount`, `lastWornAt`; sürümlü |
| `ItemDraftEntity` | `"tenant#{tenantId}#itemdraft"` | draftId | durum, `originalKey`, `processedKey`, öneriler + güven + işaretli alanlar. **TTL 7 gün (öneri)** — onaylanmayan taslak ve S3 nesneleri (S3 lifecycle aynı süre) silinir |
| `LookEntity` | `"tenant#{tenantId}#look"` | lookId (ULID — zaman sıralı, akış için) | ad, `Occasion`, 5 slot (`{ itemId \| productId }`), `favorite`, `source`; sürümlü |
| `LookRatingSummaryEntity` | `"tenant#{tenantId}#lookrating"` | lookId | `sum`, `count` — `AtomicIncrementInMapAsync`; ayrı entity, böylece puanlar sahibin look düzenlemesini 409'a düşürmez |
| `RatingEntity` (sahibin partition'ı) | `"tenant#{ownerTenantId}#rating"` | `{lookId}#{raterTenantId}` | `score`, `updatedAt` |
| `RatingGivenEntity` (puanlayanın partition'ı) | `"tenant#{raterTenantId}#ratinggiven"` | `{ownerTenantId}#{lookId}` | Puanlayan hesabını silince karşı taraftaki `Rating` + özet düzeltmesi için |
| `PlanDayEntity` | `"tenant#{tenantId}#planday"` | `yyyy-MM-dd` | Takvim günü (kullanıcının yerel günü, saat yok); `Occasion`, `lookId?`; sürümlü |
| `WearLogEntity` | `"tenant#{tenantId}#wearlog"` | `{yyyy-MM-dd}#{ulid}` | `lookId?`, `itemIds`, `occurredAt` (UTC), `clientMutationId`. TTL yok (takvim ve istatistik geçmişi) |
| `TripEntity` | `"tenant#{tenantId}#trip"` | tripId | `cityId`, `startDate`, `endDate`, `TripType[]`, `cabinOnly`; sürümlü |
| `TripItemEntity` | `"tenant#{tenantId}#trip#{tripId}#item"` | itemId | `packed`, `packedAt`, `plannedWears` |
| `TripDayEntity` | `"tenant#{tenantId}#trip#{tripId}#day"` | `yyyy-MM-dd` | `lookId`, gün etiketi |
| `PaletteResultEntity` | `"tenant#{tenantId}#palette"` | `"current"` | sezon tipi id, yakışan/kaçınılacak renk id'leri, `sourcePhotoId?`, `analyzedAt`, model sürümü |
| `TryOnImageEntity` | `"tenant#{tenantId}#tryon"` | `{bodyPhotoId}#{targetKind}#{targetId}#{targetVersion}` | `s3Key`, `createdAt`. Saklama süresi (TTL) **Açık karar (A-3)** — depolama maliyetiyle birlikte |
| `CartLineEntity` | `"tenant#{tenantId}#cart"` | `{brandId}#{productId}#{size}` | `addedAt`, `clientMutationId`. Fiyat saklanmaz — okumada katalogdan; markaya göre gruplama sk önekinden gelir |
| `FollowingEntity` | `"tenant#{tenantId}#following"` | followeeTenantId | |
| `FollowerEntity` | `"tenant#{tenantId}#follower"` | followerTenantId | `FollowingEntity` ile aynı transaction'da yazılır/silinir |
| `JobEntity`, `UsageEntity` | (ortak tablo) | | `UsageEntity` kind'ları: `tryon`, `stylist`, `pack`, `palette`, `itemprocess`, `complete` |

**Droblet — global entity'ler** (kullanıcı yazamaz; yalnız seed betiği / katalog senkronu / tanımlı worker yolu):

| Entity | pk | sk | Not |
|---|---|---|---|
| `HandleEntity` | `"handle"` | küçük harf handle | → tenantId. Koşullu yazım (benzersizlik); hesap silmede silinir |
| `PublicProfileIndexEntity` | `"publicprofile#{segment}"` | tenantId | Yalnız `closetVisibility = Public` olanlar; görünürlük değişince aynı transaction'da eklenir/silinir. `Teen` A-5'e kadar eklenmez |
| `BrandEntity` | `"brand"` | brandId | ad, mağaza yönlendirme tabanı (affiliate parametresi A-2), `retired` |
| `CatalogProductEntity` | `"catalog#product"` | productId | marka, ad, kategori, renkler, bedenler, fiyat (kuruş, `TRY`), `imageKey` (global), `productUrl`, `retired`, `updatedAt`. Kategori ve marka listelemesi GSI ile (`catalog#category#{category}` / `catalog#brand#{brandId}`, sk `{updatedAt}#{productId}`) |
| `EditEntity` | `"content#{lang}#edit"` | `{weekStart yyyy-MM-dd}#{editId}` | başlık, tarih aralığı, gün başına look (stil notu + productId'ler) |
| `CreatorEntity` / `CreatorLookEntity` | `"content#{lang}#creator"` / `"content#{lang}#creatorlook#{creatorId}"` | creatorId / lookId | Kaynak ve haklar A-7 |
| `SeriesOutfitEntity` | `"content#{lang}#series"` | outfitId | Lisans A-7 |
| `ColorEntity` (renk sözlüğü) | `"reference#color"` | colorId | TR/EN ad, hex, renk ailesi — vision guard, palet ve uyum kuralları için |
| `SeasonTypeEntity` | `"reference#seasontype"` | seasonTypeId | TR/EN ad, yakışan/kaçınılacak aileler |
| `CityEntity` | `"reference#city"` | cityId | A-4 şehir seçimi ise |
| `WeatherForecastEntity` | `"weather#{cityId}"` | `yyyy-MM-dd` | min/max °C, durum; **TTL** `Weather.CacheMinutes` |
| `CatalogImageCacheEntity` | `"aicache#catalogimage"` | `{productId}#{sourceImageHash}#{pipelineVersion}` | Arka planı temizlenmiş katalog görselinin global anahtarı |

**Kurallar:**
- Her zaman entity'nin kendi `GetPk()` / `GetSk()`'si — anahtar dizgisi satır içinde kurulmaz
- Tenant kapsamlı entity'lerin `pk`'sinde `tenantId` bulunur
- Dile/bölgeye göre ayrılabilecek global veri baştan bölümlenir (ör. `content#{lang}#…`)
- Mevcut anahtar desenleri göç planı olmadan değiştirilmez
- **Yeni bir tenant kapsamlı entity, hesap silme listesine aynı PR'da eklenir**

---

## Global veri / seed

- Global veri repoda, sürümlü dosyalarda durur; bir betik dosyaları doğrular (şema, zorunlu çeviriler, tekrar eden kimlik) ve global bölümlere yazar. Konsoldan elle veri girilmez.
- Global kimlikler **asla yeniden kullanılmaz** ve silinmez (kullanıcı verisi onlara bağlı olabilir); yayından kaldırılan öğe `retired` işaretlenir.
- Çalışma anında worker'lar global veriye ancak tanımlı bir yoldan yazar; kullanıcıya özel sonuçlar global veriye girmez.

**Droblet global veri kaynakları:**

| Veri | Kaynak | Yol |
|---|---|---|
| Renk sözlüğü, sezon tipleri, renk uyum tablosu, şehirler | Elle, repoda | `seed/reference/` → `tools/Seed` betiği |
| Haftanın edit'i, editör look'ları | Editör, elle (haftalık); ürünler katalog kimliğiyle bağlanır | `seed/content/{lang}/edit/` → `tools/Seed` |
| Influencer/editör içerikleri, dizi outfitleri | **Açık karar (A-7)** — kaynak, haklar, lisans | Karar sonrası `seed/content/` |
| Marka ve katalog | **Açık karar (A-2)** — marka feed'i / affiliate ağı / elle | `ICatalogSource` arkasında senkron işi; aynı doğrulama (şema, zorunlu alan, fiyat, bedenler) seed betiğiyle ortak. Elle ise `seed/catalog/` |
| Hava tahmini | **Açık karar (A-4)** | Çalışma anında `IWeatherProvider` → `WeatherForecastEntity` (TTL'li önbellek) |

Katalogdan kalkan ürün silinmez, `retired` olur (sepet, look slotu ve gardıroba eklenmiş parçalar ona bağlıdır). Edit'teki ürün `retired` olursa edit yeniden yayımlanmadan satırda "stokta yok" gösterilir.

### AI maliyeti: bir kez üret, herkese kullan

AI ile üretilen her şey kişiye özel değilse **global** saklanır ve tüm kullanıcılar oradan okur — aynı şey için ikinci kez AI çağrılmaz. Önbellek anahtarı normalize edilmiş girdi + çıktıyı etkileyen parametrelerdir. Kişiye özel çıktılar önbelleğe girmez.

**Droblet'te:**

| AI çıktısı | Global önbellek? | Anahtar | Kota |
|---|---|---|---|
| Katalog ürünü — arka planı temizlenmiş görsel | **Evet** | `{productId}#{sourceImageHash}#{pipelineVersion}` | Kullanıcı kotasından düşmez (operasyon maliyeti) |
| Katalog ürünü — kategori/renk/kumaş öznitelikleri (feed eksikse) | **Evet** | `{productId}#{sourceImageHash}#{modelVersion}` | Düşmez |
| Edit / creator look'larının düz (flat-lay) görselleri | **Evet** (kişiye özel değil) | `{lookId}#{contentVersion}` | Düşmez |
| Parça fotoğrafı işleme ve tanıma (ItemProcessor) | **Hayır — asla** | — | `itemprocess` (A-1) |
| Try-on görseli | **Hayır — asla.** Yalnız tenant içi yeniden kullanım (`TryOnImageEntity` sk'si) | `{bodyPhotoId}#{kind}#{id}#{version}` (tenant partition'ında) | `tryon` (Premium sınırsız; Free A-1). Tenant içi önbellekten dönen görsel kotadan düşmez |
| Palet sonucu | **Hayır — asla** | — | `palette` |
| Stilist önerileri, bavul, eksik parça | Hayır (gardıroba ve profile özel) | — | `stylist` / `pack` / `complete` |

Kural: girdisinde kullanıcının **herhangi bir** fotoğrafı ya da türevi olan çıktı global önbelleğe girmez — global önbelleğe yazan kod yolu girdi olarak yalnız global kimlik (productId, lookId) kabul eder.

---

## Senkron ve çakışma — sunucu tarafı (çevrimdışı / çok cihaz varsa)

Mobil tarafı [MOBILE_ENGINEER.md](MOBILE_ENGINEER.md)'de. Aynı hesap birden çok cihazda, çoğu zaman çevrimdışı çalışıyorsa sunucunun verdiği üç söz:

1. **Olay yazmaları idempotenttir.** Her olay bir `clientMutationId` ve cihazdaki zamanı (`occurredAt`) taşır. Aynı `clientMutationId` ikinci kez gelirse uygulanmaz ama 200 döner. Sunucu hesaplı durum olay zamanı sırasına göre ilerler: geç gelen eski bir olay geçmişe yazılır ama durumu geri saramaz. İki cihaz aynı anda yazarsa sunucu yeniden okuyup yeniden uygular — kullanıcıya çakışma sorulmaz.
2. **Düzenlenebilir alanlar sürümle yazılır.** `PUT`/`PATCH` bir `baseVersion` taşır. Kayıttaki `version` farklıysa yazılmaz; **409 + güncel kayıt** döner. Sunucu birleştirme yapmaz; neyin kazanacağına kullanıcı karar verir.
3. **Silinmiş kayıt geri gelmez.** Silinmiş bir kayda gelen `PUT` ya da olay 404 döner; istemci bunu "Bu kaydı başka bir cihazda sildin" diye gösterir.

---

## Configuration

Config, Lambda cold start'ta SSM Parameter Store'dan yüklenir.

**SSM path**: `/droblet/{stage}/api`

```json
{
  "Jwt":          { "SecretKey": "...", "Issuer": "...", "Audience": "...", "ExpirationMinutes": 60 },
  "GoogleAuth":   { "ClientId": "...", "ClientSecret": "..." },
  "AppleAuth":    { "BundleId": "com.alatech.droplet", "TeamId": "...", "KeyId": "...", "PrivateKey": "..." },
  "Email":        { "Provider": "Ses", "From": "Droblet <...>",
                    "Smtp": { "Host": "...", "Port": 587, "Username": "...", "Password": "..." } },
  "Sms":          { "Provider": "", "AllowedCountryCodes": ["..."] },
  "Login":        { "CodeTtlMinutes": 10, "MaxAttempts": 3, "ResendCooldownSeconds": 30 },
  "Ai":           { "Enabled": true },
  "Entitlements": { "...": "paket başına sayısal sınırlar (proje gerektirirse)" },
  "Store":        { "AppleIssuerId": "...", "AppleKeyId": "...", "ApplePrivateKey": "...",
                    "GoogleServiceAccountJson": "...",
                    "ProductIds": { "...": ["..."] }, "NotificationKey": "..." },
  "FirebaseServiceAccount": { "project_id": "...", "client_email": "...", "private_key": "..." }   // yalnız Notifier
}
```

Hangi yeteneğin hangi pakette olduğu (`EntitlementPolicy`) kodda ve testlidir; yalnız sayısal sınırlar SSM'dedir — koda dokunmadan değiştirilir. AI sağlayıcı anahtarı ve modeller yalnız worker'ların okuduğu `/droblet/{stage}/worker/Ai`'dadır (DEVOPS_ENGINEER.md). `Login.MaxAttempts` ve `ResendCooldownSeconds` istemcideki metinle uyumlu tutulur.

**Droblet'e özel bölümler** (`com.alatech.droplet` → Açık karar A-10; `"…"` değerleri karar/ölçüm sonrası yazılır, kodda varsayılan uydurulmaz):

```json
{
  "Sms":          { "Provider": "" },                       // SMS yok — telefon kanalı 503
  "Entitlements": {
    "Free":    { "TryOnPerMonth": "A-1", "StylistPerMonth": "A-1", "PackPerMonth": "A-1",
                 "PalettePerMonth": "A-1", "ItemProcessPerMonth": "A-1", "CompletePerMonth": "A-1",
                 "WardrobeItemMax": "A-1" },
    "Premium": { "TryOnPerMonth": null,                      // sınırsız — paywall vaadi
                 "ItemProcessPerMonth": "A-1", "CompletePerMonth": "A-1", "WardrobeItemMax": "A-1" },
    "TryOnPerMinute": "..."                                  // kötüye kullanım hız sınırı, kota değil
  },
  "Store":        { "ProductIds": { "Premium": ["A-1 / A-10 sonrası: aylık", "yıllık"] } },
  "Storage":      { "PrivateBucket": "...", "PublicAssetBucket": "...",
                    "UploadUrlMinutes": "...", "ReadUrlMinutes": "...", "MaxPhotoBytes": "...",
                    "MaxBatchUpload": "..." },                // toplu ekle (13) tek seferde kaç fotoğraf: PM
  "Packing":      { "CabinMaxItems": "Açık karar — ürün sahibi" },
  "Social":       { "MaxFollowing": "...", "FeedPageSize": "...", "SuggestedPageSize": "..." },
  "Weather":      { "Provider": "A-4", "CacheMinutes": "..." },
  "Catalog":      { "Source": "A-2" },
  "Notifications":{ "DefaultMorningLocal": "07:30 (öneri)", "DefaultWeeklyEditLocal": "Mon 09:00 (öneri)",
                    "DefaultFriendRatingsLocal": "19:00 (öneri)", "DailyLimit": "..." }
}
```

Worker yolu `/droblet/{stage}/worker/Ai`: iş türü başına sağlayıcı + model (`ImageCleanup`, `GarmentVision`, `TryOn`, `StylistLlm`, `Palette`) — hepsi **Açık karar (A-3)**. Worker'lar ayrıca `Storage` ve `Weather`'ı okur. `PackingRules`'taki "en az 2 kez" config değildir, koddadır.

**Lambda environment variables**:
- `SYSTEMS_MANAGER_PATH` — `/droblet/{stage}/api` (Api), `/worker` (worker'lar), `/notifier` (Notifier); yükleyici: `Infrastructure/Configuration/SsmConfigurationExtensions.cs` (parametre adı = config bölümü)
- `TABLE_NAME` — yoksa `droblet-dev-table` (`DynamoDbConstant.TableName`)
- `ITEM_PROCESS_REQUEST_QUEUE_URL`, `STYLIST_REQUEST_QUEUE_URL`, `TRYON_REQUEST_QUEUE_URL`, `PALETTE_REQUEST_QUEUE_URL` (yalnız Api)
- `STAGE` — `prod` / `dev`

---

## Development Workflow

```bash
dotnet restore Droblet.sln
dotnet build Droblet.sln
dotnet test Droblet.sln

# Specific project
dotnet test tests/ApiTests/ApiTests.csproj

# With coverage
dotnet test Droblet.sln --collect:"XPlat Code Coverage"
```

**Deployment**: `main`'e push → GitHub Actions `deploy-lambdas.yml` tüm Lambda'ları yayınlar.

---

## Coding Rules

1. **Lambda handler'ında iş mantığı yok** — handler yönetir, servis karar verir
2. **Tüm girdiler doğrulanır** — DB çağrısından önce FluentValidation
3. **Tüm DB erişimi Repository'den** — yalnız `IRepository`, ham AWS SDK yok
4. **Baştan sona async** — `.Result`, `.Wait()` yok
5. **tenantId için `IApiContext`** — JWT elle çözülmez, gövdeden okunmaz
6. **Her zaman `GetPk()` / `GetSk()`** — anahtar dizgisi satır içinde kurulmaz
7. **Yapısal log** — log bağlamında `tenantId`, ilgili kayıt / `requestId`; **prompt'un tamamı, AI cevabının tamamı, telefon numarası, e-posta ve OTP loglanmaz**
8. **Sır kodda yok** — tüm config SSM ya da ortam değişkeninden
9. **DTO'lar için `record`** — istek/cevap modelleri değişmez record'lardır
10. **AI çıktısı doğrulanmadan kullanılmaz** — şema, referans kontrolü, guard/validator
11. **AI taslağı kullanıcı verisine yalnız kullanıcı onayıyla yazılır**
12. **Paket kararı yalnız `EntitlementPolicy`'de** — uçta `if (tier == Premium)` yok
13. **Sunucu hesaplı durumu yalnız kendi domain kuralı değiştirir**

**Droblet değişmezleri:**

14. **Kullanıcı fotoğrafları yalnız özel S3'te** (`tenant/{tenantId}/…` öneki) ve yalnız kısa ömürlü presigned URL ile — kalıcı/herkese açık URL, CDN önbelleği ya da başka tenant'a URL yok. Presigned GET, `IApiContext.TenantId` ile anahtarın önekinin eşleştiği kontrol edildikten sonra üretilir
15. **Boy/yüz fotoğrafı ve try-on görseli hiçbir görünürlük ayarında başkasına gösterilmez, hiçbir zaman global önbelleğe girmez** — `VisibilityPolicy`'de izin yolu yok; testle sabit
16. **Fotoğraf silme hesap silmeden bağımsızdır ve eksiksizdir:** `DELETE v1/tenant/photo` boy + yüz fotoğraf nesnelerini, **tüm** `TryOnImage` kayıtlarını ve nesnelerini siler, `PaletteResult.sourcePhotoId`'yi boşaltır. Boy fotoğrafını değiştirmek eskisinden türeyen try-on görsellerini siler. Uçuştaki TryOn/Palette işi sonuç yazmadan kaynağın hâlâ aktif olduğunu kontrol eder (`SourceDeleted`)
17. **Başka tenant'ın verisine okuma yalnız `VisibilityPolicy`'den**, reddedilen okuma 404; başka tenant'a yazma yalnız takip ve puan
18. **AI taslağı (`ItemDraft`, stilist önerisi, bavul taslağı) `Item`/`Look`/`PlanDay`/`Trip*`'a yalnız kullanıcı onay ucuyla yazılır**
19. **Look slotları `OutfitSlotRules`'tan, bavullar `PackingRules`'tan geçer** — Api'de de, worker guard'ında da aynı kural sınıfı
20. **Ödeme Droblet'te alınmaz** — sepet yalnız marka sitesine yönlendirme linki üretir; kart/ödeme verisi hiçbir uçta kabul edilmez
21. **Fiyatlar tamsayı kuruş + para birimi** (`TRY`); toplamlar sunucuda, okumada güncel katalogdan
22. **Hesap silme karşı tenant'ları da temizler:** kendi partition'ları + S3 öneki + `Handle` + `PublicProfileIndex` + karşı tarafların `Follower`/`Following` kayıtları + verdiği `Rating`'ler (ve ilgili `LookRatingSummary` düzeltmesi)
23. **Takvim günü ≠ an:** `PlanDay`/`WearLog`/`Trip` tarihleri kullanıcının yerel takvim günüdür (`yyyy-MM-dd`); olay anları (`occurredAt`, `createdAt`) UTC
24. **Log'a fotoğraf anahtarı/URL'i, beden/kilo, yüz analizi sonucu yazılmaz**; yalnız `tenantId`, `jobId`, kimlikler

---

## Checklist Before Raising a PR
- [ ] `dotnet build` sıfır uyarıyla geçiyor
- [ ] `dotnet test` geçiyor
- [ ] Yeni uç nokta `IEndpoint` uyguluyor
- [ ] İstek gövdesinin FluentValidation validator'ı var
- [ ] Tüm `IResult` durum kodları `MapEndpoint`'te beyan edilmiş (`.Produces<T>`, `.Produces(...)`)
- [ ] `IRepository` dışında ham DynamoDB SDK çağrısı yok
- [ ] Sabit pk/sk dizgisi yok — `GetPk()` / `GetSk()`
- [ ] Sunucu hesaplı durum değişikliği domain kuralı + olay kaydından geçiyor
- [ ] Paket farkı olan uç `EntitlementPolicy`'den geçiyor
- [ ] Çevrimdışı tekrar gönderilebilecek her yazma idempotent
- [ ] Widget snapshot şekli değiştiyse `schemaVersion` ve eski widget uyumu düşünüldü
- [ ] Yeni tenant kapsamlı entity silme listesine eklendi
- [ ] Başka tenant'ı okuyan yeni yol `VisibilityPolicy`'den geçiyor; fotoğraf/try-on türevi yeni bir veri "fotoğrafları sil" akışına eklendi ve global önbelleğe yazılmıyor
- [ ] Yeni AWS kaynağı eklendiyse `template.yaml` güncellendi
- [ ] PR açıklaması neyin neden değiştiğini anlatıyor
