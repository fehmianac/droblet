# Product Backlog — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

**Owner**: Product Manager

Bu backlog, MVP dışında kalan ve yol haritasına henüz alınmamış özellikleri saklar. MVP backlog'u (US-xxx) [PRODUCT_MANAGER.md](PRODUCT_MANAGER.md)'de. Bir item için PRD hazırlandığında `PRODUCT_MANAGER.md` yol haritasına taşınır.

**Kural: Hiçbiri beta'dan önce planlanmaz.** Sıralama beta verisiyle (PRODUCT_MANAGER.md metrikleri) yeniden yapılır.

> MVP kapsamı önerisi ürün sahibinin onayındadır (PRODUCT_MANAGER.md A-12). Aşağıdaki item'ların çoğu tasarımda ekranı olan ama MVP'den bilinçli olarak ertelenen yeteneklerdir; ekran numaraları [SCREENS.md](../_handoff/droblet-handoff/SCREENS.md)'ye göredir.

---

## Item formatı

```
### BL-0xx — {Başlık}
**Öncelik**: P1/P2 | **Çaba**: Düşük/Orta/Yüksek | **Etki**: {kısa gerekçe}

- Kapsam maddeleri
- **Bağımlılık:** {US-xxx / açık karar}
- **Teknik not:** {şimdiden alınması gereken teknik önlem, varsa}
```

---

## V1.5 — Beta'dan sonraki ilk dalga

### BL-001 — Influencer lookları ve influencer dolapları
**Öncelik**: P1 | **Çaba**: Orta | **Etki**: Keşfet'i canlı tutar, edinim kanalı; tasarımda 20 ve 27'de yer alır

- Keşfet'te "Influencer" sekmesi ve "Content creator lookları" (20)
- "Influencer dolapları" listesi ve influencer profili (27, 26 düzeni)
- Influencer look'unu "Senin üzerinde" görme (E6) ve "Parçamı tamamla" ile mağazaya bağlama
- **Bağımlılık:** A-7 (içerik kaynağı ve hakları), US-080, US-092
- **Teknik not:** Influencer içeriği global veri mi, herkese açık dolabı olan bir kullanıcı hesabı mı — karar `VisibilityPolicy` ve içerik hakları açısından beta öncesi yazılır; Keşfet sekme listesi istemcide sunucudan gelen bayrakla açılır (yeni sürüm gerekmeden)

### BL-002 — Rehberden arkadaş bul
**Öncelik**: P1 | **Çaba**: Orta | **Etki**: Sosyal ağı hızla doldurur (27 "Rehberinden arkadaşlarını bul")

