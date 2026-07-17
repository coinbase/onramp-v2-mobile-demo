/**
 * Helpers for switching @coinbase/cdp-* packages between the published npm
 * tarball (default, what's committed in package.json) and a sibling cdp-web
 * checkout for rapid co-development.
 *
 * Only mutates node_modules/ (gitignored). package.json / lockfile stay on npm.
 *
 *   node tools/cdp-local.js local   # symlink → ../cdp-web/packages/...
 *   node tools/cdp-local.js npm     # reinstall from registry
 *   node tools/cdp-local.js status  # print current resolution
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

/** Packages that can be swapped for local cdp-web co-dev. */
const LOCAL_PACKAGES = {
  '@coinbase/cdp-react-native': 'packages/react-native',
  '@coinbase/cdp-app-attest': 'packages/cdp-app-attest',
};

function getCdpWebRoot() {
  return path.resolve(projectRoot, process.env.CDP_WEB_ROOT || '../cdp-web');
}

function nodeModulesPath(pkgName) {
  return path.join(projectRoot, 'node_modules', ...pkgName.split('/'));
}

/**
 * True when node_modules/<pkg> resolves into a cdp-web checkout.
 * @param {string} pkgName
 */
function isLinkedToCdpWeb(pkgName) {
  const target = nodeModulesPath(pkgName);
  try {
    if (!fs.existsSync(target)) return false;
    const real = fs.realpathSync(target);
    const marker = `${path.sep}cdp-web${path.sep}`;
    return real.includes(marker);
  } catch {
    return false;
  }
}

/** True when any LOCAL_PACKAGES entry is linked into cdp-web. */
function isAnyLinkedToCdpWeb() {
  return Object.keys(LOCAL_PACKAGES).some(isLinkedToCdpWeb);
}

function assertCdpWebCheckout(cdpWebRoot) {
  if (!fs.existsSync(path.join(cdpWebRoot, 'packages'))) {
    throw new Error(
      `cdp-web not found at ${cdpWebRoot}.\n` +
        `Clone it as a sibling of this repo, or set CDP_WEB_ROOT to its path.`
    );
  }
}

function assertBuilt(pkgDir, pkgName) {
  const entry = path.join(pkgDir, 'dist', 'esm', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(
      `${pkgName} has no dist/esm/index.js at ${pkgDir}.\n` +
        `Build it first from cdp-web (e.g. pnpm --filter ${pkgName} build).`
    );
  }
}

function linkLocal() {
  const cdpWebRoot = getCdpWebRoot();
  assertCdpWebCheckout(cdpWebRoot);

  for (const [pkgName, relPath] of Object.entries(LOCAL_PACKAGES)) {
    const pkgDir = path.join(cdpWebRoot, relPath);
    if (!fs.existsSync(pkgDir)) {
      throw new Error(`Missing local package at ${pkgDir}`);
    }
    assertBuilt(pkgDir, pkgName);

    const dest = nodeModulesPath(pkgName);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.rmSync(dest, { recursive: true, force: true });

    const relative = path.relative(path.dirname(dest), pkgDir);
    fs.symlinkSync(relative, dest, 'dir');
    console.log(`linked  ${pkgName} → ${relative}`);
  }

  console.log(
    '\nLocal CDP packages active. Restart Metro, then rebuild native if needed:\n' +
      '  npx expo start --clear\n' +
      '  npx expo run:ios   # when cdp-app-attest native code changed\n'
  );
}

function linkNpm() {
  const specs = Object.keys(LOCAL_PACKAGES)
    .map((pkgName) => {
      const version =
        require(path.join(projectRoot, 'package.json')).dependencies[pkgName];
      if (!version) {
        throw new Error(`${pkgName} missing from package.json dependencies`);
      }
      return `${pkgName}@${version}`;
    })
    .join(' ');

  for (const pkgName of Object.keys(LOCAL_PACKAGES)) {
    fs.rmSync(nodeModulesPath(pkgName), { recursive: true, force: true });
  }

  console.log(`npm install ${specs} --no-save`);
  execSync(`npm install ${specs} --no-save --no-fund --no-audit`, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  console.log(
    '\nNPM CDP packages restored. Restart Metro, then rebuild native if needed:\n' +
      '  npx expo start --clear\n' +
      '  npx expo run:ios\n'
  );
}

function printStatus() {
  const cdpWebRoot = getCdpWebRoot();
  console.log(`CDP_WEB_ROOT: ${cdpWebRoot}`);
  console.log(`exists: ${fs.existsSync(cdpWebRoot)}\n`);

  for (const pkgName of Object.keys(LOCAL_PACKAGES)) {
    const dest = nodeModulesPath(pkgName);
    if (!fs.existsSync(dest)) {
      console.log(`${pkgName}: missing`);
      continue;
    }
    const real = fs.realpathSync(dest);
    const mode = isLinkedToCdpWeb(pkgName) ? 'local' : 'npm';
    let version = '?';
    try {
      version = require(path.join(real, 'package.json')).version;
    } catch {
      // ignore
    }
    console.log(`${pkgName}: ${mode} (${version})`);
    console.log(`  → ${real}`);
  }
}

module.exports = {
  LOCAL_PACKAGES,
  projectRoot,
  getCdpWebRoot,
  isLinkedToCdpWeb,
  isAnyLinkedToCdpWeb,
  linkLocal,
  linkNpm,
  printStatus,
};

if (require.main === module) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'local') linkLocal();
    else if (cmd === 'npm') linkNpm();
    else if (cmd === 'status' || cmd === undefined) printStatus();
    else {
      console.error(`Unknown command: ${cmd}`);
      console.error('Usage: node tools/cdp-local.js [local|npm|status]');
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
