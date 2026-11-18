# Mağaza, push ve Apple anahtarları — ürün sahibi kurulumu

Bu belge, uygulama içi satın almanın (Droblet Üyelik + ek kredi paketi), mağaza sunucu bildirimlerinin, push
bildirimlerinin ve "Apple ile giriş" token iptalinin **canlıda çalışması için ürün sahibinin yapması gerekenleri**
listeler. Kod tarafı hazır; aşağıdaki değerler girilene kadar ilgili parça kendini kapalı tutar (SSM değeri
`CHANGE_ME` = yapılandırılmamış). Sözleşme ayrıntısı: [api/purchases-push.md](api/purchases-push.md).

`{API}` = API'nin kök adresi. Şu an dev: `https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com`
(prod için `droblet-prod` yığınının `ApiUrl` çıktısı).

## 0. Kurulumsuz neler çalışıyor

| Parça | Anahtar olmadan | Gereken |
|---|---|---|
| iOS satın alma doğrulama (StoreKit 2 JWS) | **Çalışır** — imza, sunucuda gömülü Apple Root CA - G3 ile yerelde doğrulanır | App Store Connect'te ürünler (§1) |
| iOS abonelik durumu (yenileme, grace, iade) | Mağaza bildirimleriyle çalışır | §1.4 bildirim adresi; §1.3 anahtarı geri yüklemede güncel durumu okur |
| Android satın alma | 501 `purchase_verification_unavailable` (ödeme kaybolmaz; uygulama işlemi bitirmez) | §3 servis hesabı |
| Android bildirimleri (RTDN) | 503 (Pub/Sub tekrar dener) | §3.3 Pub/Sub |
| iOS push | Gönderilmez | §2.2 APNs anahtarı |
| Android push | Gönderilmez | §4 Firebase |
| Hesap silmede Apple token iptali | Loglanır, silme devam eder | §2.1 Sign in with Apple anahtarı |

## 1. App Store Connect (iOS)

### 1.1 Önkoşul
- **Business → Agreements**: *Paid Apps* sözleşmesi, vergi ve banka bilgileri aktif (yoksa ürünler mağazada görünmez).
- Uygulama kaydı: bundle id `com.alatech.droplet`, Team `4LB4RD97A9` (mevcut).

### 1.2 Ürünler
**Monetization → Subscriptions → Subscription Groups → (+)**: grup adı **Droblet Üyelik** (TR/EN yerelleştirme: "Droblet Üyelik" / "Droblet Membership").

| Product ID | Tür | Süre | Seviye (Level) | Tanıtım teklifi |
|---|---|---|---|---|
| `com.alatech.droplet.premium.yearly` | Auto-Renewable Subscription | 1 yıl | 1 (en üst) | **Free, 1 week**, tüm ülkeler, yeni aboneler |
| `com.alatech.droplet.premium.monthly` | Auto-Renewable Subscription | 1 ay | 2 | **Free, 1 week**, tüm ülkeler, yeni aboneler |

- Her abonelik: Reference name, fiyat (temsili: aylık ₺199,99, yıllık ₺1.499,99 — gerçek fiyat buradan okunur, uygulamada yazılı değildir),
  TR + EN Display Name / Description, inceleme ekran görüntüsü (paywall), *Review notes*: "30 AI images per month; sandbox tester ...".
- Tanıtım teklifi: Subscription → **Subscription Prices → View all Subscription Pricing → Set Up Introductory Offer** → *Free* → *1 week*.
- **Billing Grace Period**: Subscriptions sayfasında **On, 16 gün** önerilir (sunucu grace süresince erişimi açık tutar).

**Monetization → In-App Purchases → (+)**: tür **Consumable**, Product ID `com.alatech.droplet.credits.20`,
"20 AI görseli" / "20 AI images" (temsili ₺79,99). Kredi miktarı sunucuda `Store:CreditPacks` (template.yaml `api/Store`).

İlk sürümde abonelikler ve paket **uygulama sürümüyle birlikte incelemeye** gönderilir (sürüm sayfasında *In-App Purchases and Subscriptions* bölümüne ekle).

### 1.3 In-App Purchase anahtarı (App Store Server API)
**Users and Access → Integrations → In-App Purchase → Generate In-App Purchase Key** (ad: "Droblet server").
- İndirilen `.p8` dosyasının **tüm içeriği** → SSM SecureString `/droblet/{stage}/api/Store/IapPrivateKey`
- Key ID → SSM String `/droblet/{stage}/api/Store/IapKeyId`
- Sayfanın üstündeki **Issuer ID** → SSM String `/droblet/{stage}/api/Store/IssuerId`

