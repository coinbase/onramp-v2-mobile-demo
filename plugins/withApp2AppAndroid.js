const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Expo Config Plugin: Android App2App (Play Integrity) prerequisites
 *
 * 1. Declares <queries> so Linking.canOpenURL / canOpenCoinbaseOnramp can see
 *    Coinbase retail builds that register the CDP onramp scheme (Android 11+
 *    package visibility). Mirrors iOS LSApplicationQueriesSchemes.
 * 2. Declares the Coinbase consumer package for install detection fallbacks.
 */
function withApp2AppAndroid(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    if (!manifest['queries']) {
      manifest['queries'] = [];
    }

    let queries = manifest['queries'][0];
    if (!queries) {
      queries = {};
      manifest['queries'].push(queries);
    }

    if (!queries['intent']) {
      queries['intent'] = [];
    }
    if (!queries['package']) {
      queries['package'] = [];
    }

    const scheme = 'com.coinbase.cdp.onramp';
    const hasSchemeIntent = queries['intent'].some((intent) =>
      (intent?.['data'] || []).some(
        (data) => data?.['$']?.['android:scheme'] === scheme,
      ),
    );
    if (!hasSchemeIntent) {
      queries['intent'].push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': scheme } }],
      });
    }

    const coinbasePackage = 'com.coinbase.android';
    const hasPackage = queries['package'].some(
      (pkg) => pkg?.['$']?.['android:name'] === coinbasePackage,
    );
    if (!hasPackage) {
      queries['package'].push({
        $: { 'android:name': coinbasePackage },
      });
    }

    return config;
  });
}

module.exports = withApp2AppAndroid;
