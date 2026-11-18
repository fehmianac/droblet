# DevOps Engineer Guide — Droblet

> **Öncelik:** Ürün brief'i ([`_handoff/droblet-handoff/BRIEF.md`](../_handoff/droblet-handoff/BRIEF.md)) ve onunla kapanan kararlar ([README §9–10](../_handoff/droblet-handoff/README.md)) bu rehberdeki "Açık karar" maddelerinden üstündür: yalnız kadın segmenti, $4,99/ay, **ayda 30 AI görseli kredisi** (sınırsız değil) + ek kredi paketi, affiliate komisyonu, e-posta + şifre girişi, karanlık mod yok. Teknik yığın değişmedi.

## Role Overview
`template.yaml`'daki altyapı tanımı, CI/CD hatları, deploy otomasyonu, mobil sürüm hattı ve projenin operasyonel sağlığı sende. Tüm AWS kaynakları `template.yaml`'da (SAM/CloudFormation) tanımlıdır — altyapının tek doğruluk kaynağı budur. Konsolda elle kaynak oluşturulmaz.

Ek bir sorumluluğun var: **kullanımla büyüyen dış maliyetlerin görünür olması.** Lambda ve DynamoDB maliyeti kullanımla doğrusal ve küçük; AI çağrısı ve SMS (telefon OTP) gibi ücretli dış servisler öyle değil.

**Droblet'e özel operasyonel riskler ve maliyet kalemleri:**