- Rehber izni için açıklama ekranı; izin reddedilince akış devam eder
- Eşleşen kullanıcıları "Takip et" ile listeleme
- **Bağımlılık:** A-8 (kişi listesi sunucuya gidecek mi, hash'li eşleşme), KVKK hukuk görüşü, A-5 (gençler)
- **Teknik not:** Ham telefon/e-posta asla saklanmaz ve loglanmaz; MVP'de kullanıcı kaydında eşleşme için gereken alan yoksa şimdiden eklenmez

### BL-003 — Sana benzeyen dolaplar ve stil uyumu %
**Öncelik**: P1 | **Çaba**: Orta | **Etki**: Keşif ve takip oranı (26 "%82 Stil uyumu", 27 "Sana benzeyen dolaplar")

- Kişi profilinde stil uyumu yüzdesi
- "Sana benzeyen dolaplar" önerisi
- **Bağımlılık:** US-091, US-092; beta'da yeterli herkese açık dolap; A-6
- **Teknik not:** Yalnız `VisibilityPolicy`'nin izin verdiği dolaplar hesaba katılır; Gizli dolap öneri havuzuna girmez ve uyum skoru hesaplamasında da kullanılmaz

### BL-004 — Takvim raporu
**Öncelik**: P1 | **Çaba**: Düşük | **Etki**: Giyim kaydını sürdürme motivasyonu (09 "Rapor")

- Ay/sezon raporu: en çok ve en az giyilen parçalar, hiç giyilmeyenler, ortam dağılımı, giyim başı maliyet (fiyat girilmişse)
- **Bağımlılık:** US-041, US-043; beta'da en az bir aylık `WearLog` verisi
- **Teknik not:** `WearLog` MVP'den itibaren tarih + parça listesi + ortamla tutulur ki rapor geriye dönük hesaplanabilsin

### BL-005 — Gardırop istatistiklerinin derinleşmesi
**Öncelik**: P2 | **Çaba**: Düşük | **Etki**: Profil (28) "Gardırop istatistikleri"nin MVP'deki sayı özetinin ötesi

- Kategori / renk / sezon dağılımı, palet uyumu trendi, seyahat arşivi özeti
- **Bağımlılık:** BL-004, US-071

### BL-006 — Kombin önerisinde takvim ortamı
**Öncelik**: P2 | **Çaba**: Orta | **Etki**: Brif "hava + takvim ortamı" der; MVP'de ortam kullanıcı seçimiyle gelir

- Cihaz takvimi izniyle günün ortamını (toplantı, akşam yemeği, düğün) önerme
- **Bağımlılık:** Takvim izni metni, KVKK değerlendirmesi
- **Teknik not:** Takvim etkinlik başlıkları sunucuya gönderilmez; cihazda ortam etiketine indirgenir

---

## V2 — Uzun vade

### BL-020 — Dizi outfitleri
**Öncelik**: P2 | **Çaba**: Yüksek | **Etki**: Keşfet'te farklılaştırıcı içerik (20 "Dizi outfitleri")

- Dizi/karakter bazlı look'lar, benzer ürünler, "kendi dolabınla benzerini kur"
- **Bağımlılık:** A-7 (lisans), A-2 (katalog)
- **Teknik not:** Lisanslı görseller global veri; lisans bitiş tarihiyle birlikte saklanır ve süresi dolan içerik otomatik gizlenir

### BL-021 — Web profili ve paylaşılabilir look linki
**Öncelik**: P2 | **Çaba**: Orta | **Etki**: Paylaşım ve organik edinim

- Herkese açık dolap / look'un web'de görüntülenmesi; davet linkinin web'e açılması
- **Bağımlılık:** A-6 (web linki), A-10 (alan adı), US-090, US-094
- **Teknik not:** Web yalnız `VisibilityPolicy`'nin "Herkese açık" dediği veriyi gösterir; try-on çıktıları ve boy/yüz fotoğrafları web'de hiçbir koşulda yoktur; parça görselleri için de imzalı URL kuralı geçerli

### BL-022 — Ana ekran widget'ı (günün kombini)
**Öncelik**: P2 | **Çaba**: Yüksek | **Etki**: Günlük alışkanlık; North Star'a doğrudan katkı

- iOS WidgetKit / Android Glance: günün kombini, "Bunu giyiyorum"
- **Bağımlılık:** Tasarımda yok — UX tasarlar; beta'da North Star verisi
- **Teknik not:** Ekip kuralına göre widget yalnız paylaşılan yerel önbellekten okur; try-on görseli widget önbelleğine yazılacaksa cihaz içi koruma ayrıca değerlendirilir

### BL-023 — Marka iş ortaklıkları ve affiliate raporlama
**Öncelik**: P2 | **Çaba**: Orta | **Etki**: Gelir modeli (A-2'ye göre)

- Marka bazlı yönlendirme raporu, kampanyalı edit'ler
- **Bağımlılık:** A-2

### BL-024 — Kullanılmayan parça önerileri
**Öncelik**: P2 | **Çaba**: Orta | **Etki**: Gardırop farkındalığı

- Uzun süredir giyilmeyen parçalar için kombin önerisi ya da ayırma önerisi
- **Bağımlılık:** BL-004

---

## MVP sırasında çıkan, beta sonrası değerlendirilecek

| # | Fikir | Nereden | Not |
|---|---|---|---|
| 1 | Try-on sonucuna geri bildirim (beğen / beğenme) | R-2 önlemi | Değerlendirme setini besler; tasarımda yok |
| 2 | Bavul listesini paylaşma | 19 | Tasarımda yok; görünürlük kuralı gerekir |
| 3 | Look puanlamasında yorum | 25 | MVP'de yalnız sayısal puan; moderasyon gerektirir |

---

## Bilinçli olarak kapsam dışı (ürün kararı)

| Konu | Karar |
|---|---|
| Uygulama içinde ödeme / sipariş | Yapılmaz — ödeme markanın kendi mağazasında (brif §5.4) |
| Boy/yüz fotoğrafının ya da try-on çıktısının paylaşılması | Yapılmaz — hiçbir görünürlük ayarında (gizlilik vaadi 1) |
| AI parça taslağının otomatik kaydı | Yapılmaz — her zaman kullanıcı onayı |
| Telefon numarasıyla giriş / SMS | MVP'de yok — giriş Apple, Google, e-posta |
