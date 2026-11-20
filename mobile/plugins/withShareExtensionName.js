const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withFinalizedMod } = require('expo/config-plugins');

/**
 * Finishes the iOS Share Extension's Info.plist after every other mod has run:
 * - the share sheet lists the extension by CFBundleDisplayName. expo-share-intent names the extension target after that
 *   same value, and a target called "Droblet" would collide with the app target, so the target keeps a distinct name
 *   ("DrobletShare") and only the visible name becomes the app's name;
 * - App Store Connect refuses an extension whose version / build differ from the app's: both are taken from the build
 *   settings expo-share-intent writes from the same app.json version and build number.
 * Does nothing when the extension is not generated (DROBLET_IOS_SHARE_EXTENSION unset).
 */
function withShareExtensionName(config, { targetName, displayName }) {
  return withFinalizedMod(config, [
    'ios',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, targetName, 'ShareExtension-Info.plist');
      if (!fs.existsSync(file)) return cfg;
      const info = plist.parse(fs.readFileSync(file, 'utf8'));
      info.CFBundleDisplayName = displayName;
      info.CFBundleShortVersionString = '$(MARKETING_VERSION)';
      info.CFBundleVersion = '$(CURRENT_PROJECT_VERSION)';
      fs.writeFileSync(file, plist.build(info));
      return cfg;
    },
  ]);
}

module.exports = withShareExtensionName;
