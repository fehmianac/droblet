# QA Engineer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
Droblet'in kalitesinden backend, mobil, (varsa) widget'lar ve AI çıktısı boyunca sen sorumlusun. Test stratejisini tanımlar ve yürütür, otomatik testler yazar, kabul kriterlerini doğrular ve özellikler `main`'e merge edilmeden önce onay verirsin.

Bu rolü Claude üstlenir; **gerçek cihaz testleri ürün sahibindedir** (her sprint demosunda iki telefonla). Claude her sprint için yazılı bir cihaz test listesi hazırlar.

Alışılmış QA'dan farklı olabilecek işler:
1. **Widget / sistem yüzeyleri gerçek cihazda test edilir** (proje gerektirirse). Yenileme bütçesi, kilit ekranı, çevrimdışı cevaplar ve kurulum akışı simülatörde güvenilir değildir.
2. **Yetki matrisi bir kalite kapısıdır** (paketli üründe). Matristeki her hücre bir testtir; paket bittiğinde kullanıcının kendi verisine erişimi gibi kritik kurallar ayrı ve **Critical**.
3. **AI değerlendirme setinin bakımı** (AI içeren üründe). AI Engineer ve içerik doğrulayıcısıyla birlikte; regresyon vakaları senin kalite kapındır.

**Droblet QA öncelikleri:**
- **Gizlilik vaadi kalite kapısıdır (Critical).** "Fotoğrafların ve senin üzerinde üretilen görseller yalnızca sana açıktır." — boy/yüz fotoğrafı ve try-on çıktısı **hiçbir görünürlük ayarında** (Herkese açık / Yalnızca takipçiler / Gizli) başka kullanıcıya, anonim isteğe ya da paylaşım linkine çıkmaz. Her sürümde elle + otomatik test.
- **Silme kalite kapısıdır (Critical).** "Fotoğraflarımı ve üretilen görselleri sil" ve "Hesabımı sil" fotoğrafları ve türetilmiş görselleri gerçekten siler (S3 dahil); fotoğraf silme hesap silmeden bağımsız çalışır.
- **Başka kullanıcının verisi yalnız `VisibilityPolicy`'den okunur** — sosyal uçların her biri görünürlük × takip ilişkisi matrisiyle test edilir (Critical).
- **Yetki matrisi** (Üyelik: sınırsız üzerimde gör, stil danışmanı, akıllı bavul, renk paleti; ücretsiz paket A-1) — her hücre bir test.
- **AI taslak onayı** — parça taslağı kullanıcı "gardıroba ekle" demeden kaydedilmez; Stylist çıktısında gardıropta olmayan `itemId` yok; bavulda her parça ≥2.
- **Kamera, toplu yükleme ve çevrimdışı kuyruk** gerçek cihazda.
- **Try-on görsel QA** — insan değerlendirmesi, her model/prompt değişikliğinde.
- **Ödeme Droblet'te alınmaz** — sepet her zaman marka sitesine yönlendirir.
- Widget yok (tasarımda yok) — widget bölümleri şimdilik uygulanmaz.

---

## Testing Strategy

### Testing Pyramid

```
           /\
          /E2E\          ← Az sayıda, yüksek değerli kullanıcı yolculuğu (Maestro)
         /------\
        / Integration\   ← API uçları, SQS akışları, MSW ile ekranlar
       /------------\
      /  Unit Tests   \  ← En çok, en hızlı
     /________________\
   + AI değerlendirme seti (her prompt/model değişikliğinde)
   + Gerçek cihaz matrisi (her sürümde, elle — widget'lar dahil)
```

| Level | Scope | Owned by |
|---|---|---|
| Unit | Fonksiyonlar, servisler, domain kuralları | Backend / Mobil |
| Integration | API uçları, Lambda handler'ları, DB etkileşimi; mobilde MSW | QA + Backend + Mobil |
| End-to-End | Uçtan uca kullanıcı yolculukları (Maestro) | QA |
| AI evaluation | AI çıktısının doğruluğu, dayanağı, kural uyumu | QA + AI Engineer |
| Manual | Gerçek cihaz matrisi, widget'lar, keşif testleri | QA |

---

## Backend Testing

### Test Projects

```
tests/
├── ApiTests/             # Endpoint handler tests
├── DomainTests/          # Domain servisleri ve kural sınıfları (yetki politikası, AI çıktı guard/validator'ları, ...)
├── InfrastructureTests/  # Repository: koşullu yazım, makbuzlu transaction
├── ItemProcessorTests/   # Parça fotoğrafı → taslak (AI sağlayıcısı mock'lu), kota iadesi
├── StylistTests/         # Kombin / plan / bavul / eksik parça (mock'lu), yedeğe düşme
├── TryOnTests/           # Try-on (mock'lu), içerik denetimi, tenant önekine yazım
├── PaletteTests/         # Palet (mock'lu), enum doğrulama, reddetme
└── NotifierTests/        # Bildirim zamanlaması, sessiz saat, günlük sınır
```

