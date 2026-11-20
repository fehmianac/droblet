import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * App identity (owner decision 2026-11-18, closes A-10). Never changes after store registration.
 * Runtime endpoints come from the environment (see `.env.example`), never from source.
 *
 * The static values the release workflow reads and rewrites with jq live in `app.json` — name, slug,
 * version, ios.bundleIdentifier / buildNumber / config.usesNonExemptEncryption, android.package /
 * versionCode. Expo loads app.json first and passes it in as `config`; this file BUILDS ON it and
 * never overrides those values.
 */
const SCHEME = 'droplet';
const LINK_DOMAIN = 'droblet.alatech.co';

/** = `CREAM` in src/theme/tokens.ts (app config is evaluated by Node and cannot import app TS). */
const CREAM = '#F4F1EC';
/** = `ink` in src/theme/tokens.ts. */
const INK = '#1C1A17';

/** EAS project id (push registration, EAS services) — present only when the environment provides it. */
const easProjectId = process.env.EAS_PROJECT_ID;

/**
 * Firebase Android config (FCM push token). EAS: a file environment variable GOOGLE_SERVICES_JSON;
 * locally: GOOGLE_SERVICES_JSON=./google-services.json (the file is git-ignored). Without it Android builds
 * still work, only without push.
 */
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || undefined;

/** APNs environment of the build: production for store / TestFlight builds, development otherwise. */
const apsMode: 'production' | 'development' =
  process.env.EAS_BUILD_PROFILE === 'production' || process.env.EAS_BUILD_PROFILE === 'preview' ? 'production' : 'development';

/** Reversed iOS OAuth client id, e.g. com.googleusercontent.apps.123-abc — the redirect scheme of Google sign-in. */
const GOOGLE_IOS_SCHEME = process.env.DROBLET_GOOGLE_IOS_CLIENT_ID
  ? process.env.DROBLET_GOOGLE_IOS_CLIENT_ID.split('.').reverse().join('.')
  : null;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  // From app.json; the fallbacks only satisfy the type when the file is evaluated without it.
  name: config.name ?? 'Droblet',
  slug: config.slug ?? 'droblet',
  version: config.version,
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  // Google sign-in returns to the app through the reversed iOS client id (com.googleusercontent.apps.…).
  scheme: GOOGLE_IOS_SCHEME ? [SCHEME, GOOGLE_IOS_SCHEME] : SCHEME,
  // No dark mode in phase 1 (README §9.1, A-9). Tokens are structured so a dark palette can be added.
  userInterfaceStyle: 'light',
  backgroundColor: CREAM,
  locales: {
    tr: './locales/ios/tr.json',
    en: './locales/ios/en.json',
  },
  ios: {
    // bundleIdentifier, buildNumber and config.usesNonExemptEncryption come from app.json.
    ...config.ios,
    icon: './assets/expo.icon',
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${LINK_DOMAIN}`],
    supportsTablet: false,
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    // package and versionCode come from app.json.
    ...config.android,
    adaptiveIcon: {
      // Logo B: the cream hanger "D" + drop on the ink tile (canvas v2 `Logo.dc.html`). Regenerate with scripts/render-brand-assets.mjs.
      backgroundColor: INK,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    // expo-contacts also adds WRITE_CONTACTS; contacts matching only reads e-mail addresses.
    blockedPermissions: ['android.permission.WRITE_CONTACTS'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: LINK_DOMAIN }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: CREAM,
        image: './assets/images/splash-icon.png',
        // = MARK_WIDTH in src/components/brand/AnimatedSplash.tsx, so the hand-over does not jump.
        imageWidth: 92,
      },
    ],
    'expo-secure-store',
    'expo-localization',
    'expo-apple-authentication',
    'expo-web-browser',
    // StoreKit 2 / Google Play Billing (open-source native module, no hosted purchase service).
    ['expo-iap', { module: 'expo-iap' }],
    // Device push tokens: APNs on iOS (aps-environment), FCM on Android; the server sends directly.
    ['expo-notifications', { mode: apsMode, color: INK, defaultChannel: 'default' }],
    // Local iOS simulator purchases with ios-storekit/Droblet.storekit (Xcode runs only; skipped on EAS).
    './plugins/withStoreKitConfig.js',
    [
      'expo-image-picker',
      {
        // Default (TR) strings; per-language strings live in ./locales/ios/*.json.
        photosPermission:
          'Boy ve yüz fotoğrafını seçebilmen için galerine erişmemiz gerekiyor. Fotoğrafların yalnızca sana açıktır.',
        cameraPermission:
          'Boy fotoğrafını ve parçalarını çekebilmen için kameraya erişmemiz gerekiyor.',
        microphonePermission: false,
      },
    ],
    [
      // 12 Parça ekle: the in-app live camera (photos only — no audio, no barcode scanning).
      'expo-camera',
      {
        // Default (TR) string; per-language strings live in ./locales/ios/*.json.
        cameraPermission: 'Boy fotoğrafını ve parçalarını çekebilmen için kameraya erişmemiz gerekiyor.',
        microphonePermission: false,
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ],
    [
      'expo-contacts',
      {
        // Default (TR) string; per-language strings live in ./locales/ios/*.json. Asked only after
        // the in-app consent screen (friends/contacts) — owner decision 13.
        contactsPermission:
          'Rehberindeki e-posta adreslerinden Droblet’te olan arkadaşlarını bulmak için. Adresler telefonunda karma değerine dönüştürülür; rehberin gönderilmez ve saklanmaz.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    ...config.extra,
    ...(easProjectId ? { eas: { ...(config.extra?.eas as Record<string, unknown> | undefined), projectId: easProjectId } } : {}),
    apiBaseUrl: process.env.DROBLET_API_BASE_URL ?? null,
    linkDomain: LINK_DOMAIN,
    termsUrl: process.env.DROBLET_TERMS_URL ?? null,
    privacyUrl: process.env.DROBLET_PRIVACY_URL ?? null,
    googleClientIds: {
      ios: process.env.DROBLET_GOOGLE_IOS_CLIENT_ID ?? null,
      android: process.env.DROBLET_GOOGLE_ANDROID_CLIENT_ID ?? null,
      web: process.env.DROBLET_GOOGLE_WEB_CLIENT_ID ?? null,
    },
  },
});
