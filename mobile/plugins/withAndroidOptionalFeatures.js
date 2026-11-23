const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Declares hardware features as NOT required, so Google Play does not hide the app from devices without them:
 * the portrait lock implies `android.hardware.screen.portrait` and the Wi-Fi state permission implies
 * `android.hardware.wifi` (tablets, Chromebooks, TVs and Ethernet-only devices would be filtered out otherwise).
 */
const OPTIONAL_FEATURES = ['android.hardware.screen.portrait', 'android.hardware.wifi'];

function withAndroidOptionalFeatures(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const features = (manifest['uses-feature'] ?? []).filter((f) => !OPTIONAL_FEATURES.includes(f.$?.['android:name']));
    for (const name of OPTIONAL_FEATURES) {
      features.push({ $: { 'android:name': name, 'android:required': 'false' } });
    }
    manifest['uses-feature'] = features;
    return cfg;
  });
}

module.exports = withAndroidOptionalFeatures;
