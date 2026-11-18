# AI Engineer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
AI'nin üründeki görevlerinin **prompt'larından, çıktı şemalarından, değerlendirme setinden, kurallarından, kotasından ve maliyetinden** sorumlusun.

**Droblet'te AI'nin rolü:** AI kullanıcının **kendi gardırobunu** anlar ve onunla çalışır — parçayı tanır (taslak), gardıroptaki parçalardan kombin/plan/bavul kurar, kombini kullanıcının kendi fotoğrafında görselleştirir, yüz fotoğrafından renk paleti çıkarır. **Temel kaynak kullanıcının onayladığı gardırop kaydıdır** (`Item`) ve global katalog; AI bunların dışında parça uyduramaz. AI'nin ürettiği hiçbir şey kullanıcı onaylamadan gardıroba, look'a ya da takvime yazılmaz.

AI'nin çalıştığı yerler (README §3–4):

| Yüzey | Ekran | Worker |
|---|---|---|
| Parça ekle / Toplu ekle — "AI algılar", arka plan temizleme, kadraj, alan doldurma | 12–13 | `ItemProcessor` |
| Bugün'ün kombini, Kombin önerisi (3 öneri + eksik parça), Haftalık plan ("Haftamı planla", gün için "Öner"), Bavul (liste + günlük look'lar) | 06–07, 16–19 | `Stylist` |
| "Senin üzerinde" / "Üzerimde gör" — parça, look, mağaza ürünü, haftanın edit'i | 06–08, 15, 17, 19, 20, 22 | `TryOn` |
| Renk paletim — sezon tipi | 30 | `Palette` |

Kod yazdığın yer backend'in kendisi: AI çağrıları ayrı worker Lambda'larında (`ItemProcessor`, `Stylist`, `TryOn`, `Palette`), `IAiProvider` arayüzünün arkasında (bkz. [BACKEND_ENGINEER.md](BACKEND_ENGINEER.md)). Ayrı bir servis, ayrı bir dil ya da ayrı bir altyapı yok — ekibin yığını aynen geçerli. Görsel işleme (arka plan temizleme, kadraj) ve görsel üretim (try-on) metin modellerinden farklı sağlayıcılar gerektirebilir; bunlar da aynı ilkeyle bir arayüzün arkasında durur (sağlayıcıya özel kod yalnız `src/Infrastructure/Services/Ai/` altında). Arayüzün tek mi ayrı mı (`IAiProvider` görsel yetenekleri / ayrı bir görsel sağlayıcı arayüzü) olacağı Team Lead kararıdır.

**AI olmayanlar:** kural tabanlı yapılabilen her şey kural tabanlı kalır ve AI eklenmez.

Droblet'te AI **olmayan** bileşenler:
- Hava durumu (sağlayıcı: Açık karar A-4) ve hava → kıyafet kısıtları (sıcaklık eşikleri, yağmur) — kural tabanlı, eşikler SSM'de
- **Gardırop–palet uyum oranı** ("Gardırobunun %64'ü paletinle uyumlu") ve "Uyumsuz parçaları gör" — parça renkleri × sezon paleti tablosu, kural tabanlı
- Sezon paletinin kendisi (yakışan / kaçınılacak tonlar) — sezon tipine bağlı **statik global tablo**; model yalnız sezon tipini seçer
- "Gardırobundaki 7 parçayla uyumlu" (ürün detayı) ve "Paletime uygun ürünler" — kategori/renk eşleme kuralları
- **Stil uyumu %** (kişi profili, "Sana benzeyen dolaplar") — stil etiketleri ve renk dağılımı üzerinden kural tabanlı
- Giyilme sayısı, "En çok giyilen", takvim ay özeti ve rapor — `WearLog` sayımları
- Katalog arama/filtre, sepetin markaya göre gruplanması, toplam fiyat
- Haftalık plan ve bavulda **küçük düzenlemeler** (parça değiştirme, gün kaydırma) — AI çağırmaz
- Bildirim metinleri (Notifier) — sabit, çeviri dosyasında
- Haftanın edit'i, editör/influencer içerikleri, dizi outfitleri — editoryal global içerik (kaynak A-7); AI üretmez

> **Bu rolü Claude üstlenir.** Gerçek kullanıcı örnekleri, referans cevaplar (alan uzmanıyla) ve sağlayıcı API anahtarları ürün sahibinden gelir. Droblet'te alan uzmanı bir **stil danışmanıdır** (kombin, bavul, renk analizi referanslarını o yazar/doğrular); kim olacağı ürün sahibinin kararı.

