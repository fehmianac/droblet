# Ebeveyn Aydınlatma ve Onay Metni (genç modu, 16–17 yaş)

> **TASLAK — HUKUK ONAYI YOK. YAYINLANMAZ.** Bu metin `/parent-consent/` sayfası ve ebeveyn e-postaları için elle yazılmış
> bir taslaktır; sitede yayında değildir (sayfa yalnızca `NEXT_PUBLIC_TEEN_PARENT_CONSENT=1` ile derlenir, `noindex`).
> Her `[HUKUK ONAYI: …]` notu avukata bir sorudur (bkz. `docs/legal/REVIEW.md` Q17–Q23).
>
> **Metin sürümü: `2026-11-21`** (`Teen:ParentalConsentTextVersion`; metin değişirse sürüm de değişmeli, eski onaylar
> eski sürüme bağlı kalır) · Taslak tarihi: 21 Kasım 2026 · Teknik kaynak: `docs/api/teen.md` §5

Sayfada `{ad}` yerine gencin görünen adının yalnızca ilk kelimesi gösterilir. Hitap, Droblet'in diğer metinleri gibi
"sen"dir; ebeveynlere "siz" ile hitap etmek daha uygun bulunursa metin buna çevrilmeli `[SAHİBİN KARARI]`.

---

## A. Sayfa metni

### Merhaba,

**{ad}**, Droblet uygulamasını kullanmak için senin onayını istiyor ve bu adresi senin e-posta adresin olarak yazdı.
Aşağıdaki bilgileri okuyup karar verebilirsin. Bu isteği tanımıyorsan ya da {ad} senin çocuğun veya vesayetindeki biri
değilse hiçbir şey yapma ya da **Reddet**'e bas; bağlantı 7 gün sonra kendiliğinden geçersiz olur.

### Droblet nedir?

Droblet bir gardırop ve stil uygulamasıdır: kullanıcı kıyafetlerini kaydeder, kombin (look) oluşturur, günlük ve haftalık
kıyafet planı ile bavul listesi hazırlar ve yapay zekâ destekli stil önerileri alır. Uygulamayı Londra'da kurulu
**Droblet Ltd** sunar ve kişisel verilerin **veri sorumlusudur**. 16–17 yaşındakiler Droblet'i, aşağıdaki kısıtlarla
**genç modunda** kullanır. 16 yaşından küçükler hesap açamaz.

**Veri sorumlusu:** Droblet Ltd, [ŞİRKET ADRESİ], Londra, Birleşik Krallık · Şirket no. [ŞİRKET NUMARASI] ·
[İLETİŞİM E-POSTASI] · Türkiye temsilcisi: [TÜRKİYE TEMSİLCİSİ]

### Onayın neyi açar?

Onay vermeden önce de {ad} gardırobunu elle ya da hazır kütüphaneden kurabilir, look ve plan yapabilir. Onayınla şu
özellikler açılır:

- **Fotoğraflar:** kıyafet fotoğrafı çekip yükleme (yapay zekâ türünü, rengini, kumaşını önerir ve arka planı temizler),
  boy (tam boy) ve yüz fotoğrafı, profil fotoğrafı;
- **Renk paleti:** yüz fotoğrafındaki ten, saç ve göz renklerine bakarak uyan renklerin belirlenmesi;
- **Yapay zekâ stilisti:** kombin, haftalık plan ve bavul önerileri; öneriler yaşa ve okula uygundur, açık ya da imalı
  parça ve ifade içermez.

### Genç modunda neler kapalı?

- **Sosyal özellikler yok:** takip, takipçi, kişi arama, puan verme, akış, paylaşım ve davet linkleri, rehberden arkadaş
  bulma ve kullanıcı adı yok. {ad} başka kullanıcılara **görünmez**, dolabı her zaman **gizlidir**.
- **Alışveriş yok:** mağaza ya da marka linki, sepet, satın alma ve ücretli üyelik yok; genç modu ücretsizdir.
- **Analitik ve pazarlama yok:** ürün analitiği (Firebase) çalışmaz, kullanım olayları saklanmaz, pazarlama bildirimi
  gönderilmez.
- **Başka birinin fotoğrafındaki kombini deneme** her zaman kapalıdır.
- **Sanal deneme (“Üzerimde gör”)** şu an kapalıdır; açılırsa yalnızca aşağıdaki **ayrı** kutuyu işaretlediysen ve {ad}
  kendisi de ayrıca rıza verdiyse çalışır.

