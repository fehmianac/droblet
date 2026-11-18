# Droblet — Uygulama Tasarım Dokümanı (Geliştirici)

> Kaynak: ürün sahibinin `Droblet — Uygulama Tasarım Dokümanı (Geliştirici).docx` dosyası (18 Kasım 2026), düz metne çevrildi. Tablolar satır satır yazılı. Teknik yığınla çelişen maddeler için README.md §9'a bak.

Nov 18, 2026 · @Damla
1. Amaç ve kapsam
Bu doküman, Lovable'daki çalışan Droblet prototipini App Store ve Google Play'de yayınlanacak bir mobil uygulamaya dönüştürecek yazılımcı için hazırlandı. Ekran tasarımlarının kaynağı Droblet — Uygulama UX/UI tasarım tuvali (30 ekran + tasarım sistemi); iş kuralları Ekim 2026 yatırımcı sunumundan alındı.
Ürün tek cümlede: Kullanıcının gardırobunu bilen, eksik parçayı öneren ve her satıştan komisyon kazanan bir AI stil danışmanı.
Çözdüğü iki problem: Her sabah "ne giysem" kararsızlığı ve seyahat öncesi saatler süren bavul hazırlığı. Her ekran bu ikisinden birini kısaltmalı.
Döngü (ürünün omurgası):
	•	Dijitalleştir — Kullanıcı kıyafetlerini fotoğraflar ya da hazır ürün kütüphanesinden seçer; gardırop kategori ve sezona göre düzenlenir.
	•	Kombinle — AI; sezon, hava durumu, takvim ve kişisel renk paletine göre günlük ve haftalık look üretir.
	•	Tamamla — Look'u tamamlayan eksik parça tek dokunuşla satın alınır; ödeme markanın sitesinde olur, Droblet komisyon alır.
	•	Değerlendir (faz 2) — Giyilmeyen parçalar ikinci el satışa veya kiraya çıkar.
Gelir modeli ve ürüne etkisi:
Gelir kalemi
Oran / fiyat
Başlangıç
Ürüne etkisi
Üyelik + AI kredisi
$4,99/ay kadın · $3,99/ay erkek ve aile
Lansman
Paywall, kredi sayacı, ek kredi paketi
Yeni ürün komisyonu
%7 → %12 (eksik parça)
Lansman
Affiliate link takibi, "Look'u tamamla", izleme listesi
Marka iş birlikleri
Sponsorlu edit ve vitrin
2028
Edit ve mağazada "Sponsorlu" etiketi
İkinci el
%10 satıcı komisyonu
Temmuz 2027
"Sat" akışı, ilan, ödeme
Abiye kiralama
Kira bedelinin %20'si
Ocak 2028
"Kirala" akışı
Kozmetik
%15 komisyon
Ocak 2029
Renk paletinden makyaj önerisi
Bu işin kapsamı (faz 1, pre-seed): Uygulama Q4 2026'da canlıda. Yazılım bütçesi $35K. Faz 1 = üyelik + yeni ürün komisyonu, Türkiye pazarı, kadın segmentiyle başlangıç. İkinci el, kiralama ve kozmetik bu sürümde yok; ancak veri modeli ve gezinme bunlara yer bırakmalı (bkz. bölüm 7).
Hedef kullanıcı: Türkiye'de online moda alışverişi yapan kadınlar (Türkiye'de giyim harcamasının %56'sı kadınlara ait). Sonraki fazlarda erkek, genç (13–18) ve çocuk segmentleri; gençler için ebeveyn hesabı zorunlu.
2. Bilgi mimarisi ve gezinme
Prototipteki 15 maddelik hamburger menü kaldırılıyor; yerine 5 sekmeli alt menü geliyor: Bugün · Gardırop · Stilist · Keşfet · Profil. Stilist, ortada vurgulu yuvarlak butondur ve uygulamanın ana eylemidir. Her ekran en fazla iki dokunuşla erişilebilir olmalı.

