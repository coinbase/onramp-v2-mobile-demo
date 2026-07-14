const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
// cdp-app-attest and cdp-react-native are file: symlinks into this repo
const cdpWebRoot = path.resolve(projectRoot, '../cdp-web');

const config = getDefaultConfig(projectRoot);

// Simple resolver matching working demo - NO ALIASES
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.includes("zustand")) {
    const result = require.resolve(moduleName);
    return context.resolveRequest(context, result, platform);
  }

  if (moduleName.includes("rpc-websockets")) {
    const result = require.resolve(moduleName);
    return context.resolveRequest(context, result, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.resolver = {
  ...config.resolver,
  unstable_enableSymlinks: true,
  unstable_enablePackageExports: true,
  // When Metro resolves imports from inside cdp-web package source files it
  // traverses up from the real (symlink-target) path, so it hits
  // cdp-web/node_modules first. Listing the project's node_modules here
  // ensures we get the correct versions (e.g. expo-modules-core v3, not v2.5).
  nodeModulesPaths: [path.resolve(projectRoot, 'node_modules')],
  // Explicit real-path mapping for file: symlinks. unstable_enableSymlinks
  // alone is unreliable; extraNodeModules bypasses symlink traversal entirely.
  extraNodeModules: {
    '@coinbase/cdp-app-attest': path.resolve(projectRoot, '../cdp-web/packages/cdp-app-attest'),
    '@coinbase/cdp-react-native': path.resolve(projectRoot, '../cdp-web/packages/react-native'),
  },
};

// Watch cdp-web so Metro picks up source changes during co-development
config.watchFolders = [cdpWebRoot];

module.exports = config;