const { withAndroidManifest } = require("expo/config-plugins");

// Android 11+ hides other apps from Linking.canOpenURL unless the scheme is
// declared in <queries>. Without these, canOpenCoinbaseOnramp() stays false
// even when the Coinbase app is installed.
const ONRAMP_SCHEMES = ["com.coinbase.cdp.onramp", "com.coinbase.cdp.onramp.v2"];

function withAndroidOnrampQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest.queries) {
      manifest.queries = [{}];
    }
    const queries = manifest.queries[0];
    if (!queries.intent) {
      queries.intent = [];
    }

    for (const scheme of ONRAMP_SCHEMES) {
      const alreadyDeclared = queries.intent.some((intent) =>
        (intent.data ?? []).some((data) => data.$?.["android:scheme"] === scheme),
      );
      if (alreadyDeclared) continue;
      queries.intent.push({
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        data: [{ $: { "android:scheme": scheme } }],
      });
    }

    return config;
  });
}

module.exports = withAndroidOnrampQueries;