| Kalem | Neden önemli | Hacim sürücüsü |
|---|---|---|
| **TryOn görsel üretimi** | **En pahalı kalem**; "sınırsız üzerimde gör" vaadi var. Sağlayıcı ve görsel başı maliyet Açık karar (A-3) | Ekranda gösterilen her "senin üzerinde" görseli (Bugün, haftanın edit'i, kombin önerisi, ürün) — otomatik mi dokununca mı üretileceği A-1/A-3 |
| ItemProcessor (görsel işleme + sınıflandırma) | Toplu eklemede tek oturumda onlarca çağrı ("12 fotoğraf işleniyor") | Onboarding'de gardırobun dijitalleştirilmesi — ilk haftalarda zirve |
| Stylist (LLM) | Günlük kombin her aktif kullanıcıda her gün | Aktif kullanıcı × gün |
| Palette | Kullanıcı başına seyrek | Yüz fotoğrafı yüklemeleri |
| S3 depolama + istek | Kullanıcı başına çok sayıda görsel (parça + try-on) birikir | Gardırop boyutu (ör. 86 parça), try-on sayısı |
| Hava sağlayıcısı (A-4) | Ücretli olabilir | Şehir × saat — global önbellekle sabitlenir |
| Katalog kaynağı (A-2) | Feed çekimi / görsel barındırma | Ürün sayısı |
| SES | Giriş e-postaları | Düşük |

Beklenen hacimler henüz bilinmiyor; alarm eşikleri spike ölçümünden sonra yazılır. Telefon girişi tasarımda yok → SMS maliyet kalemi telefon kanalı açılmadıkça yok.

---

## Tech Stack

| Layer | Technology |
|---|---|
| IaC | AWS SAM (`template.yaml`) |
| Compute | AWS Lambda (.NET 10) |
| API | AWS API Gateway (HTTP API) |
| Database | AWS DynamoDB (single-table, `droblet-{Stage}-table`) |
| File storage | AWS S3 (landing bucket'ı; **özel fotoğraf bucket'ı** `PhotoBucket`; katalog görselleri A-2'ye bağlı) |
| Messaging | AWS SQS (istek kuyrukları + DLQ'lar), SNS |
| Scheduling | AWS EventBridge Scheduler |
| Config | AWS SSM Parameter Store |
| Networking | İsteğe bağlı (varsayılan kapalı): VPC, NAT Gateway, public + private subnets |
| Static hosting | S3 (landing ve web sayfaları) + Cloudflare |
| CI/CD | GitHub Actions |
| Mobile build | EAS (Expo Application Services) |
| Observability | CloudWatch Logs, X-Ray Tracing |
| Region | `eu-central-1` |

---

## Infrastructure Entry Point

**Her şey repo kökündeki `template.yaml`'da.**

```
template.yaml
├── Parameters        — Stage, DeploymentBucket, DeploymentKey
├── Globals           — Runtime, MemorySize, Timeout, Tracing, VpcConfig
└── Resources
    ├── Networking    — Vpc, Subnets, IGW, NAT, RouteTables, SecurityGroup (isteğe bağlı)
    ├── DynamoDB      — DrobletTable
    ├── S3            — LandingBucket, PhotoBucket (özel), [CatalogImageBucket — A-2'ye bağlı]
    ├── SES           — EmailIdentity (droblet.alatech.co — A-10), ConfigurationSet
    ├── SQS/SNS       — ItemProcessorRequestQueue, StylistRequestQueue, TryOnRequestQueue, PaletteRequestQueue,
    │                   her birinin DLQ'su, AlarmTopic
    ├── IAM           — ApiLambdaRole, ItemProcessorLambdaRole, StylistLambdaRole, TryOnLambdaRole,
    │                   PaletteLambdaRole, NotifierLambdaRole
    ├── API Gateway   — HttpApiGateway
    ├── Lambdas       — ApiFunction, ItemProcessorFunction, StylistFunction, TryOnFunction, PaletteFunction,
    │                   NotifierReminderFunction, NotifierWeeklyEditFunction, NotifierFriendRatingsFunction,
    │                   NotifierLifecycleFunction
    ├── EventBridge   — Reminder (15 dk), WeeklyEdit (haftalık), FriendRatings, Lifecycle (günlük)
    ├── Alarms        — 4 DLQ, zamanlanmış iş çalışmadı (×4), worker hata oranı (×4), AI çağrı sayısı (worker başına;
    │                   TryOn ayrı ve sıkı), AWS Budgets, SES bounce/complaint, [OTP/SMS hacmi — telefon kanalı açılırsa]
    └── SSM Params    — SsmJwt, SsmGoogleAuth, SsmAppleAuth, SsmEmail, SsmLogin, SsmAi, SsmEntitlements,
                        SsmPhotos, SsmWeather, SsmCatalog, SsmStore, SsmWorkerAi, SsmPush, [SsmSms — telefon kanalı açılırsa]
```

---

## SAM Parameters

| Parameter | Type | Default | Purpose |
|---|---|---|---|
| `Stage` | String | `dev` | Tüm kaynak adlarının soneki |
| `DeploymentBucket` | String | — | Lambda zip'ini tutan S3 bucket |
| `DeploymentKey` | String | `deploy.zip` | Tüm fonksiyonların **yalnız ilk oluşturulduğu** kod; sonrası `deploy-lambdas.yml` |

Dış sağlayıcıların (AI, SMS vb.) API anahtarları **parametre değildir**; SSM'e `SecureString` olarak elle yazılır (bkz. aşağı).

---

## Globals

```yaml
Globals:
  Function:
    Runtime: dotnet10
    MemorySize: 512
    Timeout: 30
    Tracing: Active
    VpcConfig:
      SecurityGroupIds: [LambdaSecurityGroup]
      SubnetIds: [PrivateSubnetA]
```

Bir varsayılanı (bellek, timeout) değiştirmek için ilgili fonksiyonda override et; Globals'ı yalnız tüm Lambda'lar için geçerliyse değiştir.

---

## Networking

**VPC isteğe bağlı, varsayılan kapalı** (`EnableVpc` parametresi, ortamın `ENABLE_VPC` değişkeni; yoksa `false` — prod ve dev). Kapalıyken VPC, alt ağlar, NAT Gateway, EIP, endpoint'ler ve güvenlik grubu **oluşturulmaz**; Lambda'lar AWS'nin yönetilen ağında çalışır, internete (AI sağlayıcısı, SMS sağlayıcısı, Firebase Cloud Messaging, mağaza API'leri) NAT'sız çıkar ve NAT'ın sabit ~$35/ay ücreti ödenmez. Bedeli: sabit çıkış IP'si (`StaticEgressIp`) yok. IP izin listesi isteyen bir servis gerekirse ilgili GitHub environment'ında `ENABLE_VPC=true` yapılıp infra yeniden dağıtılır; aşağıdaki yapı kurulur.

Açıkken:

```
Vpc: 10.50.0.0/16
  ├── PublicSubnetA:  10.50.1.0/24   — NAT Gateway
  └── PrivateSubnetA: 10.50.11.0/24  — Tüm Lambda'lar
```

- **Inbound**: Internet → API Gateway → `ApiFunction`
- **Outbound**: Lambda → NAT → Internet (dış sağlayıcılar)
- `LambdaSecurityGroup`'a **asla** inbound kural eklenmez. Outbound kısıtlanacaksa yalnız 443.

**DynamoDB için VPC Gateway Endpoint** ekle: her istek tabloya gider ve NAT üzerinden geçerse NAT veri ücreti öder. Gateway endpoint ücretsizdir ve mevcut ağ kararını değiştirmez.

---

## DynamoDB (`DrobletTable`)

```yaml
TableName: !Sub droblet-${Stage}-table
KeySchema:
  - pk (HASH)
  - sk (RANGE)
BillingMode: PAY_PER_REQUEST
TimeToLiveSpecification:
  AttributeName: ttl
  Enabled: true
SSESpecification:
  SSEEnabled: true
PointInTimeRecoverySpecification:
  PointInTimeRecoveryEnabled: true    # prod'da açık
  RecoveryPeriodInDays: 30            # hesap silme vaadindeki "yedeklerden N günde silinir" süresiyle uyumlu olmalı — 35 günlük varsayılan bu sözü bozabilir
```

- **Tek tablo** — tüm entity'ler `pk/sk` desenleriyle ayrışır (bkz. BACKEND_ENGINEER.md)
- Global (tenant'a ait olmayan) veri aynı tabloda ayrı bölümlerde; tohumlama gerekiyorsa betikle, deploy'dan ayrı
- **TTL açık** — OTP kodu (10 dk), iş kayıtları, idempotency makbuzu, geçmiş/analitik kayıtları, refresh token gibi süreli veriler

Droblet TTL'leri:

| Kayıt | TTL |
|---|---|
| OTP kodu (e-posta) | 10 dk |
| `JobEntity` (ItemDraft / Outfit / WeekPlan / Packing / MissingPiece / TryOn / Palette işleri; ItemDraft taslağı iş sonucunda durur) | Taslak onay penceresi kadar — değer Team Lead; geçici yükleme lifecycle'ıyla (S3, aşağı) uyumlu olmalı ki taslak görseli işten önce silinmesin |
| Yükleme oturumu (presigned POST kaydı) | S3 `uploads/tmp/` lifecycle'ıyla aynı |
| Idempotency makbuzu | 30 gün |
| Hava önbelleği (global, şehir × saat) | Sağlayıcı seçilince (A-4) |
| Refresh token, analitik | Mevcut varsayılanlar |

TTL'i **olmayanlar:** try-on görsel kayıtları (kullanıcı silene kadar — tenant içi önbellek), palet sonucu, gardırop, look, plan, takvim, bavul.

---

## S3

### Dosya yükleme bucket'ı
Kullanıcı dosyası (ses, fotoğraf vb.) sunucuya yüklenmiyorsa presigned upload ve dosya bucket'ı **yoktur** — eklenmesi bir ürün/gizlilik kararıdır ve ürün sahibine sorulmadan yapılmaz. Gerekirse tasarımı (bucket, CloudFront, imzalı URL ile erişim kapısı) Team Lead kararıdır; buraya o zaman eklenir.

**Droblet fotoğraf yükler** — ürün kararı tasarımda verilmiş (04 Beden ve fotoğraf, 12–13 Parça ekle; README §3 "Özel S3 nesneleri"). Erişim modeli: **CloudFront yok, yalnız kısa ömürlü imzalı URL**; kişisel görseller hiçbir CDN/önbellekten sunulmaz.

#### `PhotoBucket` — `droblet-${Stage}-photos` (özel)

```yaml
PhotoBucket:
  Type: AWS::S3::Bucket
  DeletionPolicy: Retain
  Properties:
    BucketName: !Sub droblet-${Stage}-photos
    PublicAccessBlockConfiguration:
      BlockPublicAcls: true
      BlockPublicPolicy: true
      IgnorePublicAcls: true
      RestrictPublicBuckets: true
    OwnershipControls:
      Rules: [{ ObjectOwnership: BucketOwnerEnforced }]
    BucketEncryption:
      ServerSideEncryptionConfiguration:
        - ServerSideEncryptionByDefault: { SSEAlgorithm: AES256 }   # SSE-KMS (BucketKeyEnabled) Security önerisiyse Team Lead kararı
    # Versioning KAPALI: açık olursa silinen fotoğraf eski sürüm olarak kalır ve "sil" vaadi bozulur.
    LifecycleConfiguration:
      Rules:
        - Id: expire-temp-uploads
          Status: Enabled
          Prefix: uploads/tmp/
          ExpirationInDays: 1
        - Id: abort-incomplete-multipart
          Status: Enabled
          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 }
PhotoBucketPolicy:    # yalnız TLS: aws:SecureTransport = false → Deny s3:*
```

| Önek | İçerik | Kim yazar | Kim okur (imzalı URL'i Api verir) |
|---|---|---|---|
| `uploads/tmp/{tenantId}/{uploadId}` | Ham yükleme (parça, boy, yüz) | Mobil — presigned POST | `ItemProcessor` (parça), Api (boy/yüz'ü kalıcı öneke taşırken EXIF temizler) |
| `tenant/{tenantId}/items/{itemId}/…` | İşlenmiş parça görseli | `ItemProcessor` (taslak), Api (onayda kalıcılaştırır) | Sahibi; `VisibilityPolicy` izin verirse diğer kullanıcılar; `TryOn` |
| `tenant/{tenantId}/body/…` | Boy fotoğrafı | Api | **Yalnız sahibi**; `TryOn` |
| `tenant/{tenantId}/face/…` | Yüz fotoğrafı | Api | **Yalnız sahibi**; `Palette` |
| `tenant/{tenantId}/tryon/…` | Try-on çıktısı (tenant içi önbellek) | `TryOn` | **Yalnız sahibi** |

- Yükleme **presigned POST** (presigned PUT boyut sınırı koyamaz): `content-length-range` ve `Content-Type` koşullu, kısa ömürlü; anahtar sunucuda `IApiContext` tenant'ından kurulur. Süreler ve boyut sınırı SSM `api/Photos`'ta.
- Yükleme bitince istemci Api'ye "tamamlandı" der; **işi Api kuyruğa koyar** (kota ayırma Api'de). S3 olay bildirimiyle worker tetiklenmez.
- Okuma **presigned GET**, kısa ömürlü (SSM `Photos.ReadUrlTtlSeconds`).
- Hesap silme ve "fotoğraflarımı sil" önekleri listeleyip `DeleteObjects` ile siler (SECURITY_ENGINEER.md §Silme listesi).
- Ücretsiz kotalı **S3 Storage Lens / bucket boyutu metriği** izlenir — try-on birikimi depolama maliyetinin kaynağıdır.

#### Katalog görselleri — `CatalogImageBucket` (koşullu, A-2)
Katalog global ve herkese açık içeriktir (kişisel değil). Kaynağı **Açık karar (A-2)**:
- Feed görsel URL'si veriyor ve lisans doğrudan kullanıma izin veriyorsa **bucket yok**; mobil doğrudan yükler, `TryOn` worker'ı ürün görselini kaynağından okur (izin listesindeki alan adlarından).
- Görsellerin kopyalanması gerekiyorsa `droblet-${Stage}-catalog` bucket'ı (public erişim kapalı) + önünde CDN. Landing'deki gibi Cloudflare mi, CloudFront + OAC mı olacağı **Team Lead kararı** (şablonun "CloudFront yok" varsayılanı yalnız landing için yazıldı; karar kaydına girer). Haftanın edit'i ve editör içerik görselleri de buraya girer (A-7).
- **Bu bucket'a ya da CDN'ine kişisel görsel asla yazılmaz.**

### `LandingBucket`
Landing ve web sayfaları (Next.js statik export). Universal link / app link doğrulama dosyaları buradan sunulur:
- `/.well-known/apple-app-site-association` (Content-Type: `application/json`, uzantısız)
- `/.well-known/assetlinks.json`

Bu iki dosya yanlış content-type ile sunulursa link uygulamayı açmaz ve hata vermez; sadece web sayfasına düşer. Deploy sonrası `curl -I` ile kontrol et.

---

### Alan adı
Landing ve universal link dosyaları **`droblet.alatech.co`** altında. CloudFront ve Route 53 **yok**: `LandingBucket` S3 static website, önünde Cloudflare (proxy açık). Bucket adı alan adının kendisidir (`LandingDomain`), çünkü Cloudflare Host başlığını değiştirmeden gönderir ve S3 bucket'ı Host'tan bulur. Bucket politikası okumayı yalnız Cloudflare IPv4 aralıklarına açar; liste (https://www.cloudflare.com/ips-v4) değişirse `template.yaml` güncellenir.

Cloudflare'de (ilgili zone'da) elle kurulur:
1. **DNS:** `droplet` CNAME → stack output'u `LandingWebsiteHost` (`droblet.alatech.co.s3-website.eu-central-1.amazonaws.com`), proxy **açık**
2. **SSL/TLS:** S3 website endpoint'i yalnız HTTP → bu ad için Configuration Rule ile SSL **Flexible** (zone'un geri kalanı etkilenmez). Always Use HTTPS + HSTS açık
3. **URL Rewrite (Transform Rule):** dinamik yollu istemci sayfaları için (ör. `starts_with(http.request.uri.path, "/r/")` → path `/r/index.html`; statik rewrite, adres çubuğu değişmez, parametre istemcide yoldan okunur)
4. **Response Header Transform:** `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`

Dev stack'i aynı hesapta ayrı bir bucket ister: `dev` ortamında `LANDING_DOMAIN` değişkeni (ör. `droplet-dev.alatech.co`) tanımlanır.

Droblet: alan adı `droblet.alatech.co`, Cloudflare zone'u `alatech.co`, alt alan `droplet`; API `api.droblet.alatech.co` (karar 2026-11-18, handoff README §9.4). Rewrite gerekebilecek yollar: web hesap silme sayfası (E12, mağaza zorunluluğu), davet linki (27 "davet linkini paylaş"), paylaşılabilir profil/look linki (**A-6** — karar verilmeden eklenmez).

---

## E-posta — SendGrid (şifre sıfırlama ve hesap e-postaları)

**Karar 2026-11-18 (ürün sahibi): SES yerine SendGrid.** `template.yaml`'da SES kaynağı ve `ses:*` yetkisi yok. `IEmailService`'in iki uygulaması var: `SendGridEmailService` (varsayılan; SDK'sız, HTTPS `POST /v3/mail/send`) ve `SmtpEmailService` (yedek).

| Adım | Kim | Not |
|---|---|---|
| SendGrid hesabı, `droblet.alatech.co` için **Domain Authentication** (DKIM/SPF CNAME kayıtları Cloudflare'e, proxy kapalı) | Ürün sahibi | Gönderen: `Droblet <no-reply@droblet.alatech.co>` (`Email.From`) |
| API anahtarı — yalnız **Mail Send** yetkili | Ürün sahibi → GitHub secret `SENDGRID_API_KEY` (ortam bazında) | `deploy-infra.yml` SSM SecureString `/droblet/{Stage}/api/Email` = `{"SendGrid":{"ApiKey":"…"}}` olarak yazar; secret yoksa dokunmaz |
| AB veri yerleşimi (isteğe bağlı) | Ürün sahibi + Security | AB'ye sabitlenmiş subuser kullanılırsa `Email.SendGrid.BaseUrl = https://api.eu.sendgrid.com` |
| Tıklama / açılma takibi | Kodda mesaj başına **kapalı** | Takip linki yeniden yazar: şifre sıfırlama universal link'i bozulur ve token yönlendirmeden geçer. Hesap düzeyinde de kapalı tutulur |
| Bounce / spam şikâyeti | SendGrid Event Webhook — **henüz kurulmadı** | Kurulana kadar SendGrid panelinden izlenir |
| SMTP yedeği | SSM `Email.Provider = Smtp` | SendGrid erişilemezse |

## SMS (telefon OTP)

Numara önekine göre sağlayıcıyı `SmsRouter` seçer (ör. +90 için Netgsm, diğer ülkeler için Twilio).
- Anahtarlar `api/Sms` SecureString'de (ör. `Netgsm.{Username,Password,Header}`, `Twilio.{AccountSid,AuthToken,From|MessagingServiceSid}`).
- **Ülke izin listesi = `Sms.Routes`** (ör. `{"90":"Netgsm","44":"Twilio"}`). Rotası olmayan ülke `400 country_not_supported`, anahtarı boş rota `503 sms_unavailable`.
- **Harcama alarmı ilk günden** ve sağlayıcı panellerinde harcama limiti. SMS pumping, telefon OTP'li uygulamaların en sık faturası şişen yeridir (SECURITY_ENGINEER.md).

Droblet: tasarımda telefon girişi yok (02: Apple / Google / e-posta) → **SMS sağlayıcısı yok, açık ülke yok**; `SsmSms` ve `OtpStartVolumeAlarm` telefon kanalı açılmadıkça oluşturulmaz. Açılırsa bu bölüm aynen uygulanır.

---

## SQS Queues & SNS

| Resource | Name | Purpose |
|---|---|---|
| `ItemProcessorRequestQueue` | `droblet-{Stage}-item-process-request` | Api → ItemProcessor (parça fotoğrafı → taslak; toplu eklemede fotoğraf başına bir mesaj) |
| `ItemProcessorRequestDlq` | `droblet-{Stage}-item-process-request-dlq` | 3 denemeden sonra |
| `StylistRequestQueue` | `droblet-{Stage}-stylist-request` | Api → Stylist (günlük kombin, kombin önerisi, haftalık plan, bavul, eksik parça) |
| `StylistRequestDlq` | `droblet-{Stage}-stylist-request-dlq` | 3 denemeden sonra |
| `TryOnRequestQueue` | `droblet-{Stage}-tryon-request` | Api → TryOn ("üzerimde gör") |
| `TryOnRequestDlq` | `droblet-{Stage}-tryon-request-dlq` | 3 denemeden sonra |
| `PaletteRequestQueue` | `droblet-{Stage}-palette-request` | Api → Palette (yüz fotoğrafı → sezon tipi) |
| `PaletteRequestDlq` | `droblet-{Stage}-palette-request-dlq` | 3 denemeden sonra |
| `AlarmTopic` (SNS) | `droblet-{Stage}-alarms` | Tüm CloudWatch alarmları buraya |

- `VisibilityTimeout: 150` (Lambda timeout'u 120 sn'den büyük olmalı)
- `maxReceiveCount: 3` — AI çağrısı pahalı; 5 deneme, bozuk bir isteğin beş kez faturalanması demek
- Event source mapping'de `ReportBatchItemFailures` açık, `BatchSize: 1` — bir isteğin hatası diğerini yeniden denetmez

Görsel üretimi 120 sn'yi aşabilirse (`TryOn`, sağlayıcıya bağlı) fonksiyon timeout'u override edilir ve kuyruğun `VisibilityTimeout`'u timeout'tan büyük tutulur — ölçümden sonra.

Kullanıcı sonucu **bekliyorsa**: DLQ'ya düşen bir iş, ekranda takılı kalan bir kullanıcıdır (ve varsa iade edilmemiş bir kota hakkıdır). Worker son denemede işi `Failed` olarak işaretlemeli (kota tüketildiyse iade etmeli); DLQ yalnız onu da yapamadığı durumdur.

---

## IAM Roles

Her Lambda'nın kendi rolü var — rol paylaşılmaz.

| Rol | İzinler |
|---|---|
| `ApiLambdaRole` | DynamoDB CRUD → tablo · `sqs:SendMessage` → 4 istek kuyruğu · `ses:SendEmail` → `droblet.alatech.co` kimliği · `ssm:GetParameter*` → `/droblet/{Stage}/api*` · S3 → `PhotoBucket`: `PutObject` (presigned POST imzası; `uploads/tmp/*`, kalıcılaştırma), `GetObject` (presigned GET + EXIF temizleme; `uploads/tmp/*`, `tenant/*`), `DeleteObject` + `ListBucket` (silme akışları; `uploads/tmp/*`, `tenant/*`) |
| `ItemProcessorLambdaRole` | SQS receive/delete → `ItemProcessorRequestQueue` · DynamoDB (yalnız gerekenler) · S3 `GetObject` → `uploads/tmp/*`, `PutObject` → `tenant/*/items/*` · `ssm:GetParameter*` → `/droblet/{Stage}/worker*` |
| `StylistLambdaRole` | SQS receive/delete → `StylistRequestQueue` · DynamoDB (yalnız gerekenler) · **S3 yok** (metin aday listesiyle çalışır) · `ssm:GetParameter*` → `/droblet/{Stage}/worker*` |
| `TryOnLambdaRole` | SQS receive/delete → `TryOnRequestQueue` · DynamoDB (yalnız gerekenler) · S3 `GetObject` → `tenant/*/body/*`, `tenant/*/items/*` (+ katalog bucket'ı varsa), `PutObject` → `tenant/*/tryon/*` · `ssm:GetParameter*` → `/droblet/{Stage}/worker*` |
| `PaletteLambdaRole` | SQS receive/delete → `PaletteRequestQueue` · DynamoDB (yalnız gerekenler) · S3 `GetObject` → `tenant/*/face/*` · `ssm:GetParameter*` → `/droblet/{Stage}/worker*` |
| `NotifierLambdaRole` | DynamoDB `Query`, `GetItem`, `PutItem`, `DeleteItem` (geçersiz token temizliği, sayaçlar) · `ssm:GetParameter*` → `/droblet/{Stage}/notifier*` · **S3 yok** |

Worker'lar `Jwt`, `GoogleAuth`, `Store` ya da `Sms` parametrelerini okuyamaz. AI anahtarını yalnız AI çağıran worker'lar okur. Bir worker başka bir worker'ın fotoğraf önekini okuyamaz (Palette boy fotoğrafını, TryOn yüz fotoğrafını göremez).

---

## Lambda Functions

### Deploy sırası — önce SAM, sonra kod

`deploy-lambdas.yml` `aws lambda update-function-code` kullanır: **mevcut** fonksiyonu günceller, yaratmaz. Yeni bir fonksiyon için:

1. `deploy-infra.yml` `template.yaml`'ı deploy eder → fonksiyon, kuyruğu, IAM rolü, alarmları oluşur. Fonksiyon `deploy.zip` ile doğar.
2. `deploy-lambdas.yml` gerçek kodu yükler (elle çalıştır ya da `src/**` push'u). Henüz oluşmamış fonksiyonu uyarıyla atlar.

**Her yeni Lambda iki yere birden eklenir:** `template.yaml` *ve* `deploy-lambdas.yml` matrisi. Matriste olmayan bir fonksiyon sessizce ilk deploy edildiği kodu çalıştırmaya devam eder.

```
droblet-{Stage}-api
  Handler: Api
  Trigger: HTTP API Gateway (ANY /{proxy+} and ANY /)
  Timeout: 30s
  Env:     ASPNETCORE_ENVIRONMENT, SYSTEMS_MANAGER_PATH=/droblet/{Stage}/api, TABLE_NAME,
           ITEM_PROCESSOR_REQUEST_QUEUE_URL, STYLIST_REQUEST_QUEUE_URL, TRYON_REQUEST_QUEUE_URL,
           PALETTE_REQUEST_QUEUE_URL, PHOTO_BUCKET, STAGE

droblet-{Stage}-item-processor
  Handler: ItemProcessor::ItemProcessor.Entrypoint::FunctionHandler
  Trigger: SQS ItemProcessorRequestQueue (BatchSize 1, ReportBatchItemFailures)
  Timeout: 120s · MemorySize: görsel işleme için override (ölçümle)
  SQS MaximumConcurrency: ItemProcessorMaxConcurrency (toplu ekleme zirvesi + sağlayıcı hız limiti)
  Env:     SYSTEMS_MANAGER_PATH=/droblet/{Stage}/worker, TABLE_NAME, PHOTO_BUCKET, STAGE

droblet-{Stage}-stylist
  Handler: Stylist::Stylist.Entrypoint::FunctionHandler
  Trigger: SQS StylistRequestQueue (BatchSize 1, ReportBatchItemFailures)
  Timeout: 120s
  SQS MaximumConcurrency: StylistMaxConcurrency
  Env:     SYSTEMS_MANAGER_PATH=/droblet/{Stage}/worker, TABLE_NAME, STAGE

droblet-{Stage}-tryon
  Handler: TryOn::TryOn.Entrypoint::FunctionHandler
  Trigger: SQS TryOnRequestQueue (BatchSize 1, ReportBatchItemFailures)
  Timeout: 120s (görsel üretim süresi ölçülünce gerekirse override; VisibilityTimeout > Timeout) · MemorySize: override (ölçümle)
  SQS MaximumConcurrency: TryOnMaxConcurrency — en sıkı sınır (maliyet + sağlayıcı hız limiti)
  Env:     SYSTEMS_MANAGER_PATH=/droblet/{Stage}/worker, TABLE_NAME, PHOTO_BUCKET, STAGE

droblet-{Stage}-palette
  Handler: Palette::Palette.Entrypoint::FunctionHandler
  Trigger: SQS PaletteRequestQueue (BatchSize 1, ReportBatchItemFailures)
  Timeout: 120s
  SQS MaximumConcurrency: PaletteMaxConcurrency
  Env:     SYSTEMS_MANAGER_PATH=/droblet/{Stage}/worker, TABLE_NAME, PHOTO_BUCKET, STAGE

droblet-{Stage}-notifier-*          (aynı zip, dört fonksiyon — bir Lambda'nın tek handler'ı olur)
  Timeout: 300s
  Env:     SYSTEMS_MANAGER_PATH=/droblet/{Stage}/notifier, TABLE_NAME, STAGE
  Not:     Zamanlanmış iş çalışmazsa kimse fark etmez — bildirim gelmeyen kullanıcı şikâyet etmez, uygulamayı bırakır.
           Invocation alarmı şart.

  droblet-{Stage}-notifier-reminder       Notifier::Notifier.Entrypoint::Reminder       cron(0/15 * * * ? *)
      Sabah kombin hatırlatması — kullanıcının seçtiği saat (ReminderSlot, UTC). Varsayılan saat tasarımda yok → ürün sahibi
  droblet-{Stage}-notifier-weekly-edit    Notifier::Notifier.Entrypoint::WeeklyEdit     haftalık — gün/saat tasarımda yok → ürün sahibi
      Haftanın edit'i yayınlandı (rızası olana; pazarlama niteliğindeyse pazarlama rızası — Security)
  droblet-{Stage}-notifier-friend-ratings Notifier::Notifier.Entrypoint::FriendRatings  periyot tasarımda yok (anlık mı özet mi) → ürün sahibi
      Arkadaş puanları özeti
  droblet-{Stage}-notifier-lifecycle      Notifier::Notifier.Entrypoint::Lifecycle      günlük
      Abonelik/deneme bitişi yaklaşanlara bir kez
```

Sabah hatırlatmasından önce günlük kombinin hazır olması gerekiyorsa (Bugün ekranı "Bugünün kombini"), `Reminder` işinin slotu gelen kullanıcılar için `stylist-request`'e iş koyması bir seçenektir — bu durumda `NotifierLambdaRole`'e o kuyruğa `sqs:SendMessage` ve kota kuralı eklenir. Seçenek mi yoksa uygulamayı açınca üretim mi olacağı **Team Lead kararı** (maliyet: her aktif kullanıcı × her gün bir Stylist çağrısı).

**Eşzamanlılık sınırı neden:** (SQS tetikleyicisinde `MaximumConcurrency`, en az 2 — reserved concurrency hesabın kotasından pay ayırır, kotası 10 olan yeni hesapta reddedilir) AI çağıran worker'ların eşzamanlılığı sağlayıcının hız limitini aşarsa her istek 429 alır ve yeniden denenir — hem yavaş hem pahalı. Limit, sağlayıcı seçildikten sonra doldurulur.

---

## Alarmlar

Hepsi `AlarmTopic`'e.

| Alarm | Koşul | Neden |
|---|---|---|
| `ItemProcessorDlqAlarm`, `StylistDlqAlarm`, `TryOnDlqAlarm`, `PaletteDlqAlarm` | DLQ ≥ 1 | Bir kullanıcı ekranda takılı kaldı |
| `ReminderNotInvokedAlarm`, `WeeklyEditNotInvokedAlarm`, `FriendRatingsNotInvokedAlarm`, `LifecycleNotInvokedAlarm` | Beklenen periyotta 0 invocation | Zamanlanmış iş sessizce durdu |
| `ItemProcessorErrorRateAlarm`, `StylistErrorRateAlarm`, `TryOnErrorRateAlarm`, `PaletteErrorRateAlarm` | Hata oranı > %10 (15 dk) | Sağlayıcı sorunu — kill switch'i düşün |
| `AiCallVolumeAlarm` (worker başına: ItemProcessor, Stylist, Palette) | Günlük AI worker invocation sayısı > (aylık AI bütçesi ÷ 30 ÷ ölçülen çağrı başı maliyet) | **Maliyetin vekil göstergesi.** Eşik ölçümden sonra yazılır |
| `TryOnCallVolumeAlarm` | Günlük `TryOn` invocation sayısı > (aylık try-on bütçesi ÷ 30 ÷ ölçülen görsel başı maliyet) — **ayrı ve daha sıkı eşik**; ayrıca saatlik ani artış alarmı | **En pahalı kalem.** Tek bir kullanıcının ya da istemci hatasının (döngüde üretim) faturayı şişirmesinin erken uyarısı. Eşik A-3 ölçümünden sonra |
| `ItemProcessorQueueAgeAlarm` | `ApproximateAgeOfOldestMessage` > eşik | Toplu eklemede kullanıcı ilerleme ekranında bekliyor |
| `PhotoBucketSizeAlarm` | Bucket boyutu günlük artışı > eşik | Try-on birikimi / kötüye kullanım |
| `OtpStartVolumeAlarm` | Saatlik `otp/start` (telefon kanalı) sayısı > eşik | **SMS pumping ve SMS faturasının erken uyarısı** |
| AWS Budgets | Aylık AWS harcaması %80 | AWS tarafı bütçesi ürün sahibiyle belirlenir. AI sağlayıcısı AWS üzerindeyse (ör. Bedrock — A-3) o servis için **ayrı bütçe** |
| SES bounce/complaint | Bounce > %5 ya da complaint > %0.1 | SES hesabı askıya alınmadan önce uyarı; e-postalar SMTP'ye çevrilebilir (`Email.Provider`) |

AI ve SMS sağlayıcılarının faturası AWS dışında; hacim alarmları tek erken uyarılardır. Droblet'te görsel üretim sağlayıcısı (TryOn) ile metin sağlayıcısı ayrı olabilir — **her birinin panelinde ayrı sert limit**. **Sağlayıcı panellerinde aylık sert harcama limiti** ürün sahibi tarafından ayarlanır — AI limiti dolunca worker `ProviderError` döner (kota iade edilir), mümkünse kural tabanlı yedeğe düşülür; uygulama bozulmaz.

---

## Mağaza bildirimleri (proje uygulama içi satın alma içeriyorsa)

| Mağaza | URL (mağaza panelinde girilir) |
|---|---|
| App Store Server Notifications V2 | `https://{api}/v1/store/apple/notifications?key={Store.NotificationKey}` |
| Google Play RTDN (Pub/Sub push aboneliği) | `https://{api}/v1/store/google/notifications?key={Store.NotificationKey}` |

Bildirim içeriğine güvenilmez: yalnız ilgili aboneliğin durumu mağazanın sunucu API'sinden yeniden okunur. Anahtar yanlışsa 401.

## SSM Parameter Store

Kodun okuduğu her bölüm SSM'de bulunur; kim oluşturduğu sırra göre değişir:

- **Sır yok → `template.yaml`** (`String`): ör. `api/Ai`, `api/Login` ve feature flag / limit bölümleri. Elle değiştirilen değer, kaynak şablonda değişene kadar korunur.
- **Sır var → `deploy-infra.yml`** (`SecureString`; CloudFormation SecureString oluşturamaz): `api/Jwt`, `api/GoogleAuth`, `api/AppleAuth`, `api/Email`, `api/Sms`, `api/Store`, `worker/Ai`, `notifier/Push`. Yoksa koddaki varsayılanlar + boş anahtar alanlarıyla açılır (boş = tanımlı değil), `Jwt.SecretKey` rastgele üretilir. Var olana asla yazılmaz — anahtarları `aws ssm put-parameter --overwrite` ile doldur.

| SSM Path | İçerik |
|---|---|
| `/droblet/{Stage}/api/Jwt` | `SecretKey` (≥32 karakter), isteğe bağlı `Issuer`, `Audience`, `ExpirationMinutes`, `RefreshTokenExpirationDays` — yoksa `deploy-infra.yml` rastgele `SecretKey` ile oluşturur, varsa dokunmaz |
| `/droblet/{Stage}/api/GoogleAuth` | `ClientId`, `ClientSecret`, `RedirectUri` |
| `/droblet/{Stage}/api/AppleAuth` | `BundleId`, `TeamId`, `KeyId`, `PrivateKey` |
| `/droblet/{Stage}/api/Email` | `Provider` (`Ses` \| `Smtp`), `From`, `Smtp.{Host,Port,Username,Password}` |
| `/droblet/{Stage}/api/Sms` | `Routes` (ülke kodu → sağlayıcı), sağlayıcı anahtarları |
| `/droblet/{Stage}/api/Login` | `CodeTtlMinutes` (10), `MaxAttempts` (3), `ResendCooldownSeconds` (30), `ReviewAccounts` — mağaza incelemesi / iç test: `[{Destination, Code}]`, sabit kod, e-posta/SMS gönderilmez |
| `/droblet/{Stage}/api/Ai` | `Enabled` (kill switch) — **anahtar yok**; Api AI çağırmaz |
| `/droblet/{Stage}/worker/Ai` | `Enabled`, `Provider` (`Anthropic` \| `OpenAI` \| `Bedrock`), `Anthropic.{ApiKey,Model,Effort}`, `OpenAI.{ApiKey,Model}`, `Bedrock.{Region,Model,Effort}` — yalnız AI worker rolleri okur; Bedrock IAM rolüyle |
| `/droblet/{Stage}/api/Store` | Ürün kimlikleri, `AppleIssuerId`/`AppleKeyId`/`ApplePrivateKey` (App Store Server API), `GoogleServiceAccountEmail`/`GooglePrivateKey` (Play Developer API), `NotificationKey` — anahtarlar yoksa satın alma 503 döner |
| `/droblet/{Stage}/notifier/Push` | `FcmProjectId` — yalnız Notifier rolü okur (push: **Firebase Cloud Messaging**). Firebase hizmet hesabı: `/droblet/{Stage}/notifier/FirebaseServiceAccount` — indirilen JSON olduğu gibi (SecureString; pipeline boş açar, gerekirse elle doldur) |

Droblet'e özel bölümler:

| SSM Path | Tür | İçerik |
|---|---|---|
| `/droblet/{Stage}/api/Entitlements` | String (template) | Paket başına kota/sınırlar (AI_ENGINEER.md §Kota) — **değerler Açık karar (A-1)** |
| `/droblet/{Stage}/api/Photos` | String (template) | `UploadUrlTtlSeconds`, `ReadUrlTtlSeconds`, `MaxUploadBytes`, izinli içerik türleri |
| `/droblet/{Stage}/api/Weather` | SecureString (deploy-infra) | Hava sağlayıcısı ve anahtarı — **Açık karar (A-4)**; boş = hava kartı gizlenir, kurallar sezona düşer |
| `/droblet/{Stage}/api/Catalog` | String / SecureString | Katalog kaynağı ayarları, affiliate parametreleri — **Açık karar (A-2)** |
| `/droblet/{Stage}/worker/Ai` | SecureString (deploy-infra) | Mevcut alanlar + **görev başına** sağlayıcı/model: `Tasks.{ItemDraft,Outfit,WeekPlan,Packing,MissingPiece,TryOn,Palette}.{Provider,Model}`, görsel çözünürlüğü, içerik denetimi ayarı. Sağlayıcılar **Açık karar (A-3)** |
| `/droblet/{Stage}/api/Login` | String (template) | Mevcut alanlar; `ReviewAccounts` mağaza incelemesi için **Üyelik yetkili** bir test hesabı (try-on'u inceleyici görebilsin) |

**`Ai.Enabled` kill switch'tir.** `false` olunca Api AI isteklerini kuyruğa koymaz; mobil "şu an kullanılamıyor" der ya da kural tabanlı yedeğe düşer. İlk mağaza gönderiminden önce çalışır olmalı.

```bash
aws ssm put-parameter \
  --name "/droblet/prod/worker/Ai" \
  --type "SecureString" \
  --value '{"Enabled":true,"Provider":"Anthropic","Anthropic":{"ApiKey":"...","Model":"claude-opus-5-5","Effort":"medium"}}' \
  --overwrite --region eu-central-1
```

Lambda'lar config'i cold start'ta okur. Kill switch'in ve limitlerin hemen etkili olması için Api bu bölümleri kısa bir önbellekle (60 sn) yeniden okur — bu tek istisna.

---

## API Gateway (`HttpApiGateway`)

```yaml
Type: AWS::Serverless::HttpApi
StageName: {Stage}
CorsConfiguration:
  AllowOrigins: ['*']
  AllowMethods: [GET, POST, PUT, DELETE, OPTIONS, PATCH]
  AllowHeaders: ['*']
```

İstemcilerin çoğu mobil uygulama; CORS pratikte landing'in tarayıcıdan çağırdığı uçlar için önemli. Prod'da `AllowOrigins`'i landing alan adıyla sınırla.

**Throttling:** `DefaultRouteSettings` ile hız sınırı koy; `AllowAnonymous` olan uçlar ve **OTP başlatma** (SMS faturası) ayrıca sıkı sınırlanır.

---

## Deploy Commands

### İlk stack oluşturma
```bash
sam build

sam deploy \
  --stack-name droblet-prod \
  --parameter-overrides Stage=prod DeploymentBucket=your-deploy-bucket DeploymentKey=deploy.zip \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --region eu-central-1
```

### Mevcut stack'i güncelleme
```bash
sam build
sam deploy --stack-name droblet-prod --parameter-overrides Stage=prod DeploymentBucket=your-bucket \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM --region eu-central-1
```

### Tek Lambda'yı elle deploy (hotfix)
```bash
cd src/Api
dotnet publish -c Release -o /tmp/api-publish
cd /tmp/api-publish && zip -r /tmp/api.zip .

aws lambda update-function-code \
  --function-name droblet-prod-api \
  --zip-file fileb:///tmp/api.zip \
  --region eu-central-1
```

---

## Adding New Infrastructure

1. Kaynağı `template.yaml`'a `Resources` altında ekle
2. İlgili Lambda rolüne IAM izni ekle
3. Kod kaynağa referans veriyorsa Lambda'nın `Environment.Variables`'ına ekle
4. Bu rehberi güncelle
5. Handler kullanımını etkiliyorsa `BACKEND_ENGINEER.md`'yi güncelle
6. `sam build && sam deploy`

### Örnek — yeni SQS kuyruğu
```yaml
MyNewQueue:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub droblet-${Stage}-my-new-queue
    VisibilityTimeout: 150
    RedrivePolicy:
      deadLetterTargetArn: !GetAtt MyNewDlq.Arn
      maxReceiveCount: 3

MyNewDlq:
  Type: AWS::SQS::Queue
  Properties:
    QueueName: !Sub droblet-${Stage}-my-new-dlq
```

---

## CI/CD Pipelines (`.github/workflows/`)

> **Droblet'te uygulanan (2026-11-18):** bölge **eu-central-1**; deploy AWS access key secret'larıyla (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Şablondan iki fark:
> - **Deploy bucket'ı sabit değil.** Repo değişkeni `DEPLOY_BUCKET` doluysa o kullanılır (stack ile aynı bölgede olmalı); boşsa `infra/bootstrap.yaml` `droblet-{Stage}-deploy-{AccountId}` bucket'ını kurar. `deploy.zip` yoksa workflow yer tutucu yükler (durmaz).
> - **Runner:** varsayılan `ubuntu-latest` (+ `setup-dotnet` 10). Self-hosted için repo değişkeni `DEPLOY_RUNNER`.
> - `deploy-lambdas.yml` mimariyi (arm64 / x86_64) fonksiyondan okur; elle çalıştırmada `dev` de seçilebilir. Ayrıca `ci.yml`: PR ve `main`'de backend build + test, `sam validate --lint`, mobil `tsc` + `eslint`.

### `deploy-infra.yml`
**Trigger**: yalnız tag — `infra-{dev|prod}-vX.Y.Z` (ör. `infra-prod-v1.4.0`). Stage tag'den okunur; tag'lenen commit `main`'de değilse ya da biçim yanlışsa iş durur. Elle çalıştırma (stage seçilir, `execute` varsayılan kapalı) yalnız change set oluşturur — konsoldan incelenen önizleme; herhangi bir branch'te çalışır.
**Environment**: job, stage adındaki GitHub environment'ında (`dev`, `prod`) çalışır; değişken/secret önce oradan, yoksa repo düzeyinden okunur. `prod` environment'ına "Required reviewers" konarak prod deploy'u onaya bağlanır.
**Stack'ler**: `droblet-{Stage}-bootstrap` (`infra/bootstrap.yaml`; deploy bucket'ı `ala-tech-deploy` zaten var olduğundan normalde atlanır) → `droblet-{Stage}` (`template.yaml`)
**Adımlar**: `sam validate --lint` → bootstrap → stack durumu kontrolü (`ROLLBACK_COMPLETE` vb. ise durur; Retain'li kaynaklar yüzünden otomatik silmez) → bucket'ta `deploy.zip` var mı (yoksa durur) → `sam deploy` → output'lar job özetine
**Kod**: her fonksiyon `deploy.zip` ile doğar, gerçek kod `deploy-lambdas.yml`'den (fonksiyon başına zip, `update-function-code`) gelir. Anahtar değişmediği için stack güncellemesi kodu geri almaz; ama CloudFormation bir fonksiyonu **yeniden oluşturursa** (ad değişikliği vb.) o fonksiyon `deploy.zip`'e döner — ardından `deploy-lambdas.yml`'i çalıştır.
**Secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` · **Variables**: `AWS_REGION` · isteğe bağlı: `ALARM_EMAIL`, `LANDING_DOMAIN`, `AI_DAILY_CALL_ALARM_THRESHOLD`, `TRYON_DAILY_CALL_ALARM_THRESHOLD` (Droblet: try-on ayrı eşik) (boşsa gönderilmez: ilk kurulumda şablon varsayılanı, sonra önceki değer kalır)

**Sürüm çıkarma**:
```bash
git switch main && git pull
git tag -a infra-prod-v1.4.0 -m "Worker kuyruğu DLQ alarmı"
git push origin infra-prod-v1.4.0
```
Sürümler stage başına ayrı ilerler. Geri almak = önceki commit'e yeni bir sürüm tag'i (`git tag -a infra-prod-v1.4.1 <eski-sha>`); var olan tag taşınmaz.

### `deploy-lambdas.yml`
**Trigger**: `main`'e push (`src/**`, `Directory.Build.props`) ya da elle → her zaman **prod** (`main` = prod; stage workflow'da sabit)
**Runner**: self-hosted (.NET 10 SDK runner'da kurulu)
**Matrix**: `api`, `item-processor`, `stylist`, `tryon`, `palette`, `notifier` (dört Notifier fonksiyonu aynı zip'i paylaşır — tek matris girdisi)
**Secrets**: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` · **Variables**: `AWS_REGION` (isteğe bağlı)

Deploy bucket'ı (`ala-tech-deploy`) iki workflow'da da sabit yazılıdır.

İki iş aynı `deploy-backend-prod` concurrency grubunda: stack güncellenirken `update-function-code` çalışmaz, sırayla beklerler.

### İlk kurulum (boş hesap)
1. Repo secret'ları: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (CloudFormation, IAM, Lambda, S3, DynamoDB, SQS, EC2/VPC, API Gateway, SNS, CloudWatch, Scheduler, SSM yetkili)
2. `ala-tech-deploy` bucket'ına `deploy.zip` koy. GitHub environment'ları `dev` ve `prod` (gerekirse `AWS_REGION`); `prod`'a Required reviewers.
3. İsteğe bağlı önizleme: Actions → **Deploy infra** → Run workflow (`execute` kapalı). Sonra `infra-{stage}-v0.1.0` tag'ini push'la
4. Job özetindeki output'lardan `LANDING_BUCKET`, `API_BASE_URL` değişkenlerini doldur; Cloudflare kaydını `LandingWebsiteHost`'a yönelt (§Alan adı)
5. SSM sırlarını (SecureString) elle yaz — bkz. §SSM Parameter Store
6. Global veri tohumu varsa yükle (bkz. BACKEND_ENGINEER.md)

### `deploy-landing.yml`
**Trigger**: `main`'e push (`landing/**`)
Landing'i build eder, `landing/out/`'u `LandingBucket`'a senkronlar; `.well-known` dosyalarının content-type'ını ayrıca ayarlar. Cache purge yok: Cloudflare HTML'i varsayılan olarak cache'lemez, `_next/` dosyaları hash'li.

---

## Rules

1. **`template.yaml` tek doğruluk kaynağı** — konsolda elle kaynak yok
2. **Lambda başına bir rol**
3. **En az yetki** — mümkün olan her yerde belirli ARN; gereksiz `*` yok
4. **Security group'ta geniş inbound kural yok**
5. **Tüm kaynak adları `!Sub droblet-${Stage}-...`**
6. **Sırlar SSM'de** — template değerinde ya da düz ortam değişkeninde değil
7. **Her SQS kuyruğunun DLQ'su var**
8. **Kullanıcı dosyası (ses/görüntü) için bucket eklemek ürün kararıdır**
9. **AI çağıran her Lambda'nın eşzamanlılık sınırı (SQS `MaximumConcurrency`, `ReservedConcurrentExecutions` değil) ve çağrı sayısı alarmı var; ücretli dış uçların (SMS) hacim alarmı var**

---

## Checklist Before Infrastructure PR

- [ ] `sam build` yerelde geçiyor
- [ ] Yeni kaynaklar `!Sub droblet-${Stage}-...` deseninde
- [ ] IAM rolleri belirli ARN'lerle sınırlı
- [ ] Yeni SQS kuyruğunun DLQ'su var
- [ ] Yeni env var'lar bu rehberde ve `BACKEND_ENGINEER.md`'de
- [ ] Sırlar SSM'de ya da `NoEcho: true`
- [ ] Maliyet etkisi düşünüldü (NAT verisi, AI çağrı hacmi, SMS hacmi, Lambda eşzamanlılığı)
- [ ] PR açıklamasında geri alma planı var

---

## Mobil Sürüm — `release-mobile.yml`

Uygulama bir tag ile çıkar. Üç tag şekli var, çünkü bir mağaza binary'yi reddettiğinde o platformu tek başına yeniden çıkarırsın.

| Tag | Ne yapar |
|---|---|
| `mobile-v1.2.3` | iOS + Android |
| `ios-v1.2.3` | Yalnız iOS |
| `android-v1.2.3` | Yalnız Android |

```bash
git tag mobile-v1.2.3
git push origin mobile-v1.2.3
```

**Tag'deki sürüm, uygulamadaki sürüm olur.** Build numarasını EAS uzaktan artırır.

### Akış
Build'den **önce** üç kontrol: `tsc --noEmit`, `npm run check`, `expo export`. Sonuncusu, tsc'nin geçirip bundler'ın reddettiği import'ları yakalar.

Build `--wait` ile beklenir — `--no-wait`, başarısız build için başarı raporlayan bir sürüm hattıdır.

Submit ayrı bir adımdır: reddedilen bir yükleme başarısız bir build gibi görünmemeli.

### Kurulum — bunlar sende

0. **Kimlikler:** bundle id / package **`com.alatech.droplet`**, scheme `droplet`, universal link alanı `droblet.alatech.co`. Mağaza kaydı açıldıktan sonra bundle id değiştirilemez.
1. **EAS projesi:** `cd mobile && npx eas init`
2. **GitHub ortamı:** `mobile-release`, **required reviewer** ile. Tag bir sürüm önerir, bir insan onu dışarı bırakır.
3. **Secret'lar:** `EXPO_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON`
4. **iOS imzalama (yerel derleme, `release-mobile.yml`):** ana uygulama için App Store profili `com.alatech.droplet` (gereken yetkiler: Push, Sign in with Apple, Associated Domains, varsa App Groups `group.com.alatech.droplet`; adı `PROFILE_NAME`). Proje widget/extension içeriyorsa her extension için ayrı profil (ör. `com.alatech.droplet.ExpoWidgetsTarget`, App Groups; adı `WIDGET_PROFILE_NAME`). Hepsi `IOS_DIST_P12`'deki Apple Distribution sertifikasıyla üretilir; base64 hâlleri `IOS_PROVISIONING_PROFILE` (ve `IOS_WIDGET_PROVISIONING_PROFILE`) secret'larına. Workflow ad, App ID, yetkiler ve sertifika eşleşmesini arşivden önce denetler.
5. **API alan adı (`api.droblet.alatech.co`):** eu-central-1'de ACM sertifikası (DNS doğrulaması Cloudflare'de) → repo değişkenleri `API_DOMAIN`, `API_CERTIFICATE_ARN` → deploy-infra → çıktıdaki `ApiDomainTarget`'a Cloudflare'de CNAME (proxy kapalı, "DNS only"). `ApiBaseUrl` çıktısı o zaman `https://api.droblet.alatech.co` olur.
6. **`mobile/eas.json`:** `build.production.env.EXPO_PUBLIC_API_BASE_URL` (SAM çıktısı `ApiBaseUrl`, https) ve `submit.production.ios` içindeki `appleId`, `ascAppId`, `appleTeamId` — köşeli parantezli yer tutucular doluysa release başlar; `app.config.ts` API adresini ve `EAS_PROJECT_ID`yi buradan uygulamaya yazar
7. **Android track:** `internal` → beta'da `closed testing`; `production` bir karardır, varsayılan değil.
8. **Apple Developer ve Google Play hesapları — projenin başında başvur.** Kurumsal hesap doğrulaması günler/haftalar sürebilir; abonelik ürünleri ve vergi/banka bilgileri ödeme özelliklerini bekletir.
9. **Native extension'lar (proje gerektirirse):** her iOS extension (widget, Live Activity, App Intents) kendi bundle id'sini, App Group yetkisini ve provisioning profile'ını ister; release hattının imzalama adımı buna göre genişletilir.

Droblet: bundle id / package, scheme ve alan adları **Açık karar (A-10)** — `com.alatech.droplet`, `droplet`, `droblet.alatech.co`, `api.droblet.alatech.co`, `droblet.alatech.co` karar verilene kadar yer tutucu kalır; release hattı `eas.json` yer tutucuları doluncaya kadar başlamaz. Profil adları (`PROFILE_NAME`) bundle id'den sonra. **Extension yok** (tasarımda widget / Live Activity yok) → `WIDGET_PROFILE_NAME` ve `IOS_WIDGET_PROVISIONING_PROFILE` kullanılmaz; App Groups gerekmez. Gereken iOS yetkileri: Push, Sign in with Apple, Associated Domains (davet/paylaşım linki), In-App Purchase. Sürüm hattı adları: `release-mobile.yml`, tag'ler `mobile-v*`, `ios-v*`, `android-v*`, GitHub ortamı `mobile-release`.

### Bilinmesi gerekenler
- `play-service-account.json` `.gitignore`'da ve iş sonunda `if: always()` ile siliniyor.
- `concurrency: release-mobile` — arka arkaya itilen iki tag build numarası için yarışmaz.
- Ücretli Apple hesabı ve iOS dağıtım sertifikaları gerekiyor; ilk `eas build` bunları ister.
- Mağaza incelemesi için izin açıklamaları (`app.json` → `ios.infoPlist`, desteklenen dillerde yerelleştirilmiş) somut ve dürüst olmalı: her izin (bildirim, mikrofon, kamera, konum…) neden istendiğini ve verinin ne olduğunu (cihazda mı işleniyor, gönderiliyor mu) açıkça söyler.

Droblet izinleri (metinler **taslak** — TR + EN, ürün sahibi ve hukuk onayıyla son hâlini alır):

| İzin | Ne zaman | Taslak metin (TR) |
|---|---|---|
| Kamera (`NSCameraUsageDescription`, `CAMERA`) | Parça ekle, boy fotoğrafı çek | "Kıyafetlerini ve dilersen boy fotoğrafını çekmek için kamerayı kullanırız. Fotoğrafların hesabına yüklenir ve yalnızca sana açıktır." |
| Fotoğraflar (`NSPhotoLibraryUsageDescription`; Android fotoğraf seçici) | Toplu ekle, yüz fotoğrafı yükle | "Seçtiğin fotoğrafları gardırobuna eklemek ve renk paleti analizi için kullanırız. Yalnızca seçtiğin fotoğraflar yüklenir." |
| Bildirim (`POST_NOTIFICATIONS`) | Sabah kombin hatırlatması açılırken | Uygulama içi ön açıklama + sistem izni |
| Konum | **Yalnız A-4 kararı konum izni ise** | Karar sonrası yazılır |
| Rehber | **Yalnız A-8 kararı rehber eşleşmesi ise** | Karar sonrası yazılır; ham numaranın gidip gitmediğini dürüstçe söyler |

Fotoğraf kitaplığında tam erişim istenmez; sistem fotoğraf seçicisi tercih edilir.
