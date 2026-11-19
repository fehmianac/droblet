# Design parity — canvas v2 ↔ mobile app

Source of truth: the owner's live canvas (`Droblet — Uygulama UX/UI v2`, https://claude.ai/artifact/PJtvF68fe3N9XvEP8D4pgo).
Checked on 2026-11-18 against the repo copy in `.claude/_handoff/droblet-handoff/canvas-v2/`: **all 64 board files and
`canvas.json` are byte-identical** (no board changed, added or removed).

Status values: **matches** · **fixed now** (differences found and corrected in this pass) · **missing built now** (a screen,
flow or control that did not exist) · **intentionally different** (reason given).
"Sim" = looked at on the iOS simulator (iPhone 17, Release build) next to the board: see the last section.

## 0 · Logo and design system

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Logo` — Logo · 3 yön (A recommended) | `src/components/brand/logoPaths.ts`, `Logo.tsx` | fixed now | Paths and colours were already the canvas ones. The mark now uses the box every canvas screen draws (`viewBox 8 4 36 42`), so its proportions, the hook stroke per size (2.2 / 2.6 / base-only 3.4) and the drop's base match the boards. See "Open question: the drop's base". | yes |
| `LogoIkon` — uygulama ikonu | `scripts/render-brand-assets.mjs`, `assets/brand/*.svg`, `assets/images/*.png`, `assets/expo.icon` | fixed now | Icon mark was 62 % of the tile in a 36:50 box → the board's 116/180 box; Android adaptive foreground and monochrome at the board's 66/120 of the visible circle; favicon = the 29 px variant (hook dropped, base 3.4); all PNGs regenerated. Default: cream drop on ink. | no |
| `LogoKullanim` — kullanım | `Logo.tsx` (`header`, `hero`, `stacked`), `logoClearSpace`, `MIN_MARK_WIDTH`, `MIN_LOCKUP_WIDTH` | fixed now | Horizontal and stacked lock-ups added; clear space (half the drop width) and minimum sizes (96 / 16) are exported rules and unit-tested; ink on cream, cream on ink only; never stretched or rotated. | — |
| `TasarimSistemi` — Tasarım sistemi | `src/theme/tokens.ts`, `src/components/ui/*`, `src/components/navigation/TabBar.tsx` | fixed now | Colour tokens matched. Fixed: h1 tracking −1 %; chip 13 regular on a transparent ground; badge 22 high / 11 medium; image tag (9.5, radius 6) and "EKSİK PARÇA" marker; count dot 18; field 48 with 12-medium label; primary 52 / secondary 44 / bar 48 buttons, danger button; icon button without fill, filled "+" variant; centred 15-medium header title; bottom bar total 12 over 17 medium; sheet grabber 40 × 5 and scrim 42 %; ⋯ menu radius 16; product row thumb 56 × 68 radius 10; "SENİN ÜZERİNDE" drawn as the image tag bottom-left. **Tab bar:** 86 high, 64-wide tabs with house / hanger / compass / user glyphs, active label semibold, Stilist = 56 ink circle raised 18 with shadow and **no label under it** (the canvas draws none). | yes |
| Tab bar visibility (all boards) | `TabBar`, `ListTabBar` | fixed now | The bottom menu now also stays on 07, 09, 21, 24b, 25 and 27 as on the canvas; detail / create / checkout screens use the bottom action bar. | yes |

## 1 · Giriş ve onboarding

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Splash` — 00 Splash | `src/components/brand/AnimatedSplash.tsx` | intentionally different | Timeline, sizes and copy match (2.6 s, 92-wide mark, 54 wordmark, 40 × 1.5 rule, tagline). "Devam et" / "Tekrar oynat" are canvas prototype controls (note `n_splash`: the animation continues by itself), so they are not built. | no |
| `SplashKareler` — 00b kareler | `SPLASH_TIMELINE` | matches | Four frames and the reduce-motion final frame agree. | — |
| `Main` — 01 Hoş geldin | `src/app/(onboarding)/welcome.tsx` | fixed now | Was a padded 2 × 2 grid with captions and a centred text wordmark → full-bleed collage with silhouettes, cream fade, eyebrow, horizontal logo lock-up, 17 pt promise, two 52-high buttons, 11 pt legal line. | yes |
| `Kayit` — 02 Kayıt / giriş | `src/app/(auth)/start.tsx` | fixed now | Eyebrow removed; ink segmented switch; inset 24; "VEYA E-POSTA" divider; submit "Devam et" / "Giriş yap"; right-aligned "Şifremi unuttum"; canvas error copy. Apple and Google keep their brand-rule buttons (see below). | yes |
| 02 — Apple / Google buttons | `AppleButton`, `GoogleButton` | intentionally different | The board draws both as paper pills; Apple's and Google's sign-in guidelines require their own button styles (native Apple button, Google white / Roboto). | yes |
| `SifreUnuttum` — 02b | `src/app/(auth)/forgot-password.tsx` | fixed now | Canvas eyebrow / title / body, sand info note, bottom actions "Bağlantı gönder" + "Girişe dön". | yes |
| `SifreGonderildi` — 02c | `forgot-password.tsx` (sent state) | missing built now | Mail circle, body with the address, junk-folder hint, "E-posta uygulamasını aç", "Tekrar gönder · 0:42" countdown. | no |
| `YeniSifre` — 02d | `src/app/(auth)/reset-password.tsx` | fixed now | Close on the right, repeat field with mismatch error, bottom "Şifreyi kaydet ve giriş yap". | yes |
| `OnbStil` — 03 Stil profili | `src/app/(onboarding)/style.tsx`, `components/auth/StepHeader.tsx` | fixed now | "1 / 3" + progress line; three 92-high segment cards with "Yakında" on Erkek / Genç; eyebrow section labels; tags lock at three with the canvas sentence; plain 52 button. | yes |
| `OnbFoto` — 04 Beden ve fotoğraf | `src/app/(onboarding)/body.tsx` | fixed now | "2 / 3" + "Atla"; Boy / Kilo / Beden in one row with a size sheet; 4-slot photo grid; inline "Kamera izni kapalı" card; lock-icon privacy note. | yes |
| `IlkParcalar` — 04b İlk 5 parça | `src/app/(onboarding)/first-items.tsx` | fixed now | "3 / 3"; "Kendi parçanı çek" card; 3 × 3 tiles with garment glyphs; "Tüm hazır kütüphaneyi gör"; bar "N / 5 seçildi" with a 48 "Devam et" that is no longer blocked below five (the board has no "Atla"). | yes |
| `Paywall` — 05 Üyelik | `src/app/paywall.tsx` | fixed now | Three look tiles fading into cream, floating close, 32 pt promise, benefit rows with 36 circles, plan cards with badge and 2 pt ring, fixed footer with fine print and restore / terms / privacy. Prices and trial length come only from the store (`n_price`). | yes |
| `EkKredi` — 05b Ek kredi paketi | `src/features/credits/CreditPackSheet.tsx` | fixed now | Close, accent eyebrow, pack card with 2 pt ring, text "Şimdilik değil". | no |
| no board, derived — Üyelik yönetimi | `src/app/subscription.tsx` | missing built now | Replaces the placeholder: plan card, ink credit card with "Kredi yükle" → 05b, "Aboneliği mağazada yönet" (App Store / Play subscriptions), "Satın alımları geri yükle", free-tier teaser → 05; five states. | yes |

## 2 · Bugün

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Home` — 06 Bugün | `src/app/(tabs)/index.tsx`, `features/today/*` | fixed now | Week strip as 58-high paper cells; outfit card with the image flush left, "SENİN ÜZERİNDE" tag, three thumbnails with the missing one dashed + "EKSİK PARÇA"; "BUGÜNÜN KOMBİNİ · OFİS" eyebrow; "Look'u tamamla" accent link; 44 "Bunu giyiyorum"; edit strip as 140 × 190 tiles with tags. | yes |
| 06 — "Look'u tamamla" target | same | intentionally different | Opens the kombin oluşturucu for the look instead of a single product page: the missing piece is not always a catalogue product. | — |
| `BugunPlanYok` — 06 plan yok | `src/app/(tabs)/index.tsx` | fixed now | Greeting stands alone; dashed card with 72 sand circle and calendar icon; "Stilistten öneri al". The weekly-edit strip stays when the server sends one (global content). | no |
| `Hafta` — 07 Haftalık plan | `src/app/plan/week.tsx`, `features/today/WeekDayRow.tsx` | fixed now | **Label vs rows:** the board's rows are Monday-first, so the rows stay Mon–Sun and the label became "BU HAFTA · 16–22 KASIM" (the old "ÖNÜMÜZDEKİ 7 GÜN" contradicted the rows). Occasion chips, 44 buttons, ⋯ menu with refresh icon, planned and empty rows as drawn; bottom menu. | yes |
| `KrediOnay` — 07b Kredi onayı | `src/features/credits/CreditConfirmSheet.tsx` | fixed now | Balance rows 14 / 14 medium with "−N" in accent, text "Vazgeç". | no |
| `Edit` — 08 Haftanın edit'i | `src/app/edit/[id].tsx`, `features/today/EditProductRow.tsx` | fixed now | **Header actions are overlaid on the image** (paper-92 % buttons, pinned); full-bleed 350 image with tag and dots on it; sand price-band track; owned-pieces line with "Göster / Gizle"; rows with price under the name; "İzleme listeme ekle" (bookmark) separate from the heart; bar total + "Look'u tamamla". "Sponsorlu" support: `WeeklyEdit.sponsoredBy` → tag on the image + line. | yes |
| `EditFotoYok` — 08 fotoğraf yok | `src/app/edit/[id].tsx` | fixed now | Plain header, 280 sand card with camera circle, "Fotoğraf ekle". Kept beyond the board: small dots (to reach the other looks) and the watch-list buttons. | no |
| `Takvim` — 09 Takvim | `src/app/calendar.tsx` | fixed now | Day cells with number above a 52 box and look thumbnail; summary card; **"Rapor" enabled**; day sheet with status badge and "Look'u aç" → look detail; bottom menu. | yes |
| 09 › Rapor (derived from the control) | `src/app/plan/report.tsx`, `buildMonthReport` | missing built now | Monthly report from the wear log: days logged, pieces and looks worn, most worn pieces, occasions, pieces not worn; five states. | yes |

## 3 · Gardırop

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Gardirop` — 10 Gardırop | `src/app/(tabs)/wardrobe/index.tsx`, `features/wardrobe/*` | fixed now | **Selection bar** is the canvas bar ("N parça seçildi" · Look oluştur · Sezon · Sil) and replaces the bottom menu while selecting; "Seç" chip stays outlined ("Bitti"); filled "+"; badges row (applied filter filled, "Tüm sezonlar / Tüm renkler" outlined, sort + long-press hint right); 128-high tiles; filter sheet with underlined "Temizle" and 44 colour buttons; **list states through the shared `ScreenState`**. Kept beyond the board: a count dot on the filter button, and filtering / multi-select of cached data while offline. | yes |
| `Parca` — 11 Parça detayı | `src/app/item/[id].tsx` | fixed now | "Used in looks" tiles 104 × 132 with the occasion tag only. Hero buttons, ⋯ menu, fact cards, the dashed "Sat · Kiraya ver · Yakında" row and the bar already matched. | yes |
| `Ekle` — 12 Parça ekle (kamera) | `src/app/item/add.tsx`, `features/photos/cameraState.ts` | missing built now | **In-app live camera** (`expo-camera`) with the four frame corners and in-app shutter; gallery / hazır kütüphane / toplu shortcuts; **detection pill** ("Gömlek algılandı · Beyaz · Pamuk") then 12c. Permission not asked / denied (explained, "Ayarlar'a git", other paths still work) / no camera (falls back to the system picker); no shutter animation with reduced motion. | yes |
| 12 — "Elle gir" | same | intentionally different | Not on the board; manual entry stays always available (owner decision with the free recognition quota). | yes |
| 12 → 12c photo carry-over (derived) | `add.tsx`, `form.tsx`, `ItemForm.tsx`, `mutations.ts`, `bulk.tsx` | missing built now | A photo taken before an `item_recognition_limit_reached` 402 (or with the quota already used up) is kept and carried into the manual-entry form, tagged "ORİJİNAL", and saved with the piece. | — |
| `Kutuphane` — 12b Hazır ürün kütüphanesi | `src/app/item/library.tsx` | fixed now | One 48 search field; 96-high tiles with plus / check dot; bar with count over "Renk ve bedeni sonra düzenle" and 48 "Gardıroba ekle". | yes |
| `ParcaBilgi` — 12c Parça bilgileri | `src/app/item/form.tsx`, `features/wardrobe/ItemForm.tsx` | fixed now | 132 × 164 picture with tag; "Orijinale dön" chip; canvas field grid with 12 labels / 48 fields; warm "Kategoriyi kontrol et" badge. | yes |
| `TopluEkle` — 13 Toplu ekle | `src/app/item/bulk.tsx` | fixed now | Two-segment sand track; rows radius 16 with 52 × 62 thumb and 22 check box; warm badge; progress card. Kept beyond the board: remove (✕) on a row, "Fotoğraf ekle", "Arka planda devam et" (drafts count against the 30 limit). | yes |
| `Looklar` — 14 Looklar | `src/app/(tabs)/wardrobe/looks.tsx`, `features/looks/LookCover.tsx` | fixed now | Filled "+"; 210-high cards with tag, 32 heart, outline rating star; card opens the look detail (was the editor). | yes |
| `LookYeni` — 15 Look oluştur | `src/app/look/new.tsx`, `features/looks/LookEditor.tsx`, `SlotSheet.tsx` | fixed now | Preview left with "ÖNİZLEME", name / occasion / "Üzerimde gör" right; slot cards and dashed empty slots; slot sheet as a three-column grid; bar hint + 48 "Kaydet". All seven occasions are kept (the board shows three as a sample). | yes |
| no board, derived — Look detayı (14 → look) | `src/app/look/[id].tsx` | missing built now | Was a redirect stub. Cover with tag and piece tiles ("EKSİK PARÇA" on store pieces), rating, piece rows (→ piece / product), bar: favourite · "Üzerimde gör" (credit confirm → shared try-on job) · edit; ⋯ wear today / edit / delete; share; five states. | yes |

## 4 · Stilist ve bavul

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Stilist` — 16 Stilist | `src/app/(tabs)/stylist.tsx` | fixed now | Grid icon for past suggestions; prompt pill with ink sparkle send; ORTAM chips in three equal columns; 30-high weather / season / date badges; "Sadece gardırobum" outlined with hanger; shortcut cards. | yes |
| `DanismanSonuc` — 17 Kombin önerisi | `src/app/stylist/[jobId].tsx`, `features/stylist/SuggestionResult.tsx` | missing built now | **Horizontal swipe between the three suggestions** (dots follow, also operable by tap and screen-reader actions, no animation with reduced motion) and the **share action**; media 200:140 with "SENİN ÜZERİNDE"; missing piece dashed + "EKSİK PARÇA"; rows with "Look'u tamamla" → product; bar ✕ / heart / "Takvime ekle". | yes |
| `KrediBitti` — 17b Kredi bitti | `features/stylist/SuggestionMedia.tsx`, credit sheets | fixed now | Piece collage in a paper card (150 / 110 tiles), "Parça kolajı" badge, notice card with 48 "Kredi yükle" → 05b. Note and piece rows stay below so "Look'u tamamla" remains reachable. | no |
| `GorselUretiliyor` — 17c | `SuggestionMedia.tsx` | fixed now | Bell info box; failure / 60 s timeout shown inside the image slot with "Tekrar dene". Text first (perf/ai-latency): the "Görselsiz devam et" gate is gone — only the image slot shows the generating state, pieces and actions stay usable. | no |
| `Bavul` — 18 Bavullar | `src/app/(tabs)/wardrobe/trips.tsx`, `features/trips/TripForm.tsx` | fixed now | City field with pin and two-line suggestions, 48 date fields, sparkle on "Bavulu oluştur", trip rows with toned thumb. The list states stay inline under the form so the form remains usable in every state. | yes |
| `BavulDetay` — 19 Bavul detayı | `src/app/trip/[id].tsx` | fixed now | **Share action** (packing list text); forecast cards across the row; "Tek kabin bavulu" check box; missing piece card; 64 × 72 day thumbs with weekday tag; flat checklist; bar "1 eksik parça" + "Eksikleri tamamla". | yes |
| no board, derived — Yeni bavul | `src/app/trip/new.tsx` | fixed now | Same form card as 18 under a modal header. | — |

## 5 · Keşfet ve mağaza

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Kesfet` — 20 Keşfet | `src/app/(tabs)/discover.tsx`, `features/store/CreatorCardView.tsx` | fixed now | **Logo header** with search and cart (count dot); 290-high edit cover with title on an ink fade; "Tümü" → friend feed; creator cards 132 wide; **"SPONSORLU"** image tag top-left driven by `CreatorCard.sponsored`; neutral people placeholders; bottom menu. | yes |
| `Magaza` — 21 Stil mağazası | `src/app/shop/index.tsx`, `features/store/{FilterSheet,filters}` | fixed now | **One combined "Filtrele" sheet** ("Temizle", chip groups, "Sonuçları göster") instead of four; 48 pill search; entry cards; chevron filter chips; 180-high product cards with 32 heart; "Parçamı tamamla" sheet; bottom menu. The sheet also carries a RENK group (the Renk chip and the palette deep link need it). | yes |
| `Urun` — 22 Ürün + üzerimde | `src/app/shop/product/[id].tsx` | fixed now | **Try-on on the shared job flow** (credit confirm → `useStartTryOn` → `useTryOnJob`, AI stage / progress lines / failure with refund + retry); the separate polling contract is removed. Image to the top edge with actions on it; split "Üzerimde" view with "SENİN ÜZERİNDE"; paper switch; size chips; match card; **"İzleme listeme ekle"** row; bar "+ Gardıroba ekle" / "Sepete ekle". | yes |
| `KombinOlusturucu` — 23 Kombin oluşturucu | `src/app/shop/builder.tsx` | fixed now | 140 × 300 preview with "ÖNİZLEME"; slot cards with selected outline; suggestion tiles; 48 bar buttons; "Lookbook'a kaydet" opens the lookbook. A small clear (✕) stays on a filled slot (no other way to empty one). | yes |
| `Sepet` — 24 Sepet | `src/app/cart.tsx` | fixed now | 44 pay button with external-link icon; bar with count over an 18-medium total; info box. Brand grouping and checkout on the brand's site already matched. | yes |
| `SepetBos` — 24 Sepet · boş | `cart.tsx` (`EmptyCart`) | fixed now | 96 sand circle with bag, serif title, sentence, full-width "Ürünleri keşfet". | no |
| `IzlemeListem` — 24b İzleme listem | `src/app/watchlist.tsx` | fixed now | 22-high accent "Fiyat %20 düştü" badge; bell as a borderless switch; 64 × 78 thumbs with struck-through old price; action row only where there is one; bottom menu. Action buttons are 44 high (board 40) for the touch minimum. | yes |

## 6 · Sosyal

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Akis` — 25 Arkadaş akışı | `src/app/friends/feed.tsx`, `features/social/ShareSheet.tsx` | fixed now | **Share sheet: WhatsApp / Pinterest / "Link kopyala"** (clipboard + "Link kopyalandı." pill; calm message when an app cannot be opened); story ring sizes; post card (36 avatar, outlined follow chip, 290 image, 44 stars, borderless save / share, "Parçaları gör" link); bottom menu. The board draws no comments or likes. | yes |
| `Kisi` — 26 Kişi profili | `src/app/u/[handle].tsx` | fixed now | ⋯ popover (copy profile link, şikayet et, engelle); 84 avatar; centred counters; 3-column 170-high grid. | yes |
| `KisiGizli` — 26 gizli dolap | `u/[handle].tsx` (`HiddenCloset`) | fixed now | Dashed frame with 64 sand circle and lock, counters "—", single "Takip et". | yes |
| `Sikayet` — 26b Şikayet et / engelle | `features/social/ReportSheet.tsx` | fixed now | Close ✕, plain radio list, danger-outlined "Engelle"; sending closes the sheet and confirms on the profile; blocking returns to the feed. | no |
| `Arkadaslar` — 27 Dolapları keşfet | `src/app/friends/find.tsx` | fixed now | 48 pill search, contacts card with two 44 buttons, "Örnek" badge, influencer cards, outlined follow chips; bottom menu. | yes |
| 27 — "Rehbere izin ver" | same | intentionally different | Drawn as on the board, but it asks for no permission yet and says the feature is coming: contacts matching is an open product decision (A-8) and needs a contacts module. | — |

## 7 · Profil

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Profil` — 28 Profil | `src/app/(tabs)/profile.tsx`, `features/account/rows.tsx` | fixed now | **Logo header**; 64 photo; **"Profili düzenle" → `/edit-profile`**; ink credit card with **photo status**, **credit counter** and "Kredi yükle"; **menu as drawn** (seven rows, canvas icons, "1 fiyat düştü" / "Yakında" badges, targets). The board has no "Bildirimler" row; the centre opens from the bell on 06. | yes |
| no board, derived — Profili düzenle | `src/app/edit-profile.tsx` | missing built now | Photo, name, handle with validation; save. | yes |
| `Ayarlar` — 29 Gizlilik ve ayarlar | `src/app/settings.tsx` | fixed now | Row cards; 52 × 66 photo thumbs with "BOY" / "YÜZ" tags; **notification check boxes** as drawn; language track; plain "Çıkış yap" / danger "Hesabımı sil". | yes |
| 29 — reminder time | same | intentionally different | The board draws only the three check boxes. The time row stays under "Sabah kombin hatırlatması" while it is on, because the reminder needs a local time; it is a stored preference (no local scheduling module). | yes |
| `SilmeOnay` — 29b | `DeletePhotosDialog` in `settings.tsx` | fixed now | The drawn alert: danger circle, bullet lines from real data, "Bu işlem geri alınamaz.", danger button over "Vazgeç". | no |
| `HesapSil` — 29c | `src/app/delete-account.tsx` | fixed now | 24 gutters, inset rows with canvas glyphs, danger button + text "Vazgeç". | yes |
| `RenkPaleti` — 30 Renk paleti | `src/app/palette.tsx` | fixed now | Face photo tile, 4-column swatch blocks, four avoid bars, match card with hanger. "Uyumsuz parçaları gör" opens the list of mismatching pieces (more specific than the board's link to Gardırop). | yes |
| `PaletBos` — 30 yüz fotoğrafı yok | `src/app/palette.tsx` | fixed now | Dashed face oval with camera, full-width upload that now works in place, privacy note. | no |
| no board, derived — Bildirimler | `src/app/notifications.tsx`, `features/notifications/*` | missing built now | Replaces the placeholder: day groups, unread dot, "Tümünü okundu say", rows open their subject, link to 29; five states. Runs on a provisional contract + fixtures. | yes |

## Durumlar ve boş haller

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `DurumYukleniyor` — Gardırop yükleniyor | `components/ui/Skeleton.tsx` (`SkeletonGrid`), `ScreenState.tsx` | fixed now | Skeleton grid shaped like the content (3 × 3 tiles, caption lines), chip and count skeletons; named and marked busy for screen readers. | no |
| `DurumBos` — Gardırop boş | `StateMessage.tsx`, `ScreenState.tsx` | fixed now | 96 sand circle with the hanger, serif headline, one sentence, full-width primary action + outlined "Hazır kütüphaneden seç". | no |
| `DurumHata` — Gardırop hata | `ScreenState.tsx`, `StateMessage.tsx` | fixed now | Alert layout with icon circle, headline, sentence and full-width "Tekrar dene". | no |
| `DurumCevrimdisi` — Gardırop çevrimdışı | `OfflineBanner.tsx`, `ScreenState.tsx` | fixed now | Ink 36-high band with wifi-off icon and centred cream text over the cached list; "Son güncelleme"; "+" disabled. | no |
| (pattern, note `n_durum`) all list screens | `ScreenState` | fixed now | Every list screen draws its loading / empty / error / offline states with these shared components. | — |
| `BugunPlanYok`, `EditFotoYok`, `SepetBos`, `KisiGizli`, `PaletBos` | see sections 2, 5, 6, 7 | — | Listed with their screens above. | — |

## 8 · Web landing

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `Landing`, `LandingMobil` | — | intentionally different | Web pages, outside the mobile app (not part of `mobile/`). | — |

## 9 · AI yükleniyor

| Board | Route / component | Status | Notes | Sim |
|---|---|---|---|---|
| `AiYukleniyor` — üzerimde gör | `src/app/tryon/[jobId].tsx`, `components/ui/ai/AiStage.tsx` | fixed now | Image tag at 16 / 16, four different garment glyphs at the board's positions, figure 20 below centre, capsule credit line; failure / timeout keeps the stage and shows the message + "Tekrar dene" in its text area. | no |
| `AiYukleniyorStilist` — kombin önerisi | waiting state of `stylist/[jobId].tsx`, `AiSkeletonCards.tsx` | fixed now | Back chevron "Vazgeç"; cards with the figure and the board's 4.5 s keyframes; weather line from the forecast. | yes |
| `AiYukleniyorVaryantlar` + note `n_aifail` | `components/ui/ai/*`, `features/tryon/api.ts` | fixed now | Try-on and stylist waits stop at 60 s (was 90) and show "Şu an oluşturamadık. Kredin iade edildi." + "Tekrar dene"; busy-button drop without hook; 22-high tag chips. Timings (shimmer 1.8 s, trace 3.2 s, pieces 300 ms apart, lines every 2 s) and reduce-motion states verified. | — |

## Images: no blank boxes

One shared component, `src/components/ui/ImageSlot.tsx` (`PlaceholderImage` delegates to it), is used at every image call site:

| What is missing | What is drawn |
|---|---|
| Garment / product picture (10, 04b, 12b, 21–24b, 08 rows, palette list, slot sheets) | The category's line glyph on a ground tinted from the item's colour, with the item name as accessible label. |
| Look / outfit image (14, look detail, 15 preview, 19, 25, `LookCard`) | A collage of its pieces (canvas "Parça kolajı"); the standing figure on a stable tone when the data has no pieces (06 edit strip, 11, creator cards, 26 grid). |
| "Senin üzerinde" / AI image (06, 08, 17, 22, try-on) | The piece collage with the "Parça kolajı" badge and the right action: add photo → settings, become a member → paywall, top up credits → 05b, or "Üzerimde gör". The "SENİN ÜZERİNDE" tag appears only on a generated image. |
| Person photo (25, 26, 27, 28, edit profile, creator dots) | Initials. |
| A real `imageUrl` | Loads through expo-image with a sand skeleton, fades in, and falls back to the placeholder if loading fails. |

Library items (04b, 12b): `imageUrl` from the API is passed through; when it is null the tile shows the glyph tinted with the item's colour.

## Simulator verification (iPhone 17, iOS 26.5, Release build)

Flows in `mobile/.maestro/`: `signed-out.yaml`, `login.yaml`, `onboard-existing.yaml`, `screens.yaml` (opens every route with
`droplet://…` and takes one screenshot per board), `password-roundtrip.yaml`, `open.yaml`. Credentials are passed with `-e`, never committed.

- **Looked at next to their boards, in Turkish (rows marked "yes"):** 01, 02 (register and sign-in), 02b, 02d, 03, 04, 04b, 05, 06, 07, 08,
  09 + report, 10, 11, 12, 12b, 12c, 13, 14, look detail, 15, 16, stylist wait, 17, 18, 19, 20, 21, 22, 23, 24, 24b, 25, 26, 26 gizli dolap,
  27, 28, edit profile, 29, 29c, 30, notifications, membership.
- **Fixed from what the simulator showed:**
  - Sign-up stored a password the user never typed: with the `newPassword` content type iOS laid its strong-password assistant over the
    field and each typed character replaced the previous one ("Sm0keTest2026" was sent as "6"). Sign-up and reset now use the plain
    `password` type and password fields are not written back from JS. Verified: register in the app → sign in with the same password (200).
  - The system Apple button drew its label far larger than the canvas → both sign-in buttons are the canvas paper pills.
  - 06: without a generated image the card showed the collage, the thumbnail column and a panel on top of each other → the collage takes the
    card width and the action sits on it.
  - 19 (English): the bar button was cut off ("Complete th…") → shorter label.
  - No empty image boxes were left on any visited screen.
- **English run** (same tour, `-e LANG=en -e LOCALE=en_US`): no clipped or overlapping text after the 19 fix. Seen and left: fixture
  content that is Turkish in both languages (weather summary, missing-piece reason, creator roles), and "14 deg" where Turkish shows "14°".
- **Not looked at on the simulator (rows marked "no"), covered by jest screen tests only:** sheets and states that need interaction or
  special data — 02c (after sending), 05b, 07b, 17b, 17c, 26b, 29b, the four Durum boards, 06 plan yok, 08 fotoğraf yok, 24 boş,
  30 yüz fotoğrafı yok, the try-on waiting stage, the home-screen icon — and the live camera preview on 12 (the simulator has no camera;
  the screen and its fallback were seen).
- 12b / 12c / 13 were opened by link on top of the 12 modal, so they appear as sheets in the tour; reached from Gardırop they are full screens.

## Open questions for the owner

1. **The drop's base.** Every app screen and every icon size on the canvas draws the mark in a box that ends above the drop's round base (`viewBox 8 4 36 42`), so the drop has a flat base there; the presentation board `Logo` and the horizontal lock-up on `LogoKullanim` show the whole round drop. The app and the generated icons now reproduce what the screens and `LogoIkon` show. To switch everything to the round drop: set `MARK_BOX_HEIGHT` to 50 in `src/components/brand/logoPaths.ts` and `BOX_H` in `scripts/render-brand-assets.mjs`, then re-run the script.
2. **Sign-in buttons.** They follow the canvas (paper pills). Apple's and Google's brand guidelines are stricter (white / black surfaces); this may come up in store review.
3. **07 label.** "BU HAFTA · 16–22 KASIM" with Monday-first rows (the board's rows); say if "ÖNÜMÜZDEKİ 7 GÜN" with today-first rows is wanted instead.
4. **Provisional contracts** that need backend confirmation: notification centre, edit profile (`PUT v1/tenant/profile`, avatar upload), `photoKey` on item-draft confirm (photo carried into manual entry), try-on target kind `edit-look`, `Entitlement.plan`, optional category / colour fields on cart lines, feed posts and person tiles.

## Design QA pass — 2026-11-19 (canvas version 75)

Walkthrough without AI features (TR + EN, Release build, iPhone 17; flows `smoke.yaml`, `tour.yaml`, `look-manual.yaml`).
Owner rule: every app screen / state has a board. Screens that had none are now drawn in section
**12 · Uygulamada olup tuvalde eksik olanlar**, and the app follows them.

| Board (new) | Route / component | Status |
|---|---|---|
| `OnbRiza` — 03b Açık rızalar (onboarding 2 / 4) | `(onboarding)/consents.tsx` | matches |
| `EpostaDogrula` — 02e | `verify-email.tsx` | matches |
| `YasOnay` — 02f 18+ onayı | `age-confirm.tsx` | matches |
| `BugunEposta` — 06 Bugün · e-posta + profilini tamamla | `(tabs)/index.tsx`, `VerifyEmailBanner`, `ProfileCompleteCard` | fixed now: the card leaves its e-mail row out while the banner shows |
| `Rapor` — 09b Aylık rapor | `plan/report.tsx` | matches |
| `LookDetay` — 14b Look detayı | `look/[id].tsx` | matches |
| `YeniBavul` — 18b Yeni bavul | `trip/new.tsx` | matches |
| `RizaGuncel` — 29g | `consent-review.tsx` | matches |
| `ProfilUcretsiz` — 28 Profil · ücretsiz plan | `(tabs)/profile.tsx` | fixed now: compact membership card |
| `ProfilDuzenle` — 28b, `Uyelik` — 28c, `Bildirimler` — 28d | `edit-profile.tsx`, `subscription.tsx`, `notifications.tsx` | matches |
| `Moderasyon` — 28e Kaldırılan içerik | `content_removed` inbox row, `ModeratedNote` on look / item detail and Profili düzenle | built now |
| `AyarlarDevam` — 29d (whole settings screen), `VerilerimiIndir` — 29e, `Engellenenler` — 29f | `settings.tsx`, `data-export.tsx`, `friends/blocked.tsx` | matches |
| `Takipciler` — 27b, `TakipIstekleri` — 27c, `Kaydedilenler` — 27d, `Rehber` — 27e | `friends/*` | matches |

Existing boards updated to what the app does: 02 Kayıt (18+ box, terms links), 03 / 04 / 04b step counters "x / 4" with
03b in between, 05 "Şimdilik ücretsiz etkinleştir", 12 "Elle gir", 27 "Kullanıcı adını al" row.

App fixed to the canvas: 06 week strip always Monday → Sunday; 05 paywall opened as a page sheet keeps both plans above
the footer; 23 bar label no longer truncated ("Satın al" while no store product is picked); 24b empty state keeps the
screen's name.

Left as is: 03 has no back arrow (the account already exists; the board links back to 02); 07 eyebrow "BU HAFTA" vs the
board's "ÖNÜMÜZDEKİ 7 GÜN" (open question 3 above).