Sen {ad}'ın gardırobunu, fotoğraflarını ya da etkinliğini **göremezsin**; bu onay bir izleme aracı değildir.
[HUKUK ONAYI: ICO Çocuk Kodu standart 11 (ebeveyn denetimi) — ebeveynin izleme yapmadığının gence de açıkça söylenmesi
yeterli mi?]

### Hangi veriler işlenir, kim işler, nerede?

| Veri | Amaç | Kim / nerede |
|---|---|---|
| {ad}'ın hesap, profil, stil ve beden profili, gardırop ve plan verileri | Uygulamayı sunmak | Droblet Ltd; AWS, Frankfurt (Almanya, `eu-central-1`) |
| {ad}'ın doğum yılı (gerekirse ayı) ve yaş grubu | Genç modu kurallarını uygulamak, 18 yaşını hesaplamak | Droblet Ltd; AWS (Almanya) |
| {ad}'ın kıyafet, boy ve yüz fotoğrafları, palet sonucu, profil fotoğrafı | Fotoğraflı ve yapay zekâlı özellikler | Saklama: AWS (Almanya). İşleme: **OpenAI (ABD)**, veri işleyen olarak |
| {ad}'ın stilist istekleri (tarih, hava, ortam, kıyafet bilgileri; ad ve e-posta olmadan) | Stil önerileri | OpenAI (ABD), veri işleyen olarak |
| **Senin e-posta adresin** | Yalnızca bu onay e-postalarını göndermek | Droblet Ltd; e-posta gönderimi: **Twilio SendGrid** (ABD) [HUKUK ONAYI: SendGrid AB veri yerleşimi kullanılacak mı?] |
| Onay kaydı: olay (istek, onay, ret, geri alma…), zaman, e-posta adresinin ve IP adresinin SHA-256 karması, metin sürümü, işaretlenen kutular | Onayı ispat etmek | Droblet Ltd; AWS (Almanya). IP adresinin kendisi saklanmaz. |

Fotoğraflar konum ve cihaz bilgisi silinerek şifreli saklanır ve hiçbir ayarda başka kullanıcılara ya da destek ve moderasyon
personeline gösterilmez. OpenAI'ye gönderilen veriler API koşullarına göre modellerin eğitiminde kullanılmaz; kötüye
kullanımı izlemek için [OPENAI SAKLAMA SÜRESİ] süreyle saklanabilir. Kimlik tespiti ya da yüz tanıma yapılmaz.