| Proje | Kapsadığı sınıflar |
|---|---|
| `DomainTests` | `EntitlementPolicy`, `VisibilityPolicy`, `ItemDraftValidator`, `OutfitOutputGuard`/`OutfitValidator`/`RuleBasedOutfit`, `WeekPlanValidator`/`RuleBasedWeekPlan`, `PackingValidator`/`RuleBasedPacking`, `MissingPieceValidator`, `TryOnOutputGuard`, `PaletteOutputGuard`/`PaletteValidator`, palet uyum oranı ve stil uyumu % kuralları, hava → kıyafet kuralları, hesap/fotoğraf silme listesi kapsama testi |
| `ApiTests` | Auth, profil, `StyleProfile`/`BodyProfile`, gardırop, look, plan/takvim, bavul, sosyal, katalog, sepet, yetki, iş başlatma + durum, presigned URL uçları, silme uçları |
| `InfrastructureTests` | Repository; S3 anahtar kurucusu (anahtar yalnız `IApiContext` tenant'ından) |
| `ItemProcessorTests`, `StylistTests`, `TryOnTests`, `PaletteTests` | Yukarıdaki ağaç |
| `NotifierTests` | Sabah kombin hatırlatması, haftanın edit'i, arkadaş puanları |
| `AiEvalTests` | Değerlendirme aracı (AI_ENGINEER.md) |

### Running Backend Tests

```bash
dotnet test Droblet.sln
dotnet test tests/ApiTests/ApiTests.csproj
dotnet test Droblet.sln --logger "console;verbosity=detailed"
dotnet test Droblet.sln --collect:"XPlat Code Coverage"
```

### Unit Test Guidelines (xUnit)

İsim deseni: `{Sınıf}_{Koşul}_{BeklenenSonuç}`; Arrange / Act / Assert.

```csharp
[Fact]
public void EntitlementPolicy_WhenPremiumExpired_StillAllowsAccessToOwnData()
{
    // Arrange
    var usage  = UsageSnapshot.Empty with { OwnItems = 142 };
    var limits = EntitlementLimitsFixture.Default;

    // Act
    var decision = EntitlementPolicy.Check(Tier.Free, Capability.AccessOwnItem, usage, limits);

    // Assert
    Assert.True(decision.Allowed);
}
```

### What to Test — Backend

#### Domain (`DomainTests`)
- Durum makineleri: her geçiş ve geri düşme; **geç gelen eski olay durumu geri saramaz**; aynı anda iki olay
- Yetki politikası (varsa): **yetki matrisinin her hücresi** (her paket × her yetenek); sayısal sınırlar (günlük/haftalık/toplam); abonelik bitince korunması gereken erişimler
- Kötüye kullanım kuralları (davet/kupon vb. varsa): kişi, cihaz ve mağaza hesabı başına bir kez; zaman penceresi; kendi kodu
- AI çıktı guard/validator'ları: kütüphanede olmayan referans atılır; yanlış dil/format reddedilir; uzunluk sınırı
- Kural tabanlı yedekler: AI taslağı geçmezse yedek **her zaman** geçerli çıktı üretir

Droblet domain kuralları:

| Sınıf | Test edilecek kurallar |
|---|---|
| `VisibilityPolicy` | Gizli dolap → takipçi dahil kimse parça/look göremez; Yalnızca takipçiler → takip etmeyen göremez, takip eden görür; Herkese açık → herkes parça/look görür. **Üç ayarda da** boy/yüz fotoğrafı, try-on çıktısı, palet sonucu, beden/boy/kilo, sepet, takvim **asla** dönmez. Takip bırakılınca erişim hemen kapanır. Engellenmiş/silinmiş kullanıcı görünmez |
| `EntitlementPolicy` | Matrisin her hücresi (Üyelik × try-on, günlük kombin, akıllı bavul, renk paleti; ücretsiz paket A-1). Abonelik bitince: gardırop, look, bavul, takvim, mevcut palet sonucu ve kendi fotoğraflarına erişim + silme açık kalır |
| `ItemDraftValidator` | Enum dışı kategori/renk/kumaş/sezon → alan boş + "kontrol et"; çoklu parça → "kontrol et"; boş maske reddedilir |
| `OutfitValidator` / `OutfitOutputGuard` | Gardıropta olmayan ya da aday dışı `itemId` atılır, `grounded=false`; slot-kategori uyumu; "sadece gardırobum" açıkken katalog önerisi yok; başka tenant'ın `itemId`'si atılır; 3 öneri farklı; beden/kilo yorumu içeren açıklama reddedilir |
| `PackingValidator` | Her parça ≥2 kez; her gün bir look; kabin sınırı; kısa seyahat kenar durumu (AI_ENGINEER.md Kural 11) |
| `RuleBasedOutfit` / `RuleBasedWeekPlan` / `RuleBasedPacking` | Küçük gardıropta bile geçerli çıktı ya da açık `insufficient_wardrobe`; asla gardırop dışı parça |
| `MissingPieceValidator` | `retired` ürün önerilmez; aday dışı ürün atılır |
| `PaletteValidator` | Sezon tipi enum'da; renkler tablodan; uyum oranı deterministik |
| Silme kapsama testi | Her tenant kapsamlı `GetPk` ve her S3 önek türü silme listesinde (SECURITY_ENGINEER.md §Silme listesi) |

#### Api (`ApiTests`)
- Kimlik: geçerli JWT erişim verir; süresi dolmuş/geçersiz JWT 401
- OTP: yanlış kod kalan deneme sayısını döner; deneme sınırı ve yeniden gönderme bekleme süresi; `start` kayıtlı/kayıtsız aynı cevap
- Doğrulama: geçersiz gövde 400 + hatalar
- **Kullanıcı/tenant izolasyonu**: kullanıcı başka kullanıcının kaydına erişemez
- Idempotency: aynı `clientMutationId` iki kez gelirse bir kez uygulanır; gelecekteki zaman damgası reddedilir
- Sürümlü kayıt `PUT`: eski `baseVersion` → 409 + güncel kayıt; silinmiş kayda yazma → 404
- AI uçları: yetkisiz paket → 403; kota dolu → 429; sağlayıcı hatasında kota iade edilir
- AI taslağını kullanıcı onayı olmadan kalıcı kayda yazan bir uç yok
- Snapshot/özet uçları (widget vb.): pakete göre içerik; `schemaVersion` var
- Satın alma: sahte/oynanmış işlem kimliği reddedilir; mağaza bildirimi yalnız yeniden okumayı tetikler
- Her hata durumu kendi hata koduyla döner

#### Worker Lambda'ları (`ItemProcessorTests`, `StylistTests`, `TryOnTests`, `PaletteTests`)
- Sağlayıcı geçersiz JSON döndürürse iş `Failed(ProviderError)` olur, çökmez, kota iade edilir
- AI reddederse taslak önerilmez, kota düşmez
- Son denemede iş `Failed` işaretlenir (kullanıcı ekranda takılı kalmaz)
- Validator'dan geçmeyen AI taslağı yerine kural tabanlı yedek kaydedilir
- `ItemProcessor`: taslak `Item` olarak değil, iş sonucunda taslak olarak saklanır; işlenmiş görsel yalnız tenant önekine yazılır; EXIF temizlenmiş
- `TryOn`: çıktı yalnız `tenant/{tenantId}/tryon/` önekine; içerik denetiminden geçmeyen görsel S3'e yazılmaz; boy fotoğrafı silinmişse iş `Failed`, kota iade; global önbelleğe yazan kod yolu yok
- `Palette`: yüz yok / çoklu yüz → `photo_unsuitable`, kota düşmez
- Kullanıcı iş sürerken fotoğrafını sildiyse worker sonucu yazmaz (silmeyle yarış)

#### Notifier (`NotifierTests`)
- Gönderilecek içeriği olmayana bildirim gitmez
- Sessiz saatlerde gitmez; günlük sınır aşılmaz
- Saat dilimleri: farklı UTC ofsetleri ve yaz saati geçişi olan bölgelerdeki kullanıcılar kendi yerel saatinde alır
- Pazarlama rızası olmayana pazarlama bildirimi gitmez
- Geçersiz token silinir

---

## Mobile Testing

### Araçlar
- **Jest + React Native Testing Library** — birim/bileşen
- **Mock Service Worker** — ekranlar, kaydedilmiş API cevaplarıyla
- **Maestro** — E2E

```bash
cd mobile
npm test
maestro test .maestro/
```

### Bileşen testi örneği

```tsx
test('Free kullanıcıda premium özellik kilitli ama görünür', () => {
  render(<FeatureCard entitlement={{ tier: 'free', feature: false }} item={fixtureItem} />);
  expect(screen.getByText(fixtureItem.title)).toBeOnTheScreen();
  expect(screen.getByText(t('common.premium'))).toBeOnTheScreen();
});

test('409 geldiğinde çakışma seçeneklerini gösterir', async () => {
  server.use(conflictOn('/v1/tenant/item/1', { note: 'updated elsewhere', version: 4 }));
  // ...
  expect(await screen.findByText(t('sync.conflict.title'))).toBeOnTheScreen();
});
```

---

## Test Scenarios by Feature

Aşağıdaki ilk tablolar her projede geçerli genel desenlerdir; Droblet'e özgü senaryolar epic numaralarıyla (E1–E12, README §4) "Droblet senaryoları" altında.

### Onboarding ve giriş
| Scenario | Expected | Priority |
|---|---|---|
| İlk açılış → Welcome | Yeni kullanıcı ürün vaadini 10 sn'de anlatabiliyor (kullanıcı testi) | High |
| Push açıklaması → sistem izni reddedildi | Akış devam eder; Ayarlar'dan açılabilir | High |
| Telefon + OTP, yanlış kod | Kalan deneme sayısı, yeniden gönderme bekleme süresi | High |
| E-posta + OTP, süresi dolmuş kod | Net mesaj + yeniden gönder | High |
| iOS'ta Google sunuluyorsa Apple da var | Apple butonu native | Critical |
| Arayüz dili değiştirme | Tüm metinler çevrilmiş; taşma yok | High |

### Çevrimdışı ve senkron
| Scenario | Expected | Priority |
|---|---|---|
| Uçak modunda N yazma → bağlan | Hepsi gider; ekran günceller | **Critical** |
| Aynı yazma iki kez gönderilir | Bir kez sayılır | **Critical** |
| İki telefonda aynı kayıt neredeyse aynı anda | İkisi de geçmişte; durum tutarlı | High |
| Kuyruk boşaltılırken token süresi doldu | Refresh, kuyruk kaybolmaz | High |
| Çevrimdışı → ağ gerektiren özellik | Açıklamalı durum; çevrimdışı yapılabilecek olan önerilir | High |

### Droblet senaryoları (epic bazında)

#### E1 Hesap ve onboarding (01–04)
| Scenario | Expected | Priority |
|---|---|---|
| Apple / Google / e-posta ile kayıt ve giriş | Hesap oluşur; iOS'ta Apple butonu native | Critical |
| Stil profili: Kadın / Erkek / Genç, 3 etiket, bütçe | Tam 3 etiket seçilmeden "Devam et" kapalı; seçim sonra değiştirilebilir | High |
| Genç (13–18) seçildi | A-5 kararındaki kısıtlar (yaş doğrulama, veli onayı, fotoğraf/sosyal kısıtı) uygulanıyor — karar gelene kadar kabul kriteri açık | **Critical** (karar sonrası) |
| Beden ve fotoğraf ekranında "Atla" | Akış devam eder; try-on ve palet yerinde "fotoğraf ekle" daveti | High |
| Boy fotoğrafı çek / yüz fotoğrafı yükle | Yüklenir; gizlilik metni ekranda görünür | Critical |
| Boy/kilo sınır dışı değer | Doğrulama hatası, TR/EN | Medium |

#### E2 Gardırop ve parça ekleme (10–13)
| Scenario | Expected | Priority |
|---|---|---|
| Kamera ile parça çek → "Gömlek algılandı · Beyaz · Pamuk" | Taslak alanlar dolu, kullanıcı düzenleyebilir; kaydetmeden gardıropta yok | **Critical** |
| Toplu ekle: 12 fotoğraf | İlerleme "8 / 12"; her parça ayrı iş; biri başarısız olsa diğerleri tamamlanır | High |
| Toplu ekle: "Kategoriyi kontrol et" işaretli parça | İşaret görünür; kullanıcı düzeltmeden de seçimden çıkarabilir | High |
| "4 parçayı gardıroba ekle" | Yalnız seçili 4 parça kaydedilir; çift dokunuşta çift kayıt yok (idempotent) | Critical |
| Taslak ekranından onaylamadan çık | Hiçbir `Item` yazılmadı; geçici yüklemeler lifecycle ile silinir | Critical |
| Filtre: kategori / sezon / renk / sıralama | Sonuç doğru; boş sonuç durumu | Medium |
| Parça detayı: giyilme sayısı, ilgili look'lar | `WearLog` ve look'larla tutarlı | Medium |
| Parça silindi, bir look'ta ve bavulda kullanılıyor | Look/bavul bozulmaz; slot "parça silindi" olarak gösterilir | High |

#### E3 Look'lar (14–15)
| Scenario | Expected | Priority |
|---|---|---|
| Look oluştur: 5 slot, gardıroptan ya da mağazadan | "3 / 5 parça seçildi"; kaydedilir | High |
| Look'a mağaza ürünü eklendi, ürün sonra `retired` | Look açılır; ürün "artık satışta değil" | Medium |
| Favori, ortam filtresi | Doğru | Medium |

#### E4 Bugün, haftalık plan, takvim (06–09)
| Scenario | Expected | Priority |
|---|---|---|
| Bugün: tarih, sezon, hava, günün ortamı | Yerel saate göre doğru gün; hava sağlayıcısı (A-4) yoksa ekran bozulmaz | High |
| "Bunu giyiyorum" | `WearLog` bir kez yazılır (çevrimdışı tekrar dahil); giyilme sayısı +1 | Critical |
| "Haftamı planla" / gün için "Öner" | Plan taslağı; onaylanınca `PlanDay` | High |
| Takvim: ne giydim / ne giyeceğim, ay özeti, en çok giyilen | `WearLog` ve `PlanDay` ile tutarlı | Medium |
| Gece yarısı / yaz saati geçişi | Gün kayması yok (UTC saklama) | High |

#### E5 Stilist ve bavul (16–19)
| Scenario | Expected | Priority |
|---|---|---|
| Ortam + hava + "Sadece gardırobum" → Kombin öner | 3 öneri; her parça gardıropta; katalog önerisi yok | **Critical** |
| "Sadece gardırobum" kapalı | En fazla eksik parça önerisi mağazadan; "Önerilen · Mağaza" etiketi | High |
| Ortama uygun parça yok | `insufficient_wardrobe` — eksik kategori söylenir; kota düşmez | High |
| "Takvime ekle" | `PlanDay` yazılır; onaysız yazım yok | Critical |
| Bavul: şehir, tarih, tip, sadece kabin | Liste + günlük look'lar; **her parça en az 2 kez**; kabin sınırı | **Critical** |
| Bavul hazırlık işaretleme "3 / 9 hazır" çevrimdışı | Kuyrukla senkronlanır | High |
| 1 günlük seyahat | AI_ENGINEER.md Kural 11'deki davranış | Medium |

#### E6 Üzerimde gör / try-on
| Scenario | Expected | Priority |
|---|---|---|
| Parça / look / mağaza ürünü için "Üzerimde gör" | Görsel üretilir; yükleniyor durumu; kota (A-1) doğru | High |
| Boy fotoğrafı yok | Try-on yerine "boy fotoğrafı ekle" daveti; iş başlatılmaz | High |
| Aynı kombin ikinci kez | Tenant içi önbellekten; ikinci kez kotadan düşmez | High |
| Boy fotoğrafı değişti | Eski try-on'lar geçersiz, yeniden üretilir | High |
| Try-on çıktısının URL'i başka hesapla / oturumsuz açılır | Erişim yok (imzalı URL süresi dolmuş ya da başka tenant) | **Critical** |
| İçerik denetimi tuzağı | Görsel gösterilmez, kota iade | Critical |

#### E7 Renk paleti (30)
| Scenario | Expected | Priority |
|---|---|---|
| Yüz fotoğrafı → sezon tipi | Enum'dan bir sezon; yakışan/kaçınılacak tonlar tablodan | High |
| Uygun olmayan fotoğraf | `photo_unsuitable`, yeniden çekme önerisi, kota düşmez | High |
| Gardırop uyum oranı, "Uyumsuz parçaları gör" | Deterministik; parça eklenince güncellenir | Medium |

#### E8 Keşfet, edit ve mağaza (08, 20–24)
| Scenario | Expected | Priority |
|---|---|---|
| Haftanın edit'i: ürün satırları, toplam | Toplam = satırlar toplamı (₺) | High |
| Mağaza arama/filtre (marka, renk, beden) | Doğru | Medium |
| "Gardırobundaki 7 parçayla uyumlu" → Göster | Listelenen parçalar kullanıcının kendi gardırobunda | Medium |
| Sepet markaya göre gruplanır; "{Marka}'da öde" | Marka sitesine gider; **Droblet'te ödeme/kart alanı yok** | **Critical** |
| Fiyatı olmayan ürün (`[FİYAT]`) | Toplamı bozmaz; A-2 kaynağına göre davranış | Medium |

#### E9 Sosyal (25–27)
| Scenario | Expected | Priority |
|---|---|---|
| Takip et / bırak | Akış ve dolap erişimi hemen güncellenir | High |
| Arkadaş look'unu puanla | Bir kullanıcı bir look'a bir puan; ortalama doğru | High |
| Arkadaş akışında look | Parçaların **düz görselleri / kolajı** gösterilir — sahibinin try-on görseli ya da boy fotoğrafı **asla** | **Critical** |
| "Dolabını keşfet" — Gizli / Yalnızca takipçiler / Herkese açık | `VisibilityPolicy` matrisiyle birebir | **Critical** |
| Kullanıcı adı ara | Gizli dolabın sahibinde yalnız ad ve kullanıcı adı | High |
| Rehberden bul (A-8 kararıyla) | İzin reddedilirse akış çalışır; karar hash'li eşleşmeyse ham numara ağ trafiğinde yok (proxy) | Critical |
| Davet linki | Link uygulamayı açar (yüklü/değil) — alan adı A-10 | Medium |

#### E10 Üyelik (05)
Genel "Abonelik ve yetki" tablosu + : Paywall'da 4 madde, yıllık/aylık (`[YILLIK FİYAT]`/`[AYLIK FİYAT]` A-1), "Ücretsiz denemeyi başlat", "İstediğin zaman iptal et", "Satın alımları geri yükle" — **iOS ve Android sandbox'ta** satın al, deneme, iptal, iade, geri yükle.

#### E11 Profil, gizlilik, silme (28–29)
| Scenario | Expected | Priority |
|---|---|---|
| Dolap görünürlüğü değiştir | Diğer hesaptan hemen doğrulanır; varsayılan A-6 | Critical |
| "Fotoğraflarımı ve üretilen görselleri sil" | Boy + yüz fotoğrafı + tüm try-on çıktıları S3'ten silinir; eski imzalı URL'ler artık açılmaz (süre dolunca); cihaz önbelleğinden de temizlenir; gardırop, look'lar, hesap **kalır** | **Critical** |
| Hesabımı sil | Tüm tenant verisi + tüm S3 tenant öneki (parça görselleri dahil) + takip kenarları + verdiği puanlar gider; başka kullanıcının akışında görünmez | **Critical** |
| Bildirim tercihleri (sabah kombini, haftanın edit'i, arkadaş puanları) | Kapatılan tür gelmez | High |
| Çıkış yap | Yerel önbellek ve görsel önbelleği temizlenir | Critical |

#### E12 Lansman
| Scenario | Expected | Priority |
|---|---|---|
| Web'den hesap silme | Çalışır (alan adı A-10) | High |
| Yasal metin linkleri (Kullanım Koşulları, Gizlilik Politikası) | Hoş geldin ve paywall'da açılır | High |
| İzin metinleri (kamera, fotoğraflar, bildirim; varsa konum, rehber) | TR + EN, dürüst (DEVOPS_ENGINEER.md) | High |

### Widget'lar (proje gerektirirse) — iki gerçek telefon

> Droblet: tasarımda widget yok — bu tablo widget eklenene kadar uygulanmaz.

| Scenario | Expected | Priority |
|---|---|---|
| Onboarding'de widget kurulumu | Yardımsız tamamlanır; Android tek dokunuş | High |
| Widget'tan etkileşim (çevrimiçi) | Uygulamada kayıt oluşur | **Critical** |
| Uçak modunda widget'tan N etkileşim → uygulamayı aç, bağlan | Hepsi gider; hiçbiri iki kez sayılmaz | **Critical** |
| Uzun süre çevrimdışı | Widget son önbelleği anlamlı gösterir, boş ya da hatalı değil | High |
| Dark mode, uzun metin | Taşma yok | High |
| Kilit ekranı aksesuarı (iOS) | Okunur, dokununca doğru ekran | High |
| Paket sınırı dışındaki widget | Kilitli hali, dokununca paywall | High |
| Widget ağ çağrısı yapıyor mu | Hayır (proxy ile doğrulanır) | High |

### Abonelik ve yetki (paketli üründe) — sandbox
| Scenario | Expected | Priority |
|---|---|---|
| Yetki matrisinin her satırı, tüm paketlerde | Matrisle birebir | **Critical** |
| Abonelik biter | Kullanıcı verisi kalır; korunması gereken erişimler açık | **Critical** |
| Satın al (iOS/Android sandbox) | Sunucu doğrular, yetki açılır | High |
| Sahte/oynanmış işlem | Reddedilir, yetki değişmez | Critical |
| Satın alımı geri yükle (yeni cihaz) | Yetki geri gelir | High |
| Paywall | Fiyat, dönem, deneme, yenileme koşulu, Restore, Terms, Privacy görünür | High |
| İade / iptal (mağaza bildirimi) | Yetki bitişte düşer; veri kalır | High |

### AI özellikleri (AI içeren üründe)
| Scenario | Expected | Priority |
|---|---|---|
| Yetkili kullanıcı istek yapar | Doğru dil/formatta cevap; kota 1 azalır | High |
| AI hatası | Kullanıcıya kotanın düşmediği söylenir — kota değişmez | **Critical** |
| Kapsam dışı istek | Kibar reddetme, kota düşmez | High |
| AI taslağını onaylamadan çık | Kalıcı kayda hiçbir şey yazılmadı | Critical |
| `Ai.Enabled = false` (kill switch) | Kombin/bavul kural tabanlı yedekle çalışır; try-on/palet/parça tanıma "şu an kullanılamıyor"; parça elle eklenebilir | Critical |
| Cihazda işlenmesi gereken veri (ses, kamera vb.) | Ağ trafiğinde yok (proxy ile); uçak modunda çalışır | **Critical** |
| İzin reddedildi (mikrofon/kamera) | Açıklama + Ayarlar; ilgisiz özellikler çalışır | Medium |

### Hesap ve gizlilik
| Scenario | Expected | Priority |
|---|---|---|
| Uygulamadan hesap silme, aktif abonelik var | Abonelik uyarısı + mağaza linki; silme sonrası tüm kullanıcı verisi gider | Critical |
| Web'den hesap silme | OTP → onay → silindi | High |
| A kullanıcısı B'nin kaydını ister | 403 / 404 | Critical |
| A, B'nin fotoğraf / try-on S3 anahtarını tahmin edip presigned URL ister | Anahtar her zaman A'nın tenant'ıyla kurulur — B'nin nesnesine ulaşılamaz | **Critical** |
| A, B'nin dolabı Gizli iken parça görselinin eski URL'ini açar | URL süresi dolmuş; yeni URL verilmez | Critical |

---

## AI Değerlendirme Seti (AI içeren üründe)

AI Engineer ile birlikte sahibisin. Ayrıntılar [AI_ENGINEER.md](AI_ENGINEER.md)'de.

- **Ana set:** gerçek kullanıcı girdileri + doğrulayıcının referans cevapları + ilgili kaynak/kütüphane; tuzaklı girdiler dahil.
- **Regresyon seti:** referans, dil, format ve reddetme vakaları — **%100 geçmek zorunda**, ortalama kabul edilmez.
- Her prompt, model ya da şema değişikliğinde set koşulur; sonuç PR açıklamasına yazılır.
- Kullanıcı girdileri sete yalnız açık rızayla ve anonimleştirilerek girer (KVKK/GDPR).

Droblet: set boyutu v0 hedefleri AI_ENGINEER.md §Spike planı tablosunda (ItemDraft ≥200, Outfit ≥60, WeekPlan ≥20, Packing ≥30, MissingPiece ≥40, TryOn ≥50, Palette ≥60). Kabul eşikleri spike başında ürün sahibiyle yazılır. Konum: `ai/eval/` (yalnız etiket ve görsel kimliği); görseller özel S3 `eval/` önekinde, yalnız açık rızalı.

### Try-on görsel QA
Otomatik ölçülemez; her TryOn model/prompt değişikliğinde ve her sürümden önce elle:
- Sabit **görsel QA paneli** (≥50 çift, farklı beden, ten tonu, poz, ışık) yeniden üretilir; değerlendirici yan yana eski/yeni bakar.
- Rubrik: kişi tanınır kalıyor mu (yüz, ten tonu, vücut oranı değişmemiş), parça doğru mu (renk, desen, kesim, uzunluk), beden gerçekçi mi (inceltme/değiştirme yok), artefakt (eller, kenarlar, arka plan), içerik uygunluğu.
- Herhangi bir örnekte **vücut/yüz değiştirme ya da uygunsuz içerik** = sürüm durur (regresyon gibi, ortalama yok).
- Panel görselleri açık rızalı gönüllülerden; Genç segmentinden yok (A-5).

---

## Gerçek Cihaz Matrisi (her sürüm)

| Cihaz | Neden |
|---|---|
| Eski bir Android (orta segment, Android 8+) | Widget, yenileme davranışı, bellek kısıtı, font ölçeği |
| Güncel bir Android (13+) | `POST_NOTIFICATIONS`, tek dokunuşla widget ekleme |
| Güncel bir iPhone (iOS 17+) | Etkileşimli widget, kilit ekranı, universal link, Apple ile giriş |
| Aynı hesap iki telefonda | Çok cihaz senkronu, çakışma, widget etkileşimleri |
| İkinci bir hesap (farklı telefon) | Görünürlük ve gizlilik: A'nın fotoğrafları/try-on'ları B'de hiçbir ekranda yok |

Droblet kritik cihaz testleri:
- **Kamera:** izin akışı (reddet → açıklama + Ayarlar; galeriden ekleme çalışır), düşük ışık, arka/ön kamera, fotoğraf yönü (EXIF rotation doğru, EXIF konum verisi sunucuya/sağlayıcıya gitmiyor — proxy ile).
- **Toplu yükleme:** 12+ fotoğraf eski Android'de (bellek), yükleme sırasında uygulama arka plana/ağ kopması → yarım kalan yüklemeler devam eder ya da açıkça başarısız; aynı fotoğraf iki kez işlenmez; mobil veride boyut (istemci sıkıştırması).
- **Çevrimdışı kuyruk:** uçak modunda "Bunu giyiyorum", bavul hazırlık işaretleme, look kaydetme, parça düzenleme → bağlan → hepsi bir kez. Fotoğraf yükleme ve AI istekleri çevrimdışı kuyruğa **girmez** — "bağlantı gerekli" durumu.
- **IAP sandbox:** iOS sandbox ve Play test hesabıyla satın al, ücretsiz deneme, iptal, iade, geri yükle (yeni cihaz), abonelik bitince try-on kilidi + verinin kalması.
- **Try-on görsel kontrolü:** cihazda görüntüleme (kırpma, oran, yükleniyor durumu), görsel QA paneli (yukarı).
- **Gizlilik:** A hesabı tüm görünürlük ayarlarında (Herkese açık / Yalnızca takipçiler / Gizli) — B hesabı (takip eden ve etmeyen) A'nın profil, dolap, look, akış ve paylaşım linkinde boy/yüz fotoğrafını ya da try-on görselini **hiçbir yerde** görmez; ağ trafiğinde de (proxy) bu nesnelere URL yok.
- **Silme:** fotoğraf sil ve hesap sil sonrasında eski imzalı URL'ler süre dolunca açılmıyor; S3'te tenant öneki boş (dev ortamında doğrulanır); cihaz görsel önbelleği temiz.

Kontrol: uçak modu senaryoları, widget kurulum ve etkileşimleri, kilit ekranı widget'ı, seçilen saatte bildirim, dark mode, en büyük yazı tipi, universal/app link (uygulama yüklü/değil).

---

## Regression Test Suite

### Smoke (10 dakika)
- [ ] Giriş (OTP + Apple ya da Google)
- [ ] Ana ekran açılır; temel bir yazma işlemi
- [ ] Uçak modunda bir yazma → bağlan → senkron
- [ ] Paywall açılır (fiyat, deneme, Restore görünür) — paketli üründe
- [ ] Çıkış

Droblet smoke:
- [ ] Apple ya da Google ile giriş; e-posta ile giriş
- [ ] Kamera ile bir parça ekle → taslağı onayla → gardıropta
- [ ] Stilist → Kombin öner (sadece gardırobum) → Takvime ekle
- [ ] Bugün → "Bunu giyiyorum"
- [ ] Bir ürün için "Üzerimde gör" (Üyelik hesabıyla)
- [ ] Bavul oluştur → her parça ≥2 kez ibaresi doğru
- [ ] Sepet → marka sitesine yönlendirme
- [ ] İkinci hesapla birinci hesabın dolabı (Yalnızca takipçiler) — fotoğraf/try-on görünmüyor
- [ ] Gizlilik → Fotoğraflarımı sil (test hesabında)

### Full Regression (45 dakika)
Senaryo tablolarında **High** ve **Critical** olan her şey + yetki matrisi + AI değerlendirme seti.

---

## Bug Report Template

```markdown
## Summary
[Tek satır]

## Steps to Reproduce
1. ...

## Expected Behavior
## Actual Behavior

## Environment
- Stage: prod / dev
- Cihaz + OS: Pixel 6 / Android 15
- Uygulama sürümü: 1.2.3 (build 45)
- Paket: Ücretsiz / Droblet Üyelik (aylık · yıllık · deneme)
- Arayüz dili
- Çevrimiçi / çevrimdışı
- Dolap görünürlüğü (sosyal/gizlilik hatasıysa)
- AI işi kimliği (`jobId`) ve görev (ItemDraft / Outfit / Packing / TryOn / Palette)
- Tenant id

## Logs / Screenshots
[CloudWatch log parçası; AI hatasıysa requestId — kullanıcı girdisini bug'a ekleme, id yeter. **Kullanıcının boy/yüz fotoğrafını ya da try-on çıktısını bug'a ekleme** — test hesabının görseli bile olsa yalnız nesne kimliği]

## Severity
Critical / High / Medium / Low
```

---

## Severity Definitions

| Level | Definition | Response |
|---|---|---|
| Critical | Veri kaybı, kullanıcı izolasyonu ihlali, **boy/yüz fotoğrafının ya da try-on görselinin sahibi dışında görünmesi**, silinmesi istenen fotoğrafın kalması, **yetki hatası** (premium sızıntısı ya da korunması gereken erişimin kapanması), kötüye kullanım açığı, cihazda kalması gereken verinin cihazdan çıkması, kullanıcı onayı olmadan kalıcı yazım, doğrulanmamış satın almayla yetki | Hemen düzelt; gerekirse AI kill switch |
| High | Özellik tüm kullanıcılar için bozuk | Bu sprint |
| Medium | Bazı kullanıcılar için bozuk, geçici çözüm var | Sonraki sprint |
| Low | Küçük UI / kozmetik | Backlog |

---

## QA Sign-Off Process

1. PM'in hikâyesindeki kabul kriterlerini oku
2. Her kriteri elle ya da otomatik testle doğrula
3. İlgili regresyon testlerini koş; AI'a dokunduysa değerlendirme setini, pakete dokunduysa yetki matrisini de
4. Deploy sonrası CloudWatch'ta beklenmedik hata var mı bak
5. PR'a `QA Approved ✓` ya da bulunan sorunları yaz — gerçek cihazda test ettiğin cihazları belirt

---

## Monitoring in Production

```bash
aws logs tail /aws/lambda/droblet-prod-api --follow
aws logs tail /aws/lambda/droblet-prod-item-processor --follow
aws logs tail /aws/lambda/droblet-prod-stylist --follow
aws logs tail /aws/lambda/droblet-prod-tryon --follow
aws logs tail /aws/lambda/droblet-prod-palette --follow
aws logs tail /aws/lambda/droblet-prod-notifier --follow
```

Bakılacaklar:
- Lambda loglarında yakalanmamış istisnalar
- DLQ birikmesi (kullanıcı bekleme ekranında takılı kaldı)
- `Failed` AI işi oranı ve nedenleri (`ProviderError`, `Timeout`, `GuardRejected`)
- AI üretiminde kural tabanlı yedeğe düşme oranı
- Idempotent uçlarda tekrar eden `clientMutationId` oranı (beklenenden yüksekse kuyruk ya da widget toplama hatası)
- OTP başlatma hacmi ve ülke dağılımı (SMS kötüye kullanımı — telefon kanalı açıksa)
- Try-on günlük üretim sayısı ve görsel başı maliyet (en pahalı görev)
- ItemDraft'ta kullanıcının düzelttiği alan oranı (kategori/renk/kumaş) — model kalitesi sinyali
- Stylist'te guard'ın attığı `itemId` oranı ve `RuleBased*` yedeğe düşme oranı
- `item-process-request` kuyruk yaşı (toplu eklemede kullanıcı "8 / 12"de bekliyor)
- DynamoDB throttling
