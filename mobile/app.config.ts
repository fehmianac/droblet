import type { ConfigContext, ExpoConfig } from 'expo/config';


/**
 * App identity (owner decision 2026-11-18, closes A-10). Never changes after store registration.
 * Runtime endpoints come from the environment (see `.env.example`), never from source.
 */
const BUNDLE_ID = 'com.alatech.droplet';
const SCHEME = 'droplet';
const LINK_DOMAIN = 'droplet.alatech.co';

/** = `CREAM` in src/theme/tokens.ts (app config is evaluated by Node and cannot import app TS). */
const CREAM = '#F4F1EC';
/** = `ink` in src/theme/tokens.ts. */
const INK = '#1C1A17';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Droblet',
  slug: 'droblet',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: SCHEME,
  // No dark mode in phase 1 (README §9.1, A-9). Tokens are structured so a dark palette can be added.
  userInterfaceStyle: 'light',
  backgroundColor: CREAM,
  locales: {
    tr: './locales/ios/tr.json',
    en: './locales/ios/en.json',
  },
  ios: {
    bundleIdentifier: BUNDLE_ID,
    icon: './assets/expo.icon',
    usesAppleSignIn: true,
    associatedDomains: [`applinks:${LINK_DOMAIN}`],
    supportsTablet: false,
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      // Default icon: cream drop on ink (canvas v2 `LogoIkon`). Regenerate with scripts/render-brand-assets.mjs.
      backgroundColor: INK,
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
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
        // = MARK_HEIGHT × 36/50 in src/components/brand/AnimatedSplash.tsx, so the hand-over does not jump.
        imageWidth: 92,
      },
    ],
    'expo-secure-store',
    'expo-localization',
    'expo-apple-authentication',
    'expo-web-browser',
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
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
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
