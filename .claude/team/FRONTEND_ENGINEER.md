# Frontend Engineer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
Web tarafındaki işlerden sen sorumlusun. Mobil öncelikli bir üründe tipik parçalar:

Alan adı: **`droplet.alatech.co`** — **Açık karar (A-10)**; tahmin edilip yazılmaz.

1. **Landing** (`landing/`) — ürünü anlatan, App Store / Google Play'e yönlendiren site (çok dilliyse `/` varsayılan dil + `/{locale}` + hreflang; dil seçici; CSS animasyon, `prefers-reduced-motion`'da kapalı).
2. **Deep link karşılama sayfaları** (proje gerektirirse) — paylaşılan bir link, uygulama yüklü olmayan birinin telefonunda açıldığında görünen sayfa.
3. **Web hesap silme** (`/delete-account`) — Google Play kuralı: hesap uygulama açılmadan da silinebilmeli.
4. **Yasal sayfalar** — Privacy Policy, Terms of Use, abonelik koşulları, KVKK aydınlatma ve açık rıza, Cookie Notice. Hukuk kontrolünden geçmeden yayınlanmaz.

**Droblet'te web'in kapsamı** (E12 Lansman). Ürünün kendisi mobil uygulamadır; **web dashboard yok** — web'de gardırop, look ya da hesap yönetimi yapılmaz.

| Sayfa | Yol (öneri) | Not |
|---|---|---|
| Landing | `/`, `/en` | Vaat ve paywall sloganı tasarımdan: "Sabah 'ne giysem' derdi ve saatler süren bavul hazırlığı bitti. Dolabın artık senin için düşünüyor." / "Her sabah hazır bir kombin. Her seyahatte hazır bir bavul." Mağaza butonları |
| Kullanım Koşulları | `/terms` | Hoş geldin (01) ve paywall'dan (05) linklenir |
| Gizlilik Politikası | `/privacy` | 01 ve 05'ten linklenir; fotoğraf/try-on gizlilik vaatleri burada da aynı cümlelerle |
| Abonelik koşulları | `/subscription-terms` | Droblet Üyelik — fiyat ve deneme **Açık karar (A-1)** |
| KVKK aydınlatma (ve açık rıza) | `/kvkk` | Boy/yüz fotoğrafı ve renk paleti analizi kapsamı hukukla netleşir |
| Çerez bildirimi | `/cookies` | |
| Web hesap silme | `/delete-account` | Aşağıda |
| Davet linki karşılama | `/invite/{code}` | Arkadaş daveti (27 "davet linkini paylaş"); aşağıda |
| Paylaşılan look / profil | — | **Açık karar (A-6)** — karar gelmeden yapılmaz |

