const { withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');

/**
 * Expo Config Plugin: Google Pay in Android WebView
 *
 * Implements the requirements from:
 * https://developers.google.com/pay/api/android/guides/recipes/using-android-webview
 *
 * 1. Adds <queries> intents for Payment Request API to AndroidManifest.xml
 * 2. Adds androidx.webkit:webkit:1.14.0 gradle dependency
 */

function withGooglePayWebView(config) {
  // Step 1: Add <queries> to AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // Ensure queries array exists
    if (!manifest['queries']) {
      manifest['queries'] = [];
    }

    const paymentIntents = [
      'org.chromium.intent.action.PAY',
      'org.chromium.intent.action.IS_READY_TO_PAY',
      'org.chromium.intent.action.UPDATE_PAYMENT_DETAILS',
    ];

    // Find or create the queries element
    let queries = manifest['queries'][0];
    if (!queries) {
      queries = {};
      manifest['queries'].push(queries);
    }

    if (!queries['intent']) {
      queries['intent'] = [];
    }

    // Add each intent if not already present
    for (const action of paymentIntents) {
      const exists = queries['intent'].some(
        (intent) => intent?.['action']?.[0]?.['$']?.['android:name'] === action
      );
      if (!exists) {
        queries['intent'].push({
          action: [{ $: { 'android:name': action } }],
        });
      }
    }

    return config;
  });

  // Step 2: Add androidx.webkit dependency to app/build.gradle
  config = withAppBuildGradle(config, (config) => {
    const dep = "implementation 'androidx.webkit:webkit:1.14.0'";
    if (!config.modResults.contents.includes('androidx.webkit:webkit')) {
      config.modResults.contents = config.modResults.contents.replace(
        /dependencies\s*{/,
        `dependencies {\n    ${dep}`
      );
    }
    return config;
  });

  return config;
}

module.exports = withGooglePayWebView;