---

## Görevler

| Görev | Lambda | Girdi | Çıktı | Hata maliyeti |
|---|---|---|---|---|
| **ItemDraft** — parça tanıma | `ItemProcessor` (SQS `item-process-request`) | Geçici yüklemedeki tek parça fotoğrafı (EXIF temizlenmiş); kategori/renk/kumaş/sezon enum listeleri | İşlenmiş görsel (arka plan temiz, kadrajlı) + taslak alanlar: kategori, renk(ler), kumaş, sezon(lar), kısa ad; düşük güvenli alan boş + "kontrol et" işareti | **Orta.** Yanlış alan gardırop filtrelerini ve Stylist'i bozar → **taslak kullanıcı onayı olmadan kaydedilmez** ("4 parçayı gardıroba ekle"); doğrulayıcı geçmeyen alan boş bırakılır, kullanıcı doldurur |
| **Outfit** — günlük kombin / kombin önerisi | `Stylist` (SQS `stylist-request`) | Ortam, hava (sıcaklık, yağış), sezon, "sadece gardırobum", stil profili (etiketler, bütçe, segment); **aday parça listesi** (kimlik + kategori/renk/kumaş/sezon — görsel yok) | 3 öneri; her biri slot → `itemId`, kısa açıklama, isteğe bağlı eksik parça (`catalogProductId`) | **Orta.** Gardıropta olmayan parça önerisi güveni bozar → `OutfitValidator` + `RuleBasedOutfit` yedeği. Takvime yalnız kullanıcı "Takvime ekle" / "Bunu giyiyorum" deyince yazılır |
| **WeekPlan** — haftalık plan | `Stylist` | 7 gün × ortam, gün başına hava (varsa), aday parça listesi | Gün → look (slot → `itemId`) | **Orta.** Plan taslaktır; kullanıcı onaylayınca `PlanDay`'e yazılır. Doğrulayıcı geçmeyen gün için kural tabanlı yedek |
| **Packing** — bavul | `Stylist` | Şehir, tarih aralığı, seyahat tipi, "sadece kabin", şehir hava tahmini, aday parça listesi | Bavul listesi (`itemId`'ler) + gün başına look; **her parça en az 2 kez** | **Orta-yüksek** (seyahatte eksik parça geri alınamaz) → `PackingValidator` sert kurallar + `RuleBasedPacking`; liste kullanıcı onayıyla `Trip`'e yazılır |
| **MissingPiece** — eksik parça / "Parçamı tamamla" | `Stylist` | Look'un slotları, boş slot, bütçe tercihi, **aday katalog ürünleri** (önceden süzülmüş kimlik listesi) | En fazla N `catalogProductId` + kısa gerekçe | **Düşük-orta.** Aday dışı ürün atılır; ürün yoksa öneri gösterilmez. Satın alma marka sitesinde |
| **TryOn** — "Üzerimde gör" | `TryOn` (SQS `tryon-request`) | Kullanıcının **boy fotoğrafı** + parça görselleri (gardırop işlenmiş görseli ya da katalog ürün görseli) | Tek görsel, tenant'a özel S3 önekinde | **Yüksek (gizlilik ve güven) + en yüksek maliyet.** Çıktı **yalnız sahibine** açık; global önbelleğe asla girmez; içerik denetiminden geçmeyen çıktı `Failed(GuardRejected)`, kota iade |
| **Palette** — renk paleti | `Palette` (SQS `palette-request`) | **Yüz fotoğrafı** | Sezon tipi (sabit enum) + güven; foto uygun değilse `refusal` | **Orta.** Yanlış sezon tüm palet önerilerini kaydırır → çıktı enum'a karşı deterministik doğrulanır; palet renkleri modelden değil statik tablodan gelir |

---

## Sağlayıcı seçimi — spike

Adaylar, kabul eşiği ve aylık bütçe **ürün sahibinin kararı**. Spike'ın çıktısı bir rapor değil, **bir karar**: ölçüm sonuçlarıyla ürün sahibine sunulur ve karar kaydına (TEAM_LEAD.md) yazılır.

**Droblet:** try-on ve görsel işleme sağlayıcıları ile görsel başı maliyet **Açık karar (A-3)**. Dört görev aynı sağlayıcıyı kullanmak zorunda değildir: metin/vision (ItemDraft sınıflandırma, Stylist, Palette), görsel işleme (arka plan temizleme, kadraj) ve görsel üretim (TryOn) ayrı ayrı ölçülür ve görev başına seçilir. Her aday için SECURITY_ENGINEER.md §AI sağlayıcısı sorularının yazılı cevabı spike'ın parçasıdır — **yüz ve boy fotoğrafı gönderilecek sağlayıcıda bu cevap olmadan karar verilmez.**

### Spike planı (≈2 hafta)
1. **Değerlendirme seti v0** (QA ve alan uzmanıyla): her görev için gerçekçi girdiler + referans çıktı. Bir kısmı bilerek tuzaklı: kapsam dışı istek, yanlış önermeli soru, alakasız girdi.

   | Görev | v0 hedefi | Örnek türleri (tuzaklar dahil) |
   |---|---|---|
   | ItemDraft | ≥200 fotoğraf, kategoriler dengeli | Düz zemin, askı, ütüsüz/katlı, desenli, siyah-üstüne-siyah, beyaz-üstüne-beyaz, kötü ışık; **tuzak:** aynı karede iki parça, üzerinde giyilmiş (insan var), kıyafet olmayan nesne, bulanık |
   | Outfit | ≥60 senaryo (gardırop × ortam × hava) | Her ortam (Ofis, Akşam yemeği, Hafta sonu, Düğün, Seyahat, Spor), sıcak/soğuk/yağmurlu; Kadın/Erkek/Genç; **tuzak:** ortama uygun parça yok, çok küçük gardırop (<10 parça), "sadece gardırobum" açıkken katalog önerme eğilimi |
   | WeekPlan | ≥20 hafta | Karışık ortamlar (ör. Ofis ×4, Akşam ×1, Hafta sonu ×2); **tuzak:** aynı parçanın arka arkaya günlerde tekrarı |
   | Packing | ≥30 seyahat | Kısa/uzun, iş/gezi, sadece kabin, yağmurlu şehir; **tuzak:** 1 günlük seyahat ("en az 2 kez" kuralı uygulanamaz — bkz. Kurallar), gardıropta mevsime uygun dış giyim yok |
   | MissingPiece | ≥40 look | Boş çanta/ayakkabı slotu, farklı bütçe tercihleri; **tuzak:** aday listede uygun ürün yok |
   | TryOn | ≥50 (boy fotoğrafı × parça) | Farklı beden, ten tonu, poz, ışık; üst/alt/elbise/dış giyim/ayakkabı; **tuzak:** tam boy olmayan fotoğraf, birden fazla kişi, uygunsuz girdi |
   | Palette | ≥60 yüz fotoğrafı | Geniş ten tonu aralığı, doğal/yapay ışık, makyajlı/makyajsız, gözlüklü; **tuzak:** yüz yok, çoklu yüz, aşırı filtre |

   Fotoğraflı örnekler **yalnız yazılı açık rızayla** toplanır (gönüllü iç ekip / anlaşmalı modeller); kullanıcı fotoğrafı sete girmez (bkz. §Değerlendirme seti). Genç (13–18) segmentinden fotoğraf toplanmaz — A-5 kararı verilene kadar.
2. **Adaylar:** ürün sahibinin onayladığı sağlayıcıların JSON şema çıktısı veren güncel modelleri. Her sağlayıcıdan bir "güçlü" ve bir "ucuz" model ölçülür; bütçe ucuz modeli öne çıkarabilir.
3. Her aday için aynı prompt ve şemayla ölç:

| Ölçü | Nasıl |
|---|---|
| Doğruluk | Çıktı referansla çelişiyor mu (uzman rubriği: doğru / eksik / yanlış) |
| Dayanak | Çıktının gösterdiği kaynak kimlikleri gerçekten ilgili ve veride mi |
| Kullanıcıya uyum | Stil profili (3 etiket, bütçe, segment: Kadın/Erkek/Genç), ortam, hava ve sezona uyum; açıklama TR/EN arayüz dilinde, "sakin, editoryal, kişisel" tonda, sen dili, kısa cümle |
| Dil | Çıktı doğal, kısa, ürünün tonunda mı |
| Reddetme | Kapsam dışı istekte uydurmak yerine söylüyor mu |
| Gecikme | p50 / p90, istek başına |
| Maliyet | İstek başına, gerçek token sayımlarından |
| Veri politikası | Eğitimde kullanım, saklama süresi, bölge (SECURITY_ENGINEER.md §AI sağlayıcısı) |

   Görev başına ek ölçüler:

   | Görev | Doğruluk ölçüsü | Maliyet birimi |
   |---|---|---|
   | ItemDraft | Alan başına doğruluk (kategori, renk, kumaş, sezon); "kontrol et" işaretinin isabeti; arka plan maskesi kalitesi (uzman 1–3) | Fotoğraf başı |
   | Outfit / WeekPlan | Uzman rubriği (giyilebilir / uygun / stil profiline uygun); aday dışı kimlik oranı (hedef 0, guard sonrası) | Öneri seti başı |
   | Packing | Kurallara uyum (her parça ≥2, kabin, her gün bir look); uzman rubriği | Bavul başı |
   | MissingPiece | Uzman "mantıklı tamamlayıcı" oranı | İstek başı |
   | TryOn | Görsel QA rubriği: kimlik korunuyor mu, parça doğru mu (renk/desen/kesim), beden/oran gerçekçi mi, artefakt; denetimden geçme oranı | **Görsel başı** |
   | Palette | Uzman etiketiyle sezon tipi uyumu (tam / komşu sezon / yanlış) | Analiz başı |

4. **Karar ölçütü:** eşik değerleri (ör. "yanlış" oranı, dayanak oranı, p90 gecikme) spike başında ürün sahibiyle yazılır. Eşiği geçenler arasında bütçeye sığan en doğru model seçilir. Hiçbiri geçemezse prompt/şema iyileştirilip yeniden ölçülür; **eşik düşürülmez, ürün sahibine sorulur.**

   Sonuç tablosu (spike sonunda doldurulur; boş hücre = henüz ölçülmedi):

   | Görev | Sağlayıcı / model | Doğruluk | p90 gecikme | Birim maliyet | Eşik | Karar |
   |---|---|---|---|---|---|---|
   | ItemDraft | Açık karar (A-3) | — | — | — | ürün sahibi | — |
   | Outfit / WeekPlan / Packing / MissingPiece | Açık karar (A-3) | — | — | — | ürün sahibi | — |
   | TryOn | Açık karar (A-3) | — | — | — | ürün sahibi | — |
   | Palette | Açık karar (A-3) | — | — | — | ürün sahibi | — |

---

## Görev deseni — `{Feature}`

Aşağıdaki desen her göreve uygulanır: `{Feature}` = `ItemDraft`, `Outfit`, `WeekPlan`, `Packing`, `MissingPiece`, `TryOn`, `Palette`. Göreve özgü kurallar desenin ardından.

### Akış
1. Api isteği doğrular, kota hakkı **ayırır**, işi SQS'e koyar ve `202` + iş kimliği döner. İstemci `GET .../{id}` ile durumu sorgular.
2. Worker Lambda'sı (`ItemProcessor` / `Stylist` / `TryOn` / `Palette`) girdiyi kurar: kullanıcı girdisi (uzunluk sınırlı), gerekli bağlam ve **dayanak verisi** (ilgili, önceden süzülmüş kayıtlar). **Kişisel veri gönderilmez** — ad, e-posta, telefon yok. Droblet'te ek olarak: boy/kilo gönderilmez (beden yeterliyse), konum yerine yalnız hava özeti gönderilir; fotoğraflar sağlayıcıya yalnız o görevin gerektirdiği tek görsel olarak, EXIF'siz gider (boy fotoğrafı yalnız TryOn'a, yüz fotoğrafı yalnız Palette'e).
3. Model verilen veriye dayanır; dayanamıyorsa bunu işaretler (`grounded: false`), kapsam dışı istekte uydurmaz, söyler.
4. Sunucu:
   - Şemayı doğrular
   - `{Feature}OutputGuard` / `{Feature}Validator` uygular (aşağı)
   - Kota rezervasyonunu kesinleştirir ya da iade eder

### Çıktı şeması (örnek iskelet)

```json
{
  "result": "…",
  "source_ids": ["{source-id}"],
  "grounded": true,
  "draft": { "…": "kullanıcının onaylayacağı taslak" },
  "refusal": null
}
```

Droblet'te `source_ids` = gardırop `itemId`'leri ve katalog `catalogProductId`'leri. Örnek — Outfit:

```json
{
  "suggestions": [
    {
      "title": "Gece Laciverti",
      "slots": { "top": null, "bottom": null, "dress": "item_…", "outerwear": "item_…", "shoes": "item_…", "bagAccessory": null },
      "explanation": "…",
      "missing": { "slot": "bagAccessory", "catalogProductId": "prd_…" }
    }
  ],
  "grounded": true,
  "refusal": null
}
```

Parça adları ekranda **kimlikten** gösterilir (istemci kendi kaydından okur) — model parça adı üretmez; açıklama metni parçaya yalnız slot/renk diliyle değinir.

- **Şema zorunlu.** Sağlayıcının yapılandırılmış çıktı / JSON şema özelliği kullanılır; yoksa çıktı sunucuda şemaya karşı doğrulanır, uymayan cevap `ProviderError`'dur — tahminle onarılmaz.
- `refusal` doluysa (ör. `out_of_scope`) taslak önerilmez; istemci kibarca söyler. Reddetme kotadan düşmez. Droblet reddetme kodları: `out_of_scope`, `insufficient_wardrobe` (ortama uygun parça yok — kullanıcıya eksik kategori söylenir), `photo_unsuitable` (yüz/boy fotoğrafı analize uygun değil — yeniden çekme önerilir).
- `draft` yalnız taslaktır: kullanıcı önizler, düzenler, kaydeder. **Onaysız kalıcı kayda yazılmaz.**

### `{Feature}OutputGuard` — model önerir, sunucu karar verir
Domain'de, kural tabanlı, birim testli:
- Referans verilen kimlikler (`source_ids` vb.) **veride var olmalı**; yoksa alan atılır, `grounded = false` olur.
- Uzunluk sınırları (çıktının gösterileceği yüzeye göre).
- Dil kontrolü (beklenen alan beklenen dilde mi — dil tespiti).
- İçerik filtresi: küfür, kişisel veri talebi, kapsam dışı tavsiye. Geçmeyen cevap `Failed(GuardRejected)` olur; **düzeltilmez**, kota iade edilir.
- Model güveni olduğu gibi kullanılmaz; kural `grounded`'ı yalnız **düşürebilir**, asla yükseltmez.

Droblet'e özgü guard kuralları:
- **Kimlikler yalnız istek sahibinin tenant'ından.** `itemId` kullanıcının gardırobunda ve isteğe verilen aday listesinde; `catalogProductId` global katalogda, yayında (`retired` değil) ve aday listesinde. Başka kullanıcının parçası (sosyal akıştan bile) Stylist'e aday olarak verilmez.
- Açıklama: arayüz dilinde (TR/EN), kısa (yüzeye göre karakter sınırı SSM'de), sağlık/beden yorumu yok ("kilo ver", "zayıf göster" vb. ifadeler içerik filtresinde), marka/fiyat iddiası yok (fiyat katalogdan gelir).
- `TryOnOutputGuard`: görsel çözülebiliyor, boyut/format beklenen, **içerik denetiminden** (çıplaklık, uygunsuz içerik) geçiyor; geçmezse görsel saklanmaz, `Failed(GuardRejected)`.
- `PaletteOutputGuard`: sezon tipi sabit enum'da; güven eşiğin altındaysa sonuç "emin değil" olarak işaretlenir (asla yükseltilmez) ve yeniden çekme önerilir.

### `{Feature}Validator` + kural tabanlı yedek
Çıktı yapısal bir taslaksa (plan, liste, dağılım):
- Her kimlik veride ve **verilen aday listesinde** — model aday dışı içerik seçemez.
- Yetki ve kullanıcı tercihi sınırları aşılmaz.
- Zorunlu öğeler düşmez.
- Doğrulayıcı geçmezse `RuleBased{Feature}` taslağı kullanılır — **kullanıcı her zaman bir sonuç görür.**
- Basit yeniden düzenlemeler (ör. kaçırılan öğelerin yayılması) AI çağırmaz, kural tabanlı yapılır.

Droblet doğrulayıcıları:

| Validator | Sert kurallar | Yedek |
|---|---|---|
| `ItemDraftValidator` | Kategori/renk/kumaş/sezon yalnız sabit enum'lardan; enum dışı değer alan boş + "kontrol et"; maske boş ya da tüm kare değil; tek parça algılandı (çoklu parça → "kontrol et") | Alan boş bırakılır; işlenmemiş (yalnız kadraj) görsel kullanılır |
| `OutfitValidator` | Slot başına en fazla bir parça; parçanın kategorisi slota uygun; ya üst+alt ya elbise; ayakkabı zorunlu (gardıropta varsa); sezon ve hava kuralları (eşikler SSM); "sadece gardırobum" açıksa `missing` boş; 3 öneri birbirinden farklı | `RuleBasedOutfit` — kategori/sezon/hava/giyilme sayısı kurallarıyla kurulan kombin |
| `WeekPlanValidator` | 7 gün, her gün istenen ortama uygun; aynı look arka arkaya günlerde tekrar etmez (sınır SSM'de) | `RuleBasedWeekPlan` |
| `PackingValidator` | Tüm parçalar gardıropta; **her parça en az 2 kez** günlük look'larda kullanılıyor; her gün bir look; "sadece kabin" açıksa parça sayısı sınırı (`Packing.CabinMaxItems`, değer ürün sahibinde) aşılmaz; hava tahminine uygun dış giyim varsa listede | `RuleBasedPacking` |
| `MissingPieceValidator` | Ürün aday listesinde, yayında, segment ve bütçe tercihine uygun; sayı sınırı | Öneri gösterilmez (yedek gerekmez) |
| `PaletteValidator` | Sezon tipi enum'da; palet renkleri **modelden alınmaz**, sezon tablosundan kurulur | `refusal: photo_unsuitable` |

### Kota
- Kullanıcı başına, paket bazında; sayılar SSM'de (`Entitlements`). Dönem UTC'ye göre döner — basit ve tahmin edilebilir; ekranda "kalan hak" sunucudan gelir.
- Api işi kuyruğa koyarken bir hak **ayırır**; worker başarısız olursa (`ProviderError`, `Timeout`, `GuardRejected`, reddetme) **iade eder**. Başarısız çağrı kotadan düşmez.
- Kotasız öneri çağrıları için kullanıcı başına günlük bir üst sınır SSM'de tutulur.

**Droblet paket başına kota sayıları — Açık karar (A-1).** Paywall'da yazılı olanlar: Üyelikte **sınırsız "üzerimde gör"**, kişisel stil danışmanı (günlük kombin), akıllı bavul, renk paleti analizi. Ücretsiz pakette ne kaldığı tasarımda yok. SSM `Entitlements` anahtarları (değerler A-1 kararıyla dolar):

| Anahtar | Anlamı |
|---|---|
| `TryOn.Free.Monthly` | Ücretsiz pakette aylık try-on (0 olabilir) |
| `TryOn.Premium.DailyCap` | "Sınırsız" try-on için kötüye kullanım üst sınırı (fair use) — metni yasal metinle uyumlu olmalı (SECURITY_ENGINEER.md) |
| `Stylist.Free.Daily`, `Stylist.Premium.DailyCap` | Kombin önerisi / plan / bavul istekleri |
| `ItemProcess.Free.Monthly`, `ItemProcess.Premium.DailyCap` | Parça tanıma (toplu eklemede fotoğraf başına 1) |
| `Palette.Free.Total`, `Palette.Premium.Monthly` | Renk paleti analizi |
| `Wardrobe.Free.MaxItems` | Gardırop limiti (varsa) |

---

## Maliyet

AI maliyeti kullanıcı sayısıyla değil **kullanımla** büyür. Üst sınırı tasarım belirler:

| Önlem | Nerede |
|---|---|
| Veri önce: cevap mevcut veride varsa AI çağrılmaz | Api |
| Kullanıcı başına kota, **paket bazında** | Api, `UsageEntity`; sayılar SSM `Entitlements`'ta |
| Periyodik üretimler seyrek; küçük düzenlemeler AI'sız | Worker, `RuleBased{Feature}` |
| Sabit sistem prompt'u ve sabit bağlam prompt başında — sağlayıcı prompt önbelleği destekliyorsa kullanılır | Worker'lar |
| Kill switch: `Ai.Enabled = false` | SSM (DEVOPS_ENGINEER.md) |
| SQS `maxReceiveCount: 3` — bozuk bir istek beş kez faturalanmaz | template.yaml |

Droblet'e özgü maliyet kuralları — **TryOn en pahalı görevdir**:

| Önlem | Nerede |
|---|---|
| Try-on **tembel** üretilir: yalnız ekranda gösterilen öneri / kullanıcının dokunduğu ürün için. 3 öneri için 3 görsel önceden üretilmez | Api, mobil |
| Try-on sonucu **tenant içinde** önbelleklenir: anahtar = boy fotoğrafı sürümü + sıralı parça/ürün kimlikleri. Boy fotoğrafı değişince ya da silinince önbellek silinir. **Global önbellek yok** — başka kullanıcıyla asla paylaşılmaz | `TryOn`, özel S3 öneki |
| Bugün'ün "Senin üzerinde" kombini ve haftanın edit'inin "7 look · senin üzerinde" görünümü kullanıcı başına otomatik üretim demektir — otomatik mi dokununca mı üretileceği ve kotadan düşüp düşmeyeceği **Açık karar (A-1 / A-3)**. Karar verilene kadar varsayılan: dokununca üret | Api |
| Toplu eklemede fotoğraf başına bir iş (`BatchSize: 1`); aynı fotoğraf (içerik hash'i) iki kez işlenmez | Api, `ItemProcessor` |
| Stylist'e görsel değil **metin aday listesi** gider (kimlik + kategori/renk/kumaş/sezon) — token maliyeti gardırop boyutuyla sınırlı; aday listesi önce kural tabanlı süzülür (sezon, hava, ortam) | `Stylist` |
| Palet sonucu kalıcıdır; yeni yüz fotoğrafı yüklenmedikçe yeniden analiz yapılmaz | Api |
| Katalog ürünlerinin kategori/renk etiketlemesi AI ile yapılırsa (A-2'ye bağlı) bu **global ve bir kerelik** bir işlemdir — kişisel değil, katalog tohumunda saklanır | Seed aracı |
| Model ve görsel çözünürlüğü görev başına SSM'de — try-on önizleme çözünürlüğü maliyete göre ayarlanır | SSM `worker/Ai` |

**Her sprint raporla:** istek başı ortalama maliyet (görev bazında), kullanıcı başı aylık ortalama, en pahalı %1. Droblet'te ayrıca: **try-on görsel başı maliyet** ve **ücretli kullanıcı başına aylık try-on maliyeti** (abonelik fiyatıyla — A-1 — karşılaştırılır; "sınırsız" vaadinin sürdürülebilirliği bu satıra bağlı).

---

## Değerlendirme seti

```
ai/
├── prompts/{feature}.system.md       # tek kaynak — Infrastructure'a gömülü kaynak olarak girer
├── schemas/{feature}.schema.json     # strict JSON schema — tüm sağlayıcılarda aynı
├── eval/
│   ├── README.md                     # etiket biçimi, rubrik, çalıştırma
│   ├── {feature}.example.jsonl
│   └── {feature}.jsonl               # gerçek girdiler + referans çıktılar (uzman)
└── reports/YYYY-MM-DD-HHmm-<provider>-<model>.md

src/Domain/Services/{Feature}OutputGuard.cs, {Feature}Validator.cs, RuleBased{Feature}.cs   # sunucu kuralları (testli)
src/Infrastructure/Services/Ai/<Provider>AiProvider.cs
tools/AiEval/                         # değerlendirme aracı (Scoring, Report) — tests/AiEvalTests
```

Droblet dosyaları: `item-draft`, `outfit`, `week-plan`, `packing`, `missing-piece`, `try-on`, `palette` (her biri için prompt + şema + eval). Sabit enum'lar (kategori, renk, kumaş, sezon, ortam, sezon tipi) ve sezon → palet tablosu tek kaynaktan (`src/Domain/`) gelir; prompt ve şema bunlardan üretilir, elle kopyalanmaz.

**Görseller repoya girmez.** `ai/eval/*.jsonl` yalnız görsel kimliği + etiket + referans tutar; görseller ayrı, özel bir S3 önekinde (`eval/` — production kullanıcı verisinden ayrı, erişim yalnız değerlendirme aracına), yalnız yazılı açık rızayla toplanmış. Rıza geri alınırsa görsel ve satırı silinir.

- Değerlendirme **production kodunun aynısıyla** koşar (`IAiProvider` + guard + validator). Ayrı bir Python not defterinde ölçülen doğruluk, gönderilen ürünün doğruluğu değildir.
- Her prompt, model ya da şema değişikliği: set koşulur, rapor PR açıklamasına girer (TEAM_LEAD.md §AI PRs).
- **Regresyon seti:** dayanak/referans, dil, kullanıcıya uyum ve reddetme vakaları — **%100 geçmek zorunda**, ortalama kabul edilmez. Droblet regresyon vakaları en az: aday dışı `itemId` asla dönmüyor; "sadece gardırobum" açıkken katalog önerisi yok; bavulda her parça ≥2; enum dışı kategori/sezon tipi asla kaydedilmiyor; try-on içerik denetimi tuzakları reddediliyor; beden/kilo yorumu içeren açıklama reddediliyor.
- Production'dan yalnız **metin** sinyali gelir: kullanıcının taslakta neyi düzenlediği, "yardımcı olmadı" geri bildirimi. Kullanıcı girdileri sete yalnız açık rızayla ve anonimleştirilerek girer (KVKK/GDPR). Droblet'te: ItemDraft'ta kullanıcının değiştirdiği alanlar (ör. kategori Üst → Elbise) ve öneri reddi sayılır; **kullanıcının fotoğrafları (parça, boy, yüz) ve try-on çıktıları sete hiçbir koşulda otomatik girmez.**
- Seti büyüten, referans cevapları yazan ve doğrulayan kişi alan uzmanıdır — Claude cevap yazabilir ama **doğrulayamaz**. TryOn görsel QA'sı ve Palette etiketleri insan değerlendirmesidir (QA_ENGINEER.md §Try-on görsel QA).

---

## Kurallar

1. **Veri önce.** AI doğrulanmış veriye dayanır ve dayanmadığında bunu söyler.
2. **Model önerir, sunucu karar verir.** Kimlikler, dil ve sınırlar kodda kontrol edilir.
3. **Kural yalnız düşürür.** Sunucu `grounded`'ı ya da bir güven işaretini asla yükseltmez.
4. **Kalıcı kayda onaysız hiçbir AI çıktısı yazılmaz.**
5. **Başarısız ya da reddedilmiş çağrı kotadan düşmez.**
6. **Regresyon setinde ortalama yok** — tek bir başarısız vaka sürümü durdurur.
7. **Kotalar ve modeller SSM'de**, kodda değil.
8. **Prompt'lar ve şemalar repoda, sürümlü.** Konsolda, panelde ya da kafada değil.
9. **Log'a kullanıcı girdisi, tam prompt ya da tam cevap gitmez.** Id ve token sayıları yeter.

Droblet'e özgü:

10. **Stylist yalnız var olan parçalara referans verir.** Çıktıdaki her `itemId` kullanıcının gardırobunda ve aday listesinde; değilse atılır — kural tabanlı guard, istisnasız.
11. **"Her parça en az 2 kez"** bavulun sert kuralıdır; validator geçmezse yedek kullanılır. Kuralın uygulanamadığı kısa seyahatlerde (ör. 1 gün) ne olacağı ürün kararıdır — karar verilene kadar kural gevşetilmez, yedek kurallı liste üretilir ve ekranda "Her parça en az 2 kez" ibaresi gösterilmez.
12. **Kişisel görseller global değildir.** Boy/yüz fotoğrafı ve try-on çıktısı hiçbir önbelleğe, CDN'e, eval setine, başka kullanıcının yanıtına girmez; yalnız tenant önekinde, kısa ömürlü imzalı URL'le sahibine açılır.
13. **Fotoğraf sağlayıcıya EXIF'siz ve yalnız gereken görevde gider** (boy fotoğrafı → TryOn, yüz → Palette, parça → ItemProcessor).
14. **Palet renkleri modelden gelmez** — model sezon tipini seçer, renkler statik tablodan.

---

## Verilen kararlar

| Konu | Karar |
|---|---|
| Mimari | AI çağrıları SQS + ayrı worker Lambda; `IAiProvider` soyutlaması |
| Çıktı | Şema zorunlu; sunucuda kural tabanlı guard/validator |
| Kota | Sunucuda, paket bazında, SSM'de; başarısız çağrı düşmez |
| Veri | Kullanıcı verisi model eğitiminde kullanılmaz (tedarikçi sözleşmesiyle teyit edilir) |
| AI'nin rolü | Kullanıcının kendi gardırobu ve global katalog üzerinde öneri; gardırop kaydı temel kaynak |
| Görevler | ItemDraft (`ItemProcessor`), Outfit / WeekPlan / Packing / MissingPiece (`Stylist`), TryOn (`TryOn`), Palette (`Palette`) |
| Taslak onay akışı | Parça taslağı → kullanıcı kontrol eder → "gardıroba ekle"; kombin → "Takvime ekle" / "Bunu giyiyorum"; plan ve bavul → kullanıcı onayıyla `PlanDay` / `Trip`. Try-on ve palet sonucu kullanıcının kendi görünümüdür, gardıroba yazmaz |
| Try-on gizliliği | Çıktı yalnız sahibine; tenant içi önbellek; global önbellek yok |
| Palet | Model sezon tipi; renkler ve gardırop uyum oranı kural tabanlı |
| Sağlayıcılar, görsel başı maliyet | **Açık karar (A-3)** |
| Kota sayıları, ücretsiz paket sınırları | **Açık karar (A-1)** |
| Otomatik try-on (Bugün, haftanın edit'i) | **Açık karar (A-1 / A-3)** — varsayılan: dokununca |
| Eşikler ve aylık AI bütçesi | Ürün sahibi, spike başında |
| Genç (13–18) için fotoğraf/try-on/palet | **Açık karar (A-5)** |