Veriler Türkiye dışına (Birleşik Krallık, Almanya, ABD) aktarılır; aktarım mekanizması: [YURT DIŞI AKTARIM MEKANİZMASI].
[HUKUK ONAYI: reşit olmayanın verisinin KVKK m. 9 ve UK GDPR kapsamında ABD'ye aktarımı]

### Ne kadar saklanır?

- {ad}'ın kişisel fotoğrafları (boy, yüz, deneme görselleri, palet sonucu): 90 gün hiç giriş yapılmazsa kendiliğinden silinir;
  onayı geri alırsan hemen silinir; {ad} istediği an kendisi de silebilir.
- Senin e-posta adresin: {ad} 18 yaşına girdiğinde ya da hesabı silindiğinde silinir.
- Onay kaydı: hesap durdukça. [HUKUK ONAYI: hesap silindikten sonra asgari onay kaydı saklama süresi]
- Diğer veriler: Droblet Gizlilik Politikası ve KVKK Aydınlatma Metni'ndeki sürelere göre.

### Onayını geri alma

Onaydan sonra sana bir **onay e-postası** göndeririz; içindeki bağlantıyla onayını **istediğin an**, {ad} 18 yaşına girene
kadar geri alabilirsin. Geri aldığında:

- fotoğraflı ve yapay zekâlı özellikler kapanır;
- {ad}'ın **boy ve yüz fotoğrafları, tüm deneme görselleri, palet sonucu ve profil fotoğrafı silinir**; gardıroptaki kıyafet
  görselleri, look'lar ve planlar kalır;
- {ad}'a uygulama içinde haber verilir.

Geri alma, o zamana kadar yapılan işlemlerin hukuka uygunluğunu etkilemez. {ad} hesabını dilediği an silebilir.

### Hakların

KVKK m. 11 ve UK GDPR kapsamındaki haklar (bilgi alma, düzeltme, silme, itiraz vb.) için [İLETİŞİM E-POSTASI] adresine
yazabilirsin. Ayrıntılar: Droblet Gizlilik Politikası, KVKK Aydınlatma Metni ve genç kullanıcılara ilişkin bölüm.
[HUKUK ONAYI: yasal temsilci sıfatıyla yapılan başvuruların nasıl doğrulanacağı]

---

## B. Onay kutuları

Onay için **üç kutunun üçü de** işaretlenmelidir (hiçbiri önceden işaretli değildir). Deneme kutusu **ayrıdır** ve isteğe
bağlıdır; yalnızca özellik açıksa gösterilir.

1. ☐ **{ad}'ın annesi, babası ya da yasal vasisiyim.**
2. ☐ **Yukarıdaki aydınlatma metnini okudum.**
3. ☐ **{ad}'ın kişisel verilerinin, fotoğraflarının yapay zekâ ile işlenmesi ve bu amaçla OpenAI'ye (ABD) aktarılması
   dahil, yukarıda anlatıldığı şekilde işlenmesine onay veriyorum.**

Ayrı ve isteğe bağlı (yalnızca sanal deneme açıksa gösterilir):

4. ☐ **{ad}'ın boy ya da yüz fotoğrafından, onu kıyafetlerle gösteren görseller (“Üzerimde gör”) üretilmesine de onay
   veriyorum. Görseller tam giyimli, sade duruşlu ve gerçek yaşına uygun üretilir; yalnızca {ad}'a görünür.**

Düğmeler: **Onayla** · **Reddet**

[HUKUK ONAYI: (a) 2 numaralı kutu KVKK Aydınlatma Tebliği'ndeki "aydınlatma ile açık rızanın birleştirilmemesi" ilkesine
aykırı mı; (b) 3 numaralı kutu birden fazla amacı (yapay zekâ işleme + yurt dışı aktarım) tek beyanda topluyor —
ayrıştırılmalı mı; (c) ebeveyn onayı gencin kendi açık rızasının yerine mi geçer, yanına mı eklenir? (REVIEW Q17)]

Onaydan sonra gösterilecek metin: "Teşekkürler. Onayın kaydedildi. Onayını geri almak için kullanabileceğin bağlantıyı
e-postayla gönderdik."
Ret sonrası: "Kararın kaydedildi. {ad}'ın hesabında fotoğraflı ve yapay zekâlı özellikler kapalı kalacak."
Geri alma sonrası: "Onayın geri alındı. {ad}'ın kişisel fotoğrafları silindi ve fotoğraflı özellikler kapatıldı."

---

## C. E-posta metinleri (kısa)

### C1. Onay isteği e-postası

**Konu:** {ad}, Droblet için onayını istiyor

Merhaba,

{ad}, Droblet adlı gardırop ve stil uygulamasını kullanmak için senin onayını istiyor. Droblet'te 16–17 yaşındakiler
sosyal özellikleri, alışverişi ve reklamı olmayan bir **genç modunda** kullanır. Fotoğraflı ve yapay zekâlı özellikler
(fotoğrafların OpenAI'ye, ABD gönderilmesi dahil) yalnızca senin onayınla açılır.

Ne işlendiğini okumak ve karar vermek için: **[Bilgileri oku ve karar ver]** ({ParentConsentUrl}?token=…)

Bağlantı **7 gün** geçerlidir. Bu isteği tanımıyorsan bu e-postayı yok sayabilirsin; adresini başka bir amaçla
kullanmayız.

Droblet Ltd, Londra · [İLETİŞİM E-POSTASI]

### C2. Onay teyit e-postası (geri alma bağlantılı)

**Konu:** Onayın kaydedildi — Droblet

Merhaba,

{ad}'ın Droblet hesabı için onayını {tarih} tarihinde kaydettik (metin sürümü 2026-11-21). Sanal deneme:
{izin verildi / izin verilmedi}.

Onayını **istediğin an** geri alabilirsin: **[Onayımı geri al]** ({ParentConsentUrl}?token=…)
Geri alırsan fotoğraflı özellikler kapanır ve {ad}'ın kişisel fotoğrafları (boy, yüz, deneme görselleri, palet sonucu,
profil fotoğrafı) silinir. Bu bağlantı {ad} 18 yaşına girene kadar geçerlidir; bu e-postayı sakla.

Onayı sen vermediysen bize hemen yaz: [İLETİŞİM E-POSTASI].

Droblet Ltd, Londra · [İLETİŞİM E-POSTASI]

[HUKUK ONAYI: teyit e-postası COPPA'daki "e-posta + teyit" yöntemine benzer; tek başına yeterli kabul edilir mi? (REVIEW Q19)]