Bu anahtar; satın almada aboneliğin güncel durumunu (grace / billing retry) ve "Satın alımları geri yükle"de sahip olunan
aboneliklerin son halini okumak için kullanılır. Yoksa doğrulama yine çalışır (cihazın imzalı işlemi + bildirimler).

### 1.4 App Store Server Notifications v2
**App → General → App Information → App Store Server Notifications**:
- Production Server URL: `{API}/v1/store/apple/notifications` — **Version 2**
- Sandbox Server URL: `{API}/v1/store/apple/notifications` — **Version 2** (dev yığınının adresi verilebilir)

Kontrol: App Store Server API'nin *Request a Test Notification* çağrısı ya da bir sandbox satın alma → CloudWatch'ta
`Apple notification ...` logu. İsteğe bağlı: uygulamanın **Apple ID**'si (App Information → Apple ID) →
SSM String `/droblet/{stage}/api/Store/AppAppleId` (prod bildirimlerinde ek kontrol).

### 1.5 Test
- **Users and Access → Sandbox → Test Accounts**: sandbox test hesabı. TestFlight ve geliştirme sürümlerinde satın alma
  sandbox'ta yapılır; sunucu sandbox'ı kabul eder (`Store:AcceptSandbox`, App Review de sandbox kullanır).
- Sandbox'ta abonelik süreleri kısadır (1 ay ≈ 5 dk); yenileme / bitiş bildirimleri birkaç dakikada gelir.

## 2. Apple anahtarları (Certificates, Identifiers & Profiles → Keys)

### 2.1 Sign in with Apple (hesap silmede token iptali — App Store kuralı 5.1.1(v))
**Keys → (+)** → *Sign in with Apple* → Configure → Primary App ID `com.alatech.droplet` → Register → `.p8` indir.
- `.p8` içeriği → SSM SecureString `/droblet/{stage}/api/AppleAuth/PrivateKey`
- Key ID → SSM String `/droblet/{stage}/api/AppleAuth/KeyId`
- Team ID `4LB4RD97A9` → `/droblet/{stage}/api/AppleAuth/TeamId` (deploy-infra hazır yazar)

