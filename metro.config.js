const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const {
  LOCAL_PACKAGES,
  projectRoot,
  getCdpWebRoot,
  isAnyLinkedToCdpWeb,
} = require('./tools/cdp-local');

const config = getDefaultConfig(projectRoot);
const useLocalCdp = isAnyLinkedToCdpWeb();

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // When packages are symlinked into ../cdp-web, extraNodeModules covers static
  // imports but NOT dynamic import() — Metro re-resolves those at runtime using
  // a relative path outside the project root. Explicit resolveRequest entries
  // cover both.
  if (useLocalCdp && moduleName in LOCAL_PACKAGES) {
    const pkgDir = path.join(getCdpWebRoot(), LOCAL_PACKAGES[moduleName]);
    return {
      type: 'sourceFile',
      filePath: path.join(pkgDir, 'dist', 'esm', 'index.js'),
    };
  }

  if (moduleName.includes('zustand')) {
    const result = require.resolve(moduleName);
    return context.resolveRequest(context, result, platform);
  }

  if (moduleName.includes('rpc-websockets')) {
    const result = require.resolve(moduleName);
    return context.resolveRequest(context, result, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
  // Symlinks only needed when co-developing against a local cdp-web checkout.
  unstable_enableSymlinks: useLocalCdp,
};

if (useLocalCdp) {
  const cdpWebRoot = getCdpWebRoot();

  // Metro resolves from the real (symlink-target) path, so it would otherwise
  // hit cdp-web/node_modules first (wrong expo-modules-core, etc.).
  config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
  ];

  config.resolver.extraNodeModules = Object.fromEntries(
    Object.entries(LOCAL_PACKAGES).map(([pkgName, relPath]) => [
      pkgName,
      path.join(cdpWebRoot, relPath),
    ])
  );

  // Pick up source/dist changes while iterating in cdp-web.
  config.watchFolders = [cdpWebRoot];

  console.log(
    '[metro] Using local cdp-web packages:',
    Object.keys(LOCAL_PACKAGES).join(', ')
  );
}

module.exports = config;
