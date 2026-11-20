const path = require('path');
const { AndroidConfig, withAndroidManifest, withInfoPlist, withPlugins } = require('expo/config-plugins');

/**
 * Firebase Analytics (GA4) for Droblet — product analytics next to our own first-party analytics
 * (docs/analytics-events.md). One plugin so the native setup lives in one place:
 *
 * 1. react-native-firebase's own config plugins, per platform ONLY when that platform's Firebase config
 *    file is configured (`ios.googleServicesFile` / `android.googleServicesFile`, from the
 *    GOOGLE_SERVICE_INFO_PLIST / GOOGLE_SERVICES_JSON environment variables). Their plugins throw without
 *    the file; a build without it still works, only without Firebase (the JS sink is then a no-op).
 * 2. iOS: `$RNFirebaseAnalyticsWithoutAdIdSupport = true` — the IdentitySupport / AdSupport framework is not
 *    linked, so no IDFA can be read and no App Tracking Transparency prompt is needed.
 * 3. The privacy defaults from `firebase.json` written straight into Info.plist and AndroidManifest.xml
 *    (react-native-firebase also applies firebase.json at native build time; writing them here makes them
 *    visible in `expo prebuild` / `expo config --type introspect` output and wins on Android via
 *    `tools:replace`). Collection starts OFF; the app switches it on from JS only when the user's
 *    "Ürün analitiği" choice is on (src/analytics/preference.ts).
 * The Android `com.google.android.gms.permission.AD_ID` permission that play-services-measurement merges
 * in is removed by `android.blockedPermissions` in app.config.ts (no advertising id).
 */
const firebaseJson = require('../firebase.json')['react-native'];

const flag = (key, fallback) => (typeof firebaseJson[key] === 'boolean' ? firebaseJson[key] : fallback);

/** Info.plist keys read by the Firebase iOS SDK. */
function iosPrivacyKeys() {
  return {
    FIREBASE_ANALYTICS_COLLECTION_ENABLED: flag('analytics_auto_collection_enabled', true),
    GOOGLE_ANALYTICS_ADID_COLLECTION_ENABLED: flag('google_analytics_adid_collection_enabled', true),
    GOOGLE_ANALYTICS_IDFV_COLLECTION_ENABLED: flag('analytics_idfv_collection_enabled', true),
    GOOGLE_ANALYTICS_REGISTRATION_WITH_AD_NETWORK_ENABLED: flag('google_analytics_registration_with_ad_network_enabled', true),
    GOOGLE_ANALYTICS_DEFAULT_ALLOW_ANALYTICS_STORAGE: flag('analytics_default_allow_analytics_storage', true),
    GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_STORAGE: flag('analytics_default_allow_ad_storage', true),
    GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_USER_DATA: flag('analytics_default_allow_ad_user_data', true),
    GOOGLE_ANALYTICS_DEFAULT_ALLOW_AD_PERSONALIZATION_SIGNALS: flag('analytics_default_allow_ad_personalization_signals', true),
    FirebaseAutomaticScreenReportingEnabled: flag('google_analytics_automatic_screen_reporting_enabled', true),
  };
}

/** <meta-data> names read by the Firebase Android SDK. */
function androidPrivacyMetaData() {
  return {
    firebase_analytics_collection_enabled: flag('analytics_auto_collection_enabled', true),
    google_analytics_adid_collection_enabled: flag('google_analytics_adid_collection_enabled', true),
    google_analytics_ssaid_collection_enabled: flag('google_analytics_ssaid_collection_enabled', true),
    google_analytics_automatic_screen_reporting_enabled: flag('google_analytics_automatic_screen_reporting_enabled', true),
    google_analytics_default_allow_analytics_storage: flag('analytics_default_allow_analytics_storage', true),
    google_analytics_default_allow_ad_storage: flag('analytics_default_allow_ad_storage', true),
    google_analytics_default_allow_ad_user_data: flag('analytics_default_allow_ad_user_data', true),
    google_analytics_default_allow_ad_personalization_signals: flag('analytics_default_allow_ad_personalization_signals', true),
  };
}

function withIosPrivacy(config) {
  return withInfoPlist(config, (cfg) => {
    Object.assign(cfg.modResults, iosPrivacyKeys());
    return cfg;
  });
}

function withAndroidPrivacy(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(cfg.modResults);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    for (const [name, value] of Object.entries(androidPrivacyMetaData())) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, String(value));
      const item = app['meta-data'].find((m) => m.$['android:name'] === name);
      // The library manifest declares the same names with firebase.json placeholders; ours wins.
      item.$['tools:replace'] = 'android:value';
    }
    return cfg;
  });
}

/**
 * One platform's mods of an RNFB config plugin. The packages export only `app.plugin.js` (both platforms,
 * throwing without the config file), so the per-platform builds are loaded by path.
 */
function rnfbPlugin(pkg, platform) {
  return require(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'plugin', 'build', platform));
}

/** Applies an RNFB plugin's mods for one platform only. */
function onlyIf(enabled, plugin, props) {
  return enabled ? [plugin, props] : null;
}

function withFirebaseAnalytics(config) {
  const ios = Boolean(config.ios && config.ios.googleServicesFile);
  const android = Boolean(config.android && config.android.googleServicesFile);
  const rnfbIos = rnfbPlugin('@react-native-firebase/app', 'ios');
  const rnfbAndroid = rnfbPlugin('@react-native-firebase/app', 'android');
  const rnfbAnalyticsIos = rnfbPlugin('@react-native-firebase/analytics', 'ios');

  return withPlugins(
    config,
    [
      // @react-native-firebase/app: FirebaseApp.configure() in the AppDelegate + the plist (iOS); the
      // google-services Gradle plugin + google-services.json (Android).
      onlyIf(ios, rnfbIos.withFirebaseAppDelegate),
      onlyIf(ios, rnfbIos.withIosGoogleServicesFile),
      onlyIf(android, rnfbAndroid.withBuildscriptDependency),
      onlyIf(android, rnfbAndroid.withApplyGoogleServicesPlugin),
      onlyIf(android, rnfbAndroid.withCopyAndroidGoogleServices),
      // @react-native-firebase/analytics: never link the ad id (IdentitySupport) — always, the pod is always installed.
      [rnfbAnalyticsIos.withIosWithoutAdIdSupport, { ios: { withoutAdIdSupport: true } }],
      withIosPrivacy,
      withAndroidPrivacy,
    ].filter(Boolean),
  );
}

module.exports = withFirebaseAnalytics;
module.exports.iosPrivacyKeys = iosPrivacyKeys;
module.exports.androidPrivacyMetaData = androidPrivacyMetaData;