- **Tasarım dosyaları:** web sayfaları için pano **yok**; tasarım yalnız mobil (`.claude/_handoff/droblet-handoff/`, canlı tasarım https://claude.ai/artifact/UUAJnqCfrvDkh3yPPvnqw1). Web sayfaları mobil tasarım sisteminin token'larıyla çizilir ve UX onayından geçer ([UX_DESIGNER.md](UX_DESIGNER.md) eksikler tablosu).
- **Diller:** TR (varsayılan) + EN.
- **Yasal metinlerin kaynağı: Açık karar** (listede yok — PM / ürün sahibi + hukuk). Metin gelene kadar sayfalar yayınlanmaz; tek kaynak `docs/legal/*.md` kuralı geçerli.

`client/` (React dashboard) yığını ekip standardı olarak aşağıda korunur; projede dashboard yoksa kullanılmaz.

---

## Tech Stack

### Marketing site + deep link + hesap silme (`landing/`)
| Layer | Technology |
|---|---|
| Framework | Next.js 15, App Router |
| Language | TypeScript |
| Styling | Tailwind CSS v4 (`@theme` tokens in `src/app/globals.css`) |
| Content | `content/{locale}/*.json` for copy |
| Output | `output: "export"` — static files in `out/`, served from an S3 website bucket behind Cloudflare |

Bu sitenin iki alışılmadık kuralı:

- **Metin `content/`'te durur, bileşende değil.** Bir bölüm `home.json`'daki kelimeleri bileşene de yazarsa build geçer, sayfa düzgün görünür, ve içerik dosyasını düzenlemek hiçbir şeyi değiştirmez. `npm run check` buna build'i düşürür.
- **İstek anında hiçbir şey çalışmaz.** Sunucuda `searchParams` yok, route handler yok, varsayılan loader'lı `next/image` yok. Sorgu dizgisi istemcide okunur ya da hiç okunmaz.

Tasarım sistemi (renk, tipografi) mobil uygulamayla aynı token'lardan gelir; `@theme` içinde tanımlanır.

### Client App (`client/`) — ekip standardı (dashboard gerekirse)
| Layer | Technology |
|---|---|
| Framework | React 18 |
| Language | TypeScript (strict) |
| Build | Vite |
| UI Library | Chakra UI |
| Animation | Framer Motion |
| Routing | React Router |
| Styling | Emotion (via Chakra) |
| HTTP Client | Fetch API / Axios |

---

## Project Structure

```
landing/
├── src/
│   ├── app/
│   │   ├── page.tsx                # / — Landing (varsayılan dil)
│   │   ├── {link}/page.tsx         # deep link karşılama — tek statik kabuk, parametre istemcide yoldan okunur
│   │   ├── delete-account/page.tsx # web hesap silme — OTP girişi istemcide, API'yi tarayıcıdan çağırır
│   │   ├── privacy/page.tsx        # ┐
│   │   ├── terms/page.tsx          # │ docs/legal/*.md'den build'de (tek kaynak)
│   │   ├── subscription-terms/page.tsx
│   │   ├── kvkk/page.tsx           # │
│   │   └── cookies/page.tsx        # ┘
│   ├── components/
│   ├── lib/                        # site config, API preview fetch, platform detection
│   ├── content.behaviour.mjs       # copy is read from content/, not hardcoded
│   └── export.behaviour.mjs        # every link printed is a file a bucket can serve
├── content/
│   ├── en/
│   └── tr/
├── public/
│   └── .well-known/
│       ├── apple-app-site-association
│       └── assetlinks.json
├── next.config.mjs
└── package.json
```

---

## Deep link karşılama sayfası (proje gerektirirse)

`/{link}/{param}` statik export'ta dinamik bir rota olamaz. Bu yüzden:

- Sayfa **tek bir statik kabuk** olarak üretilir (`/{link}/index.html`); parametre istemcide `window.location.pathname`'den okunur. `/{link}/*` → `/{link}/index.html` yönlendirmesini Cloudflare URL Rewrite kuralı yapar (DEVOPS_ENGINEER.md §Alan adı); S3 website hosting bunu kendi başına yapamaz.
- Sayfa gerekiyorsa anonim bir API ucundan yalnız gösterilecek minimum bilgiyi çeker. Başka hiçbir kişisel veri dönmez ve gösterilmez.
- **Tek buton, platforma göre:** iPhone'da App Store, Android'de Google Play. Masaüstünde ikisi birden. Android linki `referrer` parametresiyle veriyi Play Install Referrer'a taşıyabilir.
- Mağaza kurulumundan veri taşınamazsa kullanıcının uygulamada elle girebileceği değer (kod vb.) kopyalanabilir gösterilir.
- Geçersiz ya da süresi dolmuş parametrede sayfa yine mağaza butonunu gösterir ama vaatte bulunmaz.
- **Dil:** tarayıcı diline göre `content/{locale}/`.
- **Uygulama yüklüyse bu sayfa hiç görünmemeli** — universal link / app link uygulamayı açar. Bu, `.well-known` dosyalarının doğru content-type ile sunulmasına bağlı (bkz. DEVOPS_ENGINEER.md).
- Resmi App Store / Google Play rozetleri markaların kitlerinden alınır; tasarımdaki yer tutucular kullanılmaz.

Droblet'te link türleri:

| Link | Yol | API ucu | Gösterilen |
|---|---|---|---|
| Arkadaş daveti | `/invite/{code}` | Anonim davet önizleme ucu (şekli E9 sözleşmesinde; ör. `GET v1/public/invites/{code}`) | Yalnız davet edenin görünen adı ve kullanıcı adı (ör. "Selin seni Droblet'e davet ediyor") + mağaza butonu. Dolap, look, fotoğraf, takipçi sayısı gösterilmez |
| Paylaşılan look / profil | `/l/{id}`, `/u/{handle}` | — | **Açık karar (A-6)** |

- Uygulama yüklü değilse: kurulum sonrası Android'de `referrer` ile davet kodu taşınır; iOS'ta kod kopyalanabilir gösterilir ve uygulamada elle girilebilir (deferred deep link servisi ayrı karar).
- Geçersiz / süresi dolmuş kod: mağaza butonu kalır, "davet" vaadi yapılmaz.
- Kullanıcının boy/yüz fotoğrafı ve try-on görselleri **hiçbir web sayfasında** gösterilmez (gizlilik vaadi).

## Web hesap silme

- Google Play, uygulamayı yüklemeden hesap silme yolu ister. Sayfa: e-posta ya da telefon → OTP (`v1/auth/otp/start`, `verify`) → onay ("DELETE" yaz, uygulamadaki gibi) → `DELETE v1/auth/me`.
- Apple/Google ile giriş yapmış kullanıcı için yol: e-posta adresi biliniyorsa OTP; bilinmiyorsa (Apple "e-postamı gizle") sayfa uygulamadan silmeyi anlatır.
- Aktif abonelik silmeyle iptal olmaz — sayfa bunu uygulamadaki gibi söyler ve mağaza abonelik sayfalarına linkler.
- Token sayfada yalnız bellekte tutulur; `localStorage`'a yazılmaz.

---

## Environment Variables

```env
NEXT_PUBLIC_API_BASE_URL=https://your-api-gateway-url
NEXT_PUBLIC_APP_STORE_URL=...
NEXT_PUBLIC_PLAY_STORE_URL=...
```

**Kurallar**:
- API URL'i bileşende sabit yazılmaz
- `.env.local` commit edilmez

---

## Development Workflow

```bash
cd landing
npm install
npm run dev
npm run build      # Static export to landing/out/
npm run check      # Build'den sonra koş — out/'u okur
```

### Deployment
- `main`'e merge'de GitHub Actions `deploy-landing.yml` ile S3'e
- Ortam değişkenleri build anında GitHub Secrets'tan

---

## Coding Rules

1. **`any` yok**
2. **Satır içi stil yok** — Tailwind token'ları
3. **Sabit API URL'i yok**
4. **Metin `content/`'te** — bileşende kopya yok
5. **Tüm durumlar işlenir** — deep link sayfasında yükleniyor / geçersiz parametre / hata; hesap silmede yanlış kod / süresi dolmuş kod / hata
6. **Yalnız fonksiyonel bileşenler**
7. **Kodda sır yok**
8. **Dil:** her sayfanın metni `content/{locale}/` altında
9. **Büyük harf CSS ile yapılmaz** — `uppercase` sınıfı ya da `text-transform` yok; büyük harf gereken metin kaynakta büyük harfle yazılır
10. **Renk ve font tasarım token'larından** (`design/tokens.json`)

Droblet:
- **Diller:** tüm sayfalar TR (varsayılan, `/`) + EN (`/en`). Yasal sayfaların EN sürümü hukuk metni geldiğinde; KVKK aydınlatma TR asıldır.
- **Fontlar:** Cormorant Garamond (başlıklar — display 500 36/38, başlık-2 500 26, başlık-3 600 20) + Jost (gövde 400 14/21, üst etiket 500 11, harf aralığı %14). Google Fonts'tan değil `next/font` ile self-host (statik export'ta çalışır).
- **Renk token'ları** (`@theme`): Mürekkep `#1C1A17` · Krem zemin `#F4F1EC` · Kâğıt `#FBF9F5` · Espresso vurgu `#6E5640` · İkincil metin `#665F56` · Çizgi `#DCD4C9` · Kum `#E8E1D7` · Uyarı `#9A3B2E`. Dark palet **Açık karar (A-9)**.
- **Üst etiket:** Tailwind'de `uppercase` sınıfı **kullanılmaz** (kural 9); etiket `content/{locale}/*.json`'a istenen harfle yazılır, stil yalnız font/boyut/`tracking` verir.

---

## Checklist Before Raising a PR
- [ ] `npx tsc --noEmit` sıfır hata
- [ ] `npm run build` ve `npm run check` geçiyor
- [ ] Deep link sayfası: geçerli parametre, geçersiz parametre, API hatası; iPhone, Android ve masaüstü
- [ ] Hesap silme: OTP başarılı/yanlış/süresi dolmuş, API hatası
- [ ] `.well-known` dosyaları `out/`'ta
- [ ] Sabit API URL'i ya da kimlik bilgisi yok
- [ ] Mobil viewport'ta test edildi (paylaşılan linkler çoğunlukla telefonda açılır)
- [ ] Üretim kodunda `console.log` yok
- [ ] PR açıklaması neyin neden değiştiğini anlatıyor
