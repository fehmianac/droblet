const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Local iOS testing only: copies `ios-storekit/Droblet.storekit` into the generated Xcode project and
 * points the app scheme's Run action at it, so the three Droblet products can be bought on the
 * simulator without App Store Connect (Xcode → Product → Run; `expo run:ios` does not apply a StoreKit
 * configuration). Release / EAS builds are unaffected: a scheme's StoreKit file is only used when Xcode
 * launches the app. Skipped on EAS (EAS_BUILD=true) and when DROBLET_STOREKIT=0.
 *
 * Transactions signed by Xcode chain to a local "StoreKit Testing in Xcode" root, not Apple's: the dev
 * API accepts them only when Store:XcodeTestRootCertificate is set (docs/store-setup.md §6).
 */
const SOURCE = path.join('ios-storekit', 'Droblet.storekit');

function withStoreKitConfig(config) {
  if (process.env.EAS_BUILD === 'true' || process.env.DROBLET_STOREKIT === '0') return config;
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const { projectRoot, platformProjectRoot, projectName } = cfg.modRequest;
      const source = path.join(projectRoot, SOURCE);
      if (!projectName || !fs.existsSync(source)) return cfg;

      const target = path.join(platformProjectRoot, projectName, 'Droblet.storekit');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);

      const scheme = path.join(platformProjectRoot, `${projectName}.xcodeproj`, 'xcshareddata', 'xcschemes', `${projectName}.xcscheme`);
      if (!fs.existsSync(scheme)) return cfg;
      let xml = fs.readFileSync(scheme, 'utf8');
      if (!xml.includes('StoreKitConfigurationFileReference')) {
        // Path is relative to the project's embedded workspace (<name>.xcodeproj/project.xcworkspace).
        const reference =
          `      <StoreKitConfigurationFileReference\n` +
          `         identifier = "../../${projectName}/Droblet.storekit">\n` +
          `      </StoreKitConfigurationFileReference>\n`;
        xml = xml.replace(/(<LaunchAction[\s\S]*?)(\s*<\/LaunchAction>)/, (_, body, end) => `${body}\n${reference.trimEnd()}${end}`);
        fs.writeFileSync(scheme, xml);
      }
      return cfg;
    },
  ]);
}

module.exports = withStoreKitConfig;