Giriş sırasında uygulama `authorizationCode` gönderir; sunucu bunu Apple refresh token'ına çevirip AES-256-GCM ile
şifreli saklar (anahtar `/droblet/{stage}/api/AppleAuth/TokenEncryptionKey`, deploy-infra otomatik üretir — değiştirilirse
eski token'lar iptal edilemez). `DELETE v1/auth/me` önce Apple'da token'ı iptal eder. Anahtar girilmeden önce giriş
yapmış kullanıcıların token'ı yoktur; onlar bir sonraki girişte kazanılır.

### 2.2 APNs (iOS push)
**Keys → (+)** → *Apple Push Notifications service (APNs)* → `.p8` indir (Sign in with Apple ile aynı anahtarda iki servis
de açılabilir; ayrı anahtar önerilir).
- `.p8` içeriği → SSM SecureString `/droblet/{stage}/notifier/Push/ApnsKey`
- Key ID → SSM String `/droblet/{stage}/notifier/Push/ApnsKeyId`
- Team ID → `/droblet/{stage}/notifier/Push/ApnsTeamId` (hazır: `4LB4RD97A9`)

App ID'de *Push Notifications* yetkisi ve profildeki `aps-environment` mevcut. Sunucu iOS'a **doğrudan APNs** ile
gönderir (HTTP/2, token auth): önce production, geliştirme sürümü token'ı için sandbox. Bu yüzden Firebase projesine
APNs anahtarı yüklemek **gerekmez** (ileride iOS'ta FCM'e geçilirse: Firebase → Project settings → Cloud Messaging →
Apple app configuration → APNs Authentication Key).

## 3. Google Play Console (Android)

### 3.1 Ürünler
Önkoşul: Play Console'da `com.alatech.droplet` uygulaması, ödeme profili, ve **expo-iap içeren imzalı bir sürümün**
kapalı / dahili test kanalına yüklenmiş olması (Play, faturalandırma kütüphanesi olan bir APK/AAB görmeden ürün açtırmaz).

**Monetize → Products → Subscriptions → Create subscription**:

| Product ID | Base plan | Yenileme | Teklif |
|---|---|---|---|
| `com.alatech.droplet.premium.monthly` | `monthly` — Auto-renewing, 1 ay | Grace period: 7 gün (öneri), Account hold açık | `trial-7d`: **Free trial 7 gün**, uygunluk: *New customer acquisition — never had this subscription* |
| `com.alatech.droplet.premium.yearly` | `yearly` — Auto-renewing, 1 yıl | aynı | `trial-7d`: **Free trial 7 gün** |

Base plan ve teklifler **Activate** edilmeli. Uygulama, kullanıcının uygun olduğu deneme teklifini seçer; uygun değilse base plan alınır.
Aylık ↔ yıllık geçiş Play aboneliği değiştirir (yeni purchase token, `linkedPurchaseToken`); sunucu eskisini kapatır, kredi ayını korur.

**Monetize → Products → In-app products → Create product**: `com.alatech.droplet.credits.20`, "20 AI görseli". Sunucu
doğrulamadan sonra **consume** eder (tekrar alınabilir).

**Setup → License testing**: test Google hesaplarını ekle (gerçek ücret alınmaz).

### 3.2 Servis hesabı (Play Developer API)
1. Google Cloud Console'da bir proje (Firebase projesi de olabilir) → **APIs & Services → Enable APIs** →
   *Google Play Android Developer API*.
2. **IAM & Admin → Service Accounts → Create**: `droblet-play-api` → **Keys → Add key → JSON** → dosyayı indir.
3. Play Console → **Users and permissions → Invite new users** → servis hesabının e-postası → *App permissions*:
   `com.alatech.droplet` → **View app information and download bulk reports**, **View financial data**,
   **Manage orders and subscriptions**. (Yetkinin etkinleşmesi 24 saate kadar sürebilir.)
4. JSON dosyasının **tamamı** → SSM SecureString `/droblet/{stage}/api/Store/GooglePlayServiceAccountJson`.

### 3.3 Real-time developer notifications (Pub/Sub push)
```bash
PROJECT=<gcp-project-id>
API=https://b8lvaj4r5e.execute-api.eu-central-1.amazonaws.com     # {API}
gcloud config set project $PROJECT
gcloud services enable pubsub.googleapis.com
gcloud pubsub topics create droblet-play-rtdn
# Play'in yayıncı hesabı topic'e yazabilsin:
gcloud pubsub topics add-iam-policy-binding droblet-play-rtdn \
  --member=serviceAccount:google-play-developer-notifications@system.gserviceaccount.com \
  --role=roles/pubsub.publisher
# Push isteğini imzalayacak kimlik:
gcloud iam service-accounts create droblet-rtdn-push --display-name="Droblet RTDN push"
gcloud pubsub subscriptions create droblet-play-rtdn-push \
  --topic=droblet-play-rtdn \
  --push-endpoint=$API/v1/store/google/notifications \
  --push-auth-service-account=droblet-rtdn-push@$PROJECT.iam.gserviceaccount.com \
  --push-auth-token-audience=$API/v1/store/google/notifications \
  --ack-deadline=60 --min-retry-delay=10s --max-retry-delay=600s
```
(Projede Pub/Sub servis ajanının `roles/iam.serviceAccountTokenCreator` yetkisi yoksa ekle:
`service-<PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com`.)

SSM:
- `/droblet/{stage}/api/Store/GooglePubSubAudience` = `{API}/v1/store/google/notifications` (yukarıdaki audience ile aynı)
- `/droblet/{stage}/api/Store/GooglePubSubServiceAccount` = `droblet-rtdn-push@<project>.iam.gserviceaccount.com`

Play Console → **Monetize → Monetization setup → Real-time developer notifications**: Topic name
`projects/<project>/topics/droblet-play-rtdn` → **Send test notification** → kaydet. Sunucu her isteği Google imzalı
OIDC token'ı (aud + servis hesabı e-postası) ile doğrular; test bildirimi 204 ile kabul edilip yok sayılır.

## 4. Firebase (Android push — FCM)
1. Firebase Console → proje (Play API projesiyle aynı olabilir) → **Add app → Android**, package `com.alatech.droplet`.
2. `google-services.json` indir → EAS'e dosya değişkeni olarak ver (repoya girmez):
   `npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret --environment production --environment preview`
   (yerelde: `GOOGLE_SERVICES_JSON=./google-services.json npx expo run:android`).
3. **Project settings → Service accounts → Generate new private key** → JSON'un tamamı →
   SSM SecureString `/droblet/{stage}/notifier/Push/ServiceAccountJson`.

iOS push Firebase kullanmaz (§2.2). Uygulama bildirim iznini onboarding bitince ve bir bildirim anahtarı açılınca ister;
token `PUT v1/tenant/user/me/device` ile `pushTokenType` (`apns` / `fcm`) birlikte kaydedilir.

## 5. Parameter Store özeti (`/droblet/{stage}/…`, eu-central-1)

deploy-infra (`.github/workflows/deploy-infra.yml`, "Parameter Store iskeleti") hepsini **yoksa** oluşturur, var olanı ezmez.

| Parametre | Tür | Başlangıç | Kim doldurur | `CHANGE_ME` iken |
|---|---|---|---|---|
| `api/Store/IapPrivateKey` | SecureString | `CHANGE_ME` | §1.3 `.p8` | Server API kapalı; JWS doğrulama çalışır |
| `api/Store/IapKeyId` | String | `CHANGE_ME` | §1.3 Key ID | 〃 |
| `api/Store/IssuerId` | String | `CHANGE_ME` | §1.3 Issuer ID | 〃 |
| `api/Store/GooglePlayServiceAccountJson` | SecureString | `CHANGE_ME` | §3.2 JSON | Android satın alma 501 |
| `api/Store/GooglePubSubAudience` | String | `CHANGE_ME` | §3.3 | RTDN 503 |
| `api/Store/GooglePubSubServiceAccount` | String | `CHANGE_ME` | §3.3 | RTDN 503 |
| `api/AppleAuth/PrivateKey` | SecureString | `CHANGE_ME` | §2.1 `.p8` | Apple token iptali atlanır (loglanır) |
| `api/AppleAuth/KeyId` | String | `CHANGE_ME` | §2.1 Key ID | 〃 |
| `api/AppleAuth/TeamId` | String | `4LB4RD97A9` | hazır | — |
| `api/AppleAuth/TokenEncryptionKey` | SecureString | otomatik (32 bayt) | — | (yoksa JWT anahtarından türetilir) |
| `notifier/Push/ApnsKey` | SecureString | `CHANGE_ME` | §2.2 `.p8` | iOS push gitmez |
| `notifier/Push/ApnsKeyId` | String | `CHANGE_ME` | §2.2 Key ID | 〃 |
| `notifier/Push/ApnsTeamId` | String | `4LB4RD97A9` | hazır | — |
| `notifier/Push/ServiceAccountJson` | SecureString | `CHANGE_ME` | §4 Firebase JSON | Android push gitmez |
| `api/Store/AppAppleId` | String | (yok, elle) | §1.4 isteğe bağlı | kontrol yapılmaz |
| `api/Store/XcodeTestRootCertificate` | String | (yok, **yalnız dev**, elle) | §6 | Xcode StoreKit işlemleri reddedilir |

Ürün kimlikleri ve paket → kredi eşlemesi template.yaml `api/Store` parametresindedir (gizli değil).
Değerler Lambda'larda 60 sn içinde yeniden okunur; deploy gerekmez.

## 6. Simülatörde satın alma (Xcode StoreKit Testing)
`mobile/ios-storekit/Droblet.storekit` üç ürünü (1 haftalık ücretsiz denemeyle) içerir; `npx expo prebuild -p ios` bunu
Xcode şemasına bağlar. `ios/Droblet.xcworkspace` Xcode'da açılıp **Xcode'dan Run** edilir; işlemler Debug → StoreKit →
Manage Transactions'tan yönetilir (iade, yenileme, Ask to Buy onayı).

Bu işlemler Apple'ın değil Xcode'un yerel sertifikasıyla imzalanır. Dev API'nin kabul etmesi için: Xcode'da
`Droblet.storekit` açıkken **Editor → Save Public Certificate** → `.cer` → `base64 -i StoreKitTestCertificate.cer` →
SSM String `/droblet/dev/api/Store/XcodeTestRootCertificate`. Sunucu bu kökü **yalnız `environment = Xcode`**
işlemlere uygular; prod'da bu parametre **oluşturulmaz**.

## 7. Bilinen davranışlar
- Hesap silme mağaza aboneliğini iptal etmez (Apple/Google kuralı; uygulama kullanıcıya söyler). Aynı Apple ID /
  Google hesabıyla yeni hesap açılırsa "Satın alımları geri yükle" aboneliği yeni hesaba bağlar.
- Bir satın alma başka bir (silinmemiş) Droblet hesabına bağlıysa 409 döner; uygulama "başka bir Droblet hesabına bağlı" der.
- İade edilen kredi paketi: kalan paket kredisinden düşülür, sıfırın altına inmez; harcanmış görseller geri alınmaz.
- Abonelik bitince veri silinmez; yalnız üyelik özellikleri kapanır. Aylık 30 kredi abonelik ayına göre yenilenir, devretmez.