Gezinme · 5 sekme, 30 ekran
Onboarding bir kez geçilir; sonrasında her ekran beş sekmeden birinin altındadır. Stilist tek vurgulu sekmedir.
Kurallar:
	•	Alt menü yalnızca 5 ana ekranda ve onların liste ekranlarında görünür. Detay, oluşturma ve ödeme ekranlarında gizlenir; yerine alt sabit eylem çubuğu gelir.
	•	Gardırop sekmesinin üstünde üç bölümlü seçici var: Parçalar / Looklar / Bavullar. Bunlar aynı sekmenin alt görünümleridir, ayrı sekme değil.
	•	Keşfet sekmesinin üstünde yatay çipler var: Editör, Mağaza, Influencer, Arkadaşlar, Dizi outfitleri.
	•	Sepet ikonu Keşfet ve mağaza ekranlarının sağ üstünde, rozetle ürün sayısını gösterir.
	•	Admin rotaları (/admin/*) mobil uygulamaya girmez; web panelinde kalır.
Mevcut Lovable rotaları → yeni yer:
Mevcut rota
Yeni yer
Tasarım ekranı
/giris /kayit /sifremi-unuttum /reset-password
Kayıt/giriş (tek ekran, sekmeli)
02
/
Bugün sekmesi
06
/hafta
Bugün › Haftalık plan
07
/bu-hafta /edit/:id
Bugün › Haftanın edit'i
08
/takvim
Bugün › Takvim
09
/gardirop/ /gardirop/:id
Gardırop › Parçalar, Parça detayı
10, 11
/ekle /toplu-ekle
Gardırop › + (kamera), Toplu ekle
12, 13
/lookbook /look/:id /look/yeni
Gardırop › Looklar, Look oluştur
14, 15
/danisman
Stilist sekmesi
16, 17
/bavul/ /bavul/:id
Gardırop › Bavullar, Bavul detayı
18, 19
/icerik
Keşfet › Influencer lookları
20
/magaza/ /magaza/urun/:id /magaza/koleksiyon/:id
Keşfet › Mağaza, Ürün
21, 22
/magaza/kombin /magaza/look
Kombin oluşturucu (Parçamı tamamla dahil)
23
/magaza/sepet
Sepet
24
/akis
Keşfet › Arkadaşlar
25
/kisi/:username /arkadaslar
Kişi profili, Dolapları keşfet
26, 27
/profil
Profil + Gizlilik ve ayarlar + Renk paleti (bölündü)
28, 29, 30
/admin/*
Web yönetim paneli (uygulama dışı)
—
Mevcut /profil ekranı tek uzun sayfada 10'dan fazla ayarı barındırıyor. Yeni yapıda profil bir özet ve menü; ayarlar ve renk paleti ayrı ekranlardır.
3. Tasarım sistemi
Mevcut Droblet kimliği korunuyor: krem zemin, Cormorant Garamond başlıklar, Jost metin, espresso vurgu. Tüm değerleri tek bir tema dosyasında token olarak tanımla; ekranlarda sabit hex kullanma.

Renk tokenları:
Token
Hex
Kullanım
ink
#1C1A17
Ana metin, birincil buton, seçili çip, aktif sekme
cream
#F4F1EC
Ekran zemini, koyu zemin üzerindeki metin
paper
#FBF9F5
Kart, alan, alt menü, sabit alt çubuk
accent
#6E5640
Rozet, ilerleme çubuğu, sepet sayısı, mağazadan gelen parça etiketi
muted
#665F56
İkincil metin, üst etiket (eyebrow)
line
#DCD4C9
Kart kenarı, ayırıcı, çip kenarı
sand
#E8E1D7
Bölümlü seçici zemini, bilgi kutusu, boş görsel
danger
#9A3B2E
Silme eylemleri
Tüm metin/zemin çiftleri WCAG AA (4,5:1) geçmeli; muted metin cream ve paper üzerinde geçer. Faz 1'de karanlık mod yok; tokenlar sonradan karanlık tema eklemeye izin verecek şekilde kurulsun.
Tipografi:
Stil
Font
Boyut / satır
Ağırlık
Örnek
Display
Cormorant Garamond
36 / 38
500
"Bu hafta ne giyeceksin?"
Başlık 2
Cormorant Garamond
26 / 29
500
Look ve ürün adı
Başlık 3
Cormorant Garamond
20 / 23
600
Bölüm başlığı
Gövde
Jost
14 / 21
400
Açıklamalar
Etiket (eyebrow)
Jost, BÜYÜK HARF, harf aralığı %14
11
500
"HAFTALIK STİL · 9–15 KASIM"
Marka
Jost, BÜYÜK HARF, harf aralığı %12
10,5
500
"MARKS & SPENCER"
Buton
Jost
15
500
"Look'u satın al"
Türkçe büyük harfe çevirmede tr yerel ayarı kullanılmalı (i → İ). Fontlar uygulamaya gömülü gelsin; latin-ext alt kümesi gerekli. Dinamik yazı boyutunda (iOS Dynamic Type, Android font scale) başlıklar %130'a kadar büyüyebilmeli.
Boşluk, köşe, boyut:
	•	Izgara 4 pt; ekran yan boşluğu 20; bölümler arası 16–24.
	•	Köşe: kart 20, görsel 12–14, alan 12, buton ve çip tam yuvarlak.
	•	Birincil buton 52 yükseklik; ikincil 44; ikon buton 44×44; çip 36. Dokunma alanı en az 44×44.
	•	Alt menü 86 yükseklik (güvenli alan dahil); orta Stilist butonu 56 çap, menüden 18 yukarı taşar.
Bileşenler (tasarım tuvalindeki "Tasarım sistemi" panosu):
	•	Buton: birincil (dolu ink), ikincil (çerçeveli), ikon buton (yuvarlak, çerçeveli). Yükleniyor durumunda metin yerine dönen gösterge; devre dışı %40 opaklık.
	•	Çip: filtre ve tek seçim için; seçili hali dolu ink. Yatay kaydırılabilir sıralarda kullanılır.
	•	Bölümlü seçici: sand zemin, seçili segment paper + hafif gölge.
	•	Ürün satırı: küçük görsel + marka + ad (tek satır, üç nokta) + fiyat.
	•	Ürün kartı: 2 sütunlu ızgara; görsel 4:5, sağ üstte favori kalbi.
	•	Look kartı: görsel + ortam etiketi + ad + (varsa) arkadaş puanı.
	•	Boş slot: kesikli çerçeve + artı ikonu; tıklanınca seçim sayfası açar.
	•	Alt sabit eylem çubuğu: paper zemin, üst kenar çizgisi; toplam fiyat + birincil buton.
	•	Alt sayfa (bottom sheet): 28 köşe, tutma çizgisi; filtreler ve seçimler için.
İkonlar: Çizgi ikon seti, 1,5 kalınlık, yuvarlak uç. Lucide prototipte zaten kullanılıyor; aynı setle devam et. Emoji kullanılmaz.
Görseller: Tasarımdaki bej kutular yer tutucudur. Gerçek uygulamada üç görsel tipi var: kullanıcının kendi üzerindeki AI görseli ("Senin üzerinde" etiketi), arka planı temizlenmiş parça görseli (düz sand zemin) ve mağaza ürün görseli. AI görselleri her zaman etiketlenmeli.
Erişilebilirlik: Ekran okuyucu etiketleri tüm ikon butonlarda zorunlu; renk tek başına anlam taşımamalı; hareket azaltma ayarında geçiş animasyonları kapanır.
4. Ekran ekran spesifikasyon
30 ekranın her biri tasarım tuvalinde aynı numarayla yer alıyor (390×844, iPhone 14/15 boyutu). Her ekran için amaç, içerik, etkileşim ve durumlar aşağıda. "Sunumdan eklenecek" işaretli maddeler yatırımcı sunumunda vaat edilen ama tasarım tuvalinde henüz çizilmemiş özelliklerdir; geliştirme sırasında bu ekranlara eklenmeli.
Tüm liste ekranları için ortak durumlar: yükleniyor (iskelet kutular, spinner değil), boş (tek cümle + tek eylem butonu), hata (tekrar dene butonu), çevrimdışı (önbellekteki veri + üst bant).
4.1 Giriş ve onboarding (01–05)

01 Hoş geldin — Uygulamanın ilk açılışı.
	•	2×2 look görseli kolajı, alttan krem geçiş; logo, iki problemi anlatan tek cümle.
	•	"Hemen başla" → 02 (Kayıt sekmesi açık); "Zaten hesabım var" → 02 (Giriş sekmesi açık).
	•	Kullanım Koşulları ve Gizlilik Politikası linkleri tıklanabilir olmalı.
02 Kayıt / giriş — Tek ekran, üstte Kayıt ol / Giriş yap seçicisi.
	•	Apple ile giriş (iOS'ta zorunlu, App Store kuralı), Google ile giriş, e-posta + şifre.
	•	Kayıtta: ad, e-posta, şifre (en az 8 karakter). Girişte ad alanı gizlenir, "Şifremi unuttum" linki görünür.
	•	Hata mesajları alanın altında, danger renginde. Başarılı kayıt → 03; başarılı giriş → 06.
	•	Şifre sıfırlama mevcut /sifremi-unuttum akışıyla aynı; e-postadaki link uygulamayı açmalı (deep link).
03 Stil profili (onboarding 1/3)
	•	Segment: Kadın / Erkek / Genç (13–18). Faz 1'de yalnızca Kadın aktif; diğerleri "Yakında" rozetiyle devre dışı.
	•	Stil etiketleri: tam 3 seçim (3'ten fazlası seçilemez). Etiketler profil ve "stil uyumu" hesabında kullanılır.
	•	Bütçe: High street / Karma / Lüks dokunuş. Haftanın edit'indeki fiyat bandı seçicisinin varsayılanıdır.
	•	Sunumdan eklenecek: Genç seçilirse ebeveyn hesabı akışı (bkz. 5.8).
04 Beden ve fotoğraf (onboarding 2/3)
	•	Boy, kilo (opsiyonel), beden. Boy fotoğrafı (düz arka plan, tam boy, 1–3 adet) ve yüz fotoğrafı (renk paleti için).
	•	Kamera ve galeri izni bu ekranda, işlevin hemen yanında istenir; reddedilirse ayarlara yönlendiren açıklama.
	•	Gizlilik kutusu her zaman görünür. "Atla" ile geçilebilir; fotoğraf yoksa "üzerimde gör" özellikleri fotoğraf isteğiyle açılır.
05 Üyelik (paywall)
	•	Fiyatlar: Kadın $4,99/ay, Erkek ve aile $3,99/ay. TL fiyatları App Store / Play Console fiyat kademelerinden gelir; ekranda sabit yazılmaz, mağaza API'sinden okunur.
	•	Aylık ve yıllık seçenek (yıllık fiyatı henüz belirlenmedi — açık konu). Deneme süresi açık konu.
	•	Pakete dahil: ayda 30 AI görseli (üzerimde gör), stil danışmanı, bavul, renk paleti. Fazlası ek kredi paketiyle.
	•	"Satın alımları geri yükle", Kullanım Koşulları ve Gizlilik linkleri zorunlu (mağaza kuralı). Kapat (×) butonu her zaman görünür.
	•	Gösterileceği yerler: onboarding sonu, kredi bitince, üye olmayan kullanıcı AI özelliğine dokunduğunda.
4.2 Bugün (06–09)

06 Bugün (ana sayfa) — Uygulama her açılışta buraya gelir.
	•	Üstte tarih, sezon, hava durumu (konuma göre; izin yoksa profildeki şehir). Kişisel selam + bugünün takvim ortamı.
	•	7 günlük şerit: bugün dolu; planı olan günlerde nokta. Dokununca 07'ye o gün seçili gider.
	•	Bugünün kombini kartı: "Senin üzerinde" görseli + parça küçük resimleri. "Bunu giyiyorum" → takvime "giyildi" yazar ve parçaların giyilme sayacını artırır; yenile ikonu → başka öneri; kalp → lookbook'a kaydet.
	•	Plan yoksa: "Bugün için plan yok" + "Stilistten öneri al".
	•	Haftanın edit'i yatay kaydırmalı şerit → 08.
	•	Sunumdan eklenecek: Look'ta gardıropta olmayan bir parça varsa "Eksik parça" işareti ve "Look'u tamamla" butonu (sunumdaki 01 Today ekranı).
07 Haftalık plan
	•	Haftanın ortamı özeti (örn. Ofis ×4), "Haftamı planla" (AI 7 günü doldurur) ve "Üzerimde gör" (tüm günler için AI görseli; kredi harcar, önce kaç kredi gideceğini göster).
	•	Gün satırları: dolu (look + ad + tarih + üç nokta menü: değiştir, kaldır) veya boş (kesikli kutu + "Öner").
08 Haftanın edit'i — Editör tarafından hazırlanan, kullanıcının üzerinde gösterilen 7 look.
	•	Üstte tam genişlik görsel, yatay kaydırma ile 7 look; nokta gösterge.
	•	Look adı, açıklama, parça listesi (marka, ad, fiyat). Alt sabit çubuk: toplam + "Look'u satın al".
	•	Fiyat bandı seçici: High street / Lüks dokunuş (prototipte var, korunacak).
	•	Sunumdan eklenecek: Gardıropta zaten olan parçalar gizlenir, sadece eksikler satın alınır; eksik parça "İzleme listem"e eklenebilir.
	•	Profil fotoğrafı yoksa görsel yerine "Profil fotoğrafını tamamla" kartı.
09 Takvim — "Ne giyeceğim, ne giydim".
	•	Aylık ızgara; giyilen/planlanan günlerde look küçük resmi, boş günlerde kesikli kutu. Güne dokunma → o günün look'u veya öneri.
	•	Ay özeti: kayıtlı gün sayısı, en çok giyilen parça.
4.3 Gardırop (10–15)

10 Gardırop › Parçalar
	•	Üstte toplam parça sayısı, Parçalar / Looklar / Bavullar seçicisi.
	•	Kategori çipleri: Tümü, Üst, Alt, Elbise, Dış giyim, Ayakkabı, Çanta, Aksesuar, Plaj giyim, Kayak giyim (prototiptekiyle aynı). Filtre ikonu → alt sayfada sezon, renk, marka, sıralama.
	•	3 sütunlu ızgara, parça görseli + ad. Uzun basma → çoklu seçim (look oluştur, sil, sezon değiştir).
	•	Sağ üst "+" → 12. Arama ikonu → gardıropta metin araması.
	•	Boş durum: "Gardırobun boş" + "İlk parçanı ekle" + "Hazır kütüphaneden seç".
11 Parça detayı
	•	Tam genişlik parça görseli; kategori ve sezon; beden, renk, kumaş, giyilme sayısı kutuları.
	•	"Bu parçayla looklar" yatay şerit. Düzenle ikonu → alanları düzenle; üç nokta → sil, sezonu değiştir.
	•	Alt çubuk: "Bununla kombin yap" (Stilist, bu parça sabit) + çanta ikonu (mağazada bu parçayı tamamlayan ürünler = prototipteki /magaza/look).
	•	Sunumdan eklenecek (faz 2): "Sat" ve "Kiraya ver" eylemleri; bu yıl giyilmeyen parçalarda "Bu yıl giymedin, satmak ister misin?" önerisi ve fiyat tahmini.
12 Parça ekle (kamera)
	•	Tam ekran kamera, koyu zemin, kadraj köşeleri. AI çekimden sonra kategori, renk, kumaş tahmin eder ve etiket olarak gösterir.
	•	Sol alt: galeriden seç. Sağ alt: hazır ürün kütüphanesinden ekle (fotoğrafsız ekleme). Sağ üst: Toplu ekleme.
	•	Çekimden sonra form: ad, kategori, marka, beden, renk, kumaş, sezon (en az bir sezon zorunlu) — prototipteki /ekle alanlarıyla aynı, AI önceden doldurur.
	•	Arka plan temizleme otomatik; kullanıcı orijinale dönebilir.
13 Toplu ekle
	•	En fazla 30 fotoğraf. İlerleme kartı (işlenen / toplam). İşlem arka planda devam eder; kullanıcı ekrandan çıkarsa bitince bildirim gelir.
	•	Kontrol listesi: her parça için görsel, ad, kategori · renk, onay kutusu. AI'nın emin olmadığı parçalarda "Kategoriyi kontrol et" rozeti ve onay kutusu boş gelir.
	•	"Kombin fotoğrafından parçaları ayır" seçeneği de buradan (prototipte var).
14 Gardırop › Looklar (eski Lookbook)
	•	2 sütunlu look ızgarası; ortam etiketi, ad, varsa arkadaş puanı ortalaması, kalp.
	•	Çipler: Tümü, Favoriler, Ofis, Akşam, Hafta sonu, Seyahat. "+" → 15.
15 Look oluştur
	•	Sol: önizleme (üstümde görülürse AI görseli). Sağ: look adı, ortam çipleri, "Üzerimde gör".
	•	5 slot: Üst, Alt, Dış giyim, Ayakkabı, Çanta/Aksesuar. Boş slot → gardırop veya mağaza seçimi. En az 2 parça ile kaydedilebilir.
4.4 Stilist ve bavul (16–19)

16 Stilist — Orta butonun açtığı ekran; prototipteki /danisman.
	•	Serbest metin alanı ("Örn. akşam iş yemeği, yağmurlu") + ortam çipleri: Ofis, Akşam yemeği, Hafta sonu, Düğün, Seyahat, Spor.
	•	Bağlam rozetleri: hava durumu, sezon, "Sadece gardırobum" (kapalıysa mağazadan eksik parça da önerilir).
	•	"Kombin öner" → 17. Alt kısımda kısayol kartları: Bavul hazırla, Haftamı planla, Look oluştur, Renk paletim.
17 Kombin önerisi
	•	3 öneri, yatay kaydırma. Her biri: "AI önizleme" etiketli kullanıcı görseli + parça küçük resimleri, ad, kısa stil notu.
	•	Parça listesi: gardıroptan gelenlerde onay işareti; mağazadan önerilende accent renkte "Önerilen · Mağaza" ve "Gör" butonu (komisyon fırsatı).
	•	Alt: beğenmedim (×, bir sonraki öneri; geri bildirim modele gider), "Takvime ekle", kalp (lookbook).
	•	AI görseli kredi harcar. Kredi bittiğinde görsel yerine parça kolajı + "Kredi yükle".
18 Gardırop › Bavullar
	•	Yeni bavul formu: şehir (otomatik tamamlama), gidiş–dönüş tarihi, seyahat tipi çipleri (İş, Akşam yemeği, Gezi, Sadece kabin). "Bavulu oluştur" → 19.
	•	Geçmiş seyahatler listesi (prototipteki "Seyahat arşivi").
19 Bavul detayı
	•	Şehir, tarih, günlük hava tahmini. Özet: parça sayısı, look sayısı, hazırlık halkası.
	•	Günlük looklar (gün + ortam), "Üzerimde gör".
	•	Bavul listesi: işaretlenebilir satırlar, işaretli olan üstü çizili.
	•	Sunumdan eklenecek: Eksik parça tespiti (örn. yağmur botu) ve "Eksikleri tamamla" alışveriş listesi — sunumdaki 04 Trip planner ekranı. Tek kabin bavulu modu.
4.5 Keşfet ve mağaza (20–24)

20 Keşfet
	•	Üst çipler: Editör, Mağaza, Influencer, Arkadaşlar, Dizi outfitleri (SheerLuxe tarzı editöryal yapı).
	•	Büyük kapak kartı: haftanın edit'i → 08. Content creator lookları yatay şerit (prototipteki /icerik): her look'un parçaları satın alınabilir.
	•	Sponsorlu edit veya vitrinler (2028, marka iş birliği) "Sponsorlu" etiketiyle gösterilmeli.
21 Stil mağazası — Kadın seçkisi.
	•	Arama alanı; iki kısayol: Kombin oluşturucu (23) ve Parçamı tamamla (gardıroptan parça seç → tamamlayan ürünler).
	•	Kategori çipleri (prototiptekiyle aynı: Tişörtler … Aksesuarlar), Marka / Renk / Beden alt sayfa filtreleri, sıralama (varsayılan: en yeni).
	•	Markalar: Lululemon, Gap, Marks & Spencer, Vakko, Beymen, Communité (prototipte bulunanlar).
	•	2 sütunlu ürün ızgarası, sonsuz kaydırma.
22 Ürün detayı
	•	Görsel alanı ikiye bölünür: ürün görseli + kullanıcının üzerinde AI görseli. Altında Ürün / Üzerimde geçişi.
	•	Marka, ad, fiyat, beden seçici (profildeki beden önceden seçili). "Gardırobundaki N parçayla uyumlu" → 23 bu ürün sabitken.
	•	Alt çubuk: "Gardıroba ekle" (satın almadan, zaten sahipse) ve "Sepete ekle".
	•	Ödeme ve teslimat markanın sitesinde tamamlanır; bu bilgi ekranda görünür.
	•	Sunumdan eklenecek: "İzleme listeme ekle" (kalp ikonundan ayrı: fiyat düşünce bildirim).
23 Kombin oluşturucu — Prototipteki /magaza/kombin ve /magaza/look birleşti.
	•	Sol önizleme, sağ 5 slot (Üst, Alt, Dış giyim, Ayakkabı, Çanta). Her slot mağazadan veya gardıroptan dolar; mağazadan gelen slot fiyatı accent renkte.
	•	Alt kısımda seçili boş slot için Mağaza / Gardırobum önerileri.
	•	Alt çubuk: "Lookbook'a kaydet" ve "N ürünü satın al" (N = mağazadan gelen parça sayısı).
24 Sepet
	•	Ürünler markaya göre gruplu; her grubun altında "[Marka]'da öde" butonu affiliate linkle markanın sitesini açar (uygulama içi tarayıcı).
	•	Bilgi notu: "Sepete eklemek satın alma yapmaz; ödeme her markanın kendi mağazasında."
	•	Boş durum: "Sepetin boş" + "Ürünleri keşfet".
4.6 Sosyal (25–27)

25 Arkadaş akışı — "Arkadaşların ne giyiyor?"
	•	Üstte takip edilenlerin hikaye halkaları (yeni look olan halka accent).
	•	Look kartı: kişi, ortam, zaman; büyük görsel; 1–5 yıldız puanlama, kaydet, paylaş; ortalama puan ve "Parçaları gör" (arkadaşın look'undan alışveriş = komisyon).
	•	Paylaş: WhatsApp, Pinterest, link kopyala. Paylaşılan link uygulamayı açar, yüklü değilse mağazaya yönlendirir (davet akışı, bkz. 5.7).
26 Kişi profili
	•	Avatar, ad, kullanıcı adı, stil etiketleri; parça, look ve stil uyumu sayıları. Takip et, Dolabını keşfet.
	•	Sekmeler: Looklar, Dolap, Seyahatler. Dolap gizlilik ayarına göre görünür (Herkese açık / Yalnızca takipçiler / Gizli).
	•	Üç nokta: şikayet et, engelle (App Store kuralı: kullanıcı içeriği olan uygulamalarda zorunlu).
27 Dolapları keşfet — Prototipteki /arkadaslar.
	•	Kullanıcı adı araması; rehberden arkadaş bul; davet linki.
	•	Influencer dolapları (örn. Gardropgurusu, Pelin Çutakyan — hedef listede, henüz anlaşma yok).
	•	"Sana benzeyen dolaplar": stil etiketlerinden hesaplanan uyum yüzdesi.
4.7 Profil (28–30)

28 Profil
	•	Avatar, ad, kullanıcı adı, stil etiketleri; parça, look, takipçi sayıları.
	•	Stil fotoğrafı durumu kartı (hazır / eksik → yükle).
	•	Menü: Gardırop istatistikleri, Seyahat arşivi, Renk paletim (30), Üyelik (05 / abonelik yönetimi), Gizlilik ve fotoğraflar (29), Ayarlar (29).
	•	Sunumdan eklenecek: AI kredi sayacı (örn. "Bu ay 30 görselden 12'si kaldı") ve "Kredi yükle"; Aile planı üyeleri.
29 Gizlilik ve ayarlar
	•	Dolabımı kimler görebilir: Herkese açık / Yalnızca takipçiler / Gizli.
	•	Fotoğraflarım: yüz ve stil fotoğrafları, ekle/kaldır; "Fotoğraflarımı ve üretilen görselleri sil" (onay penceresi zorunlu, geri alınamaz).
	•	Bildirimler: sabah kombin hatırlatması, haftanın edit'i, arkadaş puanları.
	•	Çıkış yap, Hesabımı sil (App Store kuralı: uygulama içinden hesap silme zorunlu). Dil seçimi (TR / EN).
30 Renk paletim
	•	Sezon tipi (örn. Sıcak Sonbahar), sana yakışan 8 ton, kaçınman gereken tonlar.
	•	Gardırobun paletinle uyum oranı → uyumsuz parçalar listesi. "Paletime uygun ürünler" → mağaza, renk filtresi uygulanmış.
	•	Yüz fotoğrafı yoksa: "Önce yüz fotoğrafını yükle" boş durumu.
5. Kritik akışlar
Gelir üreten iki akış önceliklidir: üyelik satın alma (5.2) ve eksik parçayı tamamla → affiliate satış (5.5). Bu ikisi hatasız ve ölçülür olmadan uygulama yayınlanmaz.
5.1 Onboarding
	•	01 Hoş geldin → 02 Kayıt (Apple / Google / e-posta).
	•	03 Segment, 3 stil etiketi, bütçe.
	•	04 Boy, beden, boy fotoğrafı, yüz fotoğrafı (atlanabilir).
	•	İlk 5 parça: kamera ya da hazır kütüphaneden hızlı seçim ("Gardırobunda bunlardan hangileri var?"). Bu adım olmadan ilk kombin önerisi boş kalır.
	•	05 Üyelik → 06 Bugün, ilk kombin hazır.
Hedef: kayıttan ilk kombine 3 dakikadan kısa. Her adım analitikte ayrı olay olarak izlenir (huni).
5.2 Üyelik ve AI kredisi
	•	Abonelik iOS'ta StoreKit, Android'de Google Play Billing ile; ikisini tek yerden yönetmek için RevenueCat önerilir (Stripe gibi dış ödeme dijital abonelikte mağaza kurallarına aykırı).
	•	Ürünler: Kadın aylık ($4,99), Erkek ve aile aylık ($3,99), yıllık varyantlar, ek kredi paketi (tüketilebilir satın alım).
	•	Kredi kuralı: üyelik ayda 30 AI görseli içerir. Her "üzerimde gör" görseli 1 kredi. Metin danışmanı krediden düşmez. Kredi aylık yenilenir, devretmez.
	•	Kredi sayacı sunucuda tutulur (istemciye güvenilmez). Kredi bitince: 05'e değil, ek kredi paketi alt sayfasına yönlendir.
	•	Neden önemli: sunumdaki birim ekonomide görsel başına maliyet ≈ $0,039; ayda 90 görselde katkı sıfıra iner. 30 görsel sınırı kesin uygulanmalı.
5.3 Gardıroba ekleme
	•	"+" → kamera (12). Çekim → arka plan temizleme + AI etiketleme → önceden doldurulmuş form → kaydet.
	•	Alternatif: hazır ürün kütüphanesinden seç (fotoğrafsız) veya mağaza ürününde "Gardıroba ekle".
	•	Toplu: 30 fotoğrafa kadar → arka planda işlem → kontrol listesi (13) → onaylananlar eklenir.
5.4 Stilist (kombin önerisi)
	•	Ortam + bağlam (hava, sezon, takvim, renk paleti, "sadece gardırobum").
	•	Sunucu gardıroptan aday parçaları seçer, LLM 3 kombin üretir (metin, krediden düşmez).
	•	Kullanıcı bir öneriye bakarken AI görseli istenirse üretilir (1 kredi). Görseller önbelleğe alınır; aynı kombin ikinci kez kredi harcamaz.
	•	Eksik parça varsa mağazadan, kullanıcının bedeninde ve bütçe bandında ürün önerilir.
5.5 Eksik parçayı tamamla → satın alma (gelir akışı)
	•	Look'ta eksik parça işaretlenir (06, 08, 17, 19).
	•	"Look'u tamamla" → sadece eksik parçalar, kullanıcının bedeninde, seçili fiyat bandında (High street / Lüks dokunuş).
	•	Sepete ekle → 24 Sepet, markaya göre gruplu.
	•	"[Marka]'da öde" → affiliate linkli uygulama içi tarayıcı; ödeme ve teslimat markada.
	•	Satın alınmazsa parça "İzleme listem"e düşer; fiyat düşünce bildirim.
	•	Affiliate ağından (veya marka postback'inden) gelen satış kaydı kullanıcı ve look ile eşleştirilir; satın alınan parça kullanıcıya "Gardıroba ekleyelim mi?" diye sorulur.
5.6 Bavul
	•	Şehir + tarih + seyahat tipi → günlük hava tahmini çekilir.
	•	AI günlük lookları ve en az parça ile bavul listesini oluşturur (her parça birden fazla look'ta kullanılır).
	•	Eksikler (örn. yağmur botu) alışveriş listesine düşer → 5.5.
	•	Kullanıcı listeyi işaretleyerek bavulu hazırlar; seyahat sonrası arşive taşınır.
5.7 Sosyal döngü ve davet
	•	Paylaş (WhatsApp, Pinterest, link) → 2. Arkadaş puanlar (1–5) → 3. Arkadaşın look'undan satın al (komisyon) → 4. Link yeni kullanıcı getirir.
	•	Paylaşılan her link davet kodu taşır; kurulumdan sonra (deferred deep link) davet eden kullanıcıyla eşleşir. Bu, sunumdaki düşük edinim maliyeti varsayımının ölçümüdür.
	•	Faz 1'de look paylaşımından kullanıcıya kazanç yok; altyapı (hangi look'tan hangi satış) faz 2 için kurulur.
5.8 Genç ve aile hesabı (faz 1 sonrası)
	•	18 yaş altı kullanıcı ebeveyn hesabına bağlanır; KVKK ebeveyn onayı alınır.
	•	Profil varsayılan olarak gizli. Satış, kiralama ve ödeme ebeveyn onayı ister.
	•	Aile planı $3,99/ay, ebeveyn öder. Paylaşılan looklardan kazanç yok.
6. Veri modeli, entegrasyonlar ve teknik gereksinimler
Mevcut prototip Supabase (veritabanı, auth, depolama) üzerinde çalışıyor; Supabase arka uç olarak korunur, mobil istemci aynı şemaya bağlanır. İstemci teknolojisi (React Native/Expo, Flutter veya Capacitor ile web sarımı) yazılımcıyla netleştirilecek açık konudur; tasarım hepsine uygundur.
Ana varlıklar:
Varlık
Temel alanlar
Not
profile
ad, kullanıcı adı, segment, stil etiketleri, bütçe bandı, boy, kilo, beden, şehir, dolap gizliliği
Kilo opsiyonel, hassas veri
body_photo
tür (yüz / stil), dosya yolu, oluşturma tarihi
Sadece sahibi okur (RLS)
color_palette
sezon tipi, uygun tonlar, kaçınılacak tonlar
Yüz fotoğrafından
garment
kategori, ad, marka, beden, renk, kumaş, sezonlar, görsel, kaynak (fotoğraf / kütüphane / satın alım), giyilme sayısı, son giyilme
Faz 2: satış/kiralama durumu
look
ad, ortam, sezon, parçalar (gardırop veya ürün), AI görseli, kaynak (kullanıcı / stilist / edit)
Eksik parça = ürün referanslı slot
calendar_entry
tarih, look, durum (planlı / giyildi)
"Bunu giyiyorum" yazar
trip
şehir, tarihler, tip, looklar, bavul listesi (işaretli/değil)

product
marka, ad, fiyat, görsel, kategori, renk, bedenler, affiliate linki, fiyat bandı
Admin panelinden yönetilir
weekly_edit
hafta, segment, 7 look, fiyat bandı varyantları, sponsor
Admin panelinden
cart_item, watchlist_item
kullanıcı, ürün, beden, kaynak look

click, conversion
kullanıcı, ürün, look, marka, tutar, komisyon, durum
Gelir raporunun temeli
follow, rating, share
takip, 1–5 puan, paylaşım kanalı + davet kodu

subscription, credit_ledger
plan, durum, yenileme tarihi; kredi hareketleri
Sunucu tarafında, mağaza bildirimleriyle güncellenir
Entegrasyonlar:
Alan
Faz 1 çözümü
Not
Kimlik
Supabase Auth: Apple, Google, e-posta
Apple ile giriş iOS'ta zorunlu
Abonelik
StoreKit + Google Play Billing, RevenueCat ile
Sunucu webhook'u kredi ve abonelik tablosunu günceller
AI görsel (üzerimde gör)
Gemini 2.5 Flash Image (sunumdaki maliyet varsayımı, ≈ $0,039/görsel)
Çağrılar sadece sunucudan (Edge Function); API anahtarı istemcide olmaz
AI metin (stilist, etiketleme)
Prototipteki Lovable AI / LLM
Yanıt yapılandırılmış JSON
Arka plan temizleme
Prototipteki mevcut çözüm

Hava durumu
Hava durumu API'si (prototipte weather modülü var)
Günlük ve 7 günlük tahmin
Affiliate
Marka veya affiliate ağı linkleri + dönüşüm postback'i
Her tıklamaya click_id; komisyon %7–12
Bildirim
APNs + FCM (Expo Push veya OneSignal)
Sabah hatırlatması yerel saatle
Derin link
Universal Links / App Links + deferred deep link
Davet, şifre sıfırlama, paylaşılan look
Analitik
Huni ve gelir olayları (PostHog, Amplitude veya Firebase)
Olay listesi aşağıda
İzlenecek olaylar (yatırımcıya raporlanacak metrikler için): kayıt adımları, ilk parça, ilk kombin, paywall görüntülendi / abone oldu, kredi harcandı / bitti, look'u tamamla tıklandı, sepete eklendi, marka sitesine gidildi, dönüşüm, paylaşım, davetle kurulum. Sunumdaki GMV, ücretli dönüşüm ve sepet verisi bu olaylardan hesaplanır.
Gizlilik ve hukuk:
	•	Şirket Droblet Ltd (Londra), pazar Türkiye: hem KVKK hem UK GDPR. Açık rıza metni, aydınlatma metni, veri silme talebi.
	•	Yüz ve boy fotoğrafları özel depolama alanında, imzalı ve kısa ömürlü URL ile; sadece sahibi erişir. "Fotoğraflarımı sil" tüm türetilmiş görselleri de siler.
	•	App Store gizlilik etiketi ve Play Data Safety formu bu listeye göre doldurulur.
	•	Kullanıcı içeriği (look paylaşımı) olduğu için şikayet et, engelle ve içerik denetimi zorunlu.
Performans: Uygulama açılışından Bugün ekranının görünmesine 2 saniyeden kısa (önbellekten). Görseller CDN'den, boyutlandırılmış WebP. AI görsel üretimi sürerken iskelet + ilerleme metni; kullanıcı ekrandan çıkarsa bittiğinde bildirim.
7. Fazlama, yayın ve açık konular
Faz 1, Q4 2026'da App Store ve Google Play'de canlı olacak sürümdür; bu dokümandaki 30 ekranın tamamı faz 1 kapsamındadır. Sonraki fazlar sunumdaki yol haritasını izler; veri modeli bunlara şimdiden yer bırakır.
Faz
Zaman (sunum)
Uygulamaya giren
1 · Lansman
Q4 2026
30 ekran; kadın segmenti; üyelik + AI kredisi; yeni ürün komisyonu; sosyal paylaşım ve puanlama
1b
2027 başı
Erkek ve genç segmentleri, aile planı ve ebeveyn hesabı
2 · İkinci el
Temmuz 2027
Gardıroptan tek dokunuşla ilan, %10 satıcı komisyonu, çocuk ikinci el
3 · Kiralama ve markalar
Ocak 2028
Abiye kiralama (%20), sponsorlu edit ve vitrinler
4 · Kozmetik
Ocak 2029
Renk paletinden makyaj önerisi, %15 komisyon; sanal deneme v2
Yayın için tamamlanması gerekenler (faz 1 kabul kriterleri):
	•	☐ 30 ekran tasarım tuvaliyle birebir; yükleniyor, boş, hata durumları dahil
	•	☐ Apple ile giriş, uygulama içinden hesap silme, şikayet et / engelle
	•	☐ Abonelik ve ek kredi satın alma her iki mağazada test edildi; geri yükleme çalışıyor
	•	☐ AI kredi sayacı sunucuda; 30 görsel sınırı aşılamıyor
	•	☐ Affiliate tıklaması ve dönüşüm kaydı uçtan uca çalışıyor
	•	☐ Analitik olayları (bölüm 6) panoda görünüyor
	•	☐ KVKK / GDPR metinleri, App Store gizlilik etiketi, Play Data Safety
	•	☐ Türkçe ve İngilizce metinler; mağaza görselleri ve açıklamaları
	•	☐ Droblet Ltd adına Apple ve Google geliştirici hesapları
Açık konular (karar gerekiyor):
	•	☐ Lansman segmenti: sunumun yol haritası 2027'de kadın, erkek ve genç diyor; ürün planı önce yalnızca kadın. Faz 1'e hangileri girecek?
	•	☐ Yıllık üyelik fiyatı ve ücretsiz deneme süresi
	•	☐ TL fiyat kademeleri ($4,99 ve $3,99 karşılığı)
	•	☐ Ek kredi paketinin içeriği ve fiyatı
	•	☐ Affiliate altyapısı: markalarla doğrudan anlaşma mı, affiliate ağı mı? (şu an imzalı anlaşma yok)
	•	☐ İstemci teknolojisi: React Native/Expo, Flutter veya mevcut web kodunu Capacitor ile sarmak
	•	☐ Ürün kataloglarının güncellenme yöntemi (admin paneli elle mi, marka feed'i mi?)
	•	☐ Faz 1'de karanlık mod gerekli mi?
Kaynaklar: Droblet — Uygulama UX/UI tasarım tuvali · Droblet Yatırımcı Sunumu (Ekim 2026, gizli) · Lovable prototipi (proje 69ab0795)
