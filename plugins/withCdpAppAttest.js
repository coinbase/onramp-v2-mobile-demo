const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// @coinbase/cdp-app-attest is installed as a file: symlink pointing into
// ../cdp-web/. Node follows the symlink when resolving modules, so Expo
// autolinking finds expo-modules-core v2.5.0 inside cdp-web/node_modules
// instead of the project-local v3.x. Pre-declaring the pod before
// use_expo_modules! causes autolinking to skip its own resolution (see
// autolinking_manager.rb line 55: "already added to the target → skip").
const EXPO_MODULES_CORE_POD = [
  "  # Pre-declare ExpoModulesCore so Expo autolinking uses the project-local",
  "  # version instead of the one found via the cdp-app-attest symlink path.",
  "  pod 'ExpoModulesCore', :path => '../node_modules/expo-modules-core'",
  "",
  "  use_expo_modules!",
].join('\n');

// CdpAppAttest.podspec sets static_framework=true + DEFINES_MODULE=YES, which
// forces the Swift compiler to process ExpoModulesCore's module map. That
// umbrella header includes ExpoBridgeModule.h, which does:
//   #import <React/React-Core-umbrella.h>
// With prebuilt React Native (RCT_USE_PREBUILT_RNCORE=1) the umbrella header
// lives inside React.xcframework at React_Core/React_Core-umbrella.h — not at
// the bare React/ path — so the build fails. Wrapping in __has_include makes
// it a no-op on that code path (it's only needed for the old Bridge, which
// New Architecture doesn't use).
const BRIDGE_MODULE_PATCH = `
    bridge_module_header = "\#{installer.config.installation_root}/Pods/Headers/Public/ExpoModulesCore/ExpoModulesCore/ExpoBridgeModule.h"
    if File.exist?(bridge_module_header)
      content = File.read(bridge_module_header)
      if content.include?('#import <React/React-Core-umbrella.h>') && !content.include?('__has_include')
        patched = content.gsub(
          '#import <React/React-Core-umbrella.h>',
          "#if __has_include(<React/React-Core-umbrella.h>)\\n#import <React/React-Core-umbrella.h>\\n#endif"
        )
        File.write(bridge_module_header, patched)
      end
    end`;

function withCdpAppAttest(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf-8');

      // 1. Insert ExpoModulesCore pod declaration before use_expo_modules!
      if (!contents.includes("pod 'ExpoModulesCore'")) {
        contents = contents.replace(
          /^  use_expo_modules!$/m,
          EXPO_MODULES_CORE_POD
        );
      }

      // 2. Append bridge module header patch at the end of the post_install block.
      //    The generated Podfile always ends with `  end\nend\n` (post_install
      //    close + target close). Insert our Ruby just before that boundary.
      if (!contents.includes('bridge_module_header')) {
        contents = contents.replace(
          /\n  end\nend\n?$/,
          '\n' + BRIDGE_MODULE_PATCH + '\n  end\nend\n'
        );
      }

      fs.writeFileSync(podfilePath, contents);
      return config;
    },
  ]);
}

module.exports = withCdpAppAttest;
