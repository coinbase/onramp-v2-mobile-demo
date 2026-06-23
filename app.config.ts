import 'dotenv/config';
import { ExpoConfig } from 'expo/config';
 
const withGooglePayWebView = require('./plugins/withGooglePayWebView');

const config: ExpoConfig = {
    name: 'Onramp V2 Demo',
    slug: 'onramp-v2-demo',
    version: '1.1.1',
    scheme: 'onrampdemo',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    icon: './assets/images/onrampV2Icon.png',

    ios: {
      bundleIdentifier: 'com.coinbase.cdp-onramp',
      buildNumber: process.env.IOS_BUILD_NUMBER ?? '1.0.0', // bump each submit
      supportsTablet: false,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        // Required so iOS prompts for (and grants) Local Network access. Without
        // this the app silently cannot reach LAN addresses — e.g. the dev API
        // server / Metro on the Mac's LAN IP — and requests hang forever.
        NSLocalNetworkUsageDescription:
          'Allow this demo to reach the local development API server on your network.',
        // Allow Linking.canOpenURL to probe the Coinbase retail app for the
        // app2app hand-off. Without this, canOpenURL returns false on iOS even
        // when the Coinbase app is installed. These are the Coinbase app's
        // registered app-to-app URL schemes (see its CFBundleURLSchemes).
        LSApplicationQueriesSchemes: [
          'com.coinbase.oauth.app-to-app-v3',
          'com.coinbase.oauth.app-to-app-v2',
          'cbpay',
          // Coinbase retail (consumer) app scheme — required so
          // Linking.canOpenURL can detect whether it's installed (see
          // useCoinbaseAppInstalled).
          'com.coinbase.consumer',
        ]
      },
      // Apple App Attest capability for the app2app device-attestation flow
      // (modules/app-attest → DCAppAttestService). Use 'production' for
      // App Store / TestFlight builds.
      entitlements: {
        'com.apple.developer.devicecheck.appattest-environment': 'production'
      },
      // iOS Universal Links: lets https://<host>/onramp-return (and other
      // allowlisted paths) open this app directly. The host must serve the AASA
      // file at /.well-known/apple-app-site-association (see server/api/aasa.js).
      // No protocol prefix here — Apple expects just `applinks:<host>`.
      associatedDomains: ['applinks:onramp-v2-mobile-demo-murex.vercel.app']
    },

    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#ffffff'
      },
      edgeToEdgeEnabled: true,
      package: "com.coinbase.cdp_onramp"
    },

    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png'
    },

    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-localization',
      ['expo-splash-screen', { image: './assets/images/splash-icon.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#ffffff' }],
      ['expo-build-properties', { ios: { deploymentTarget: '15.1' } }],
      ['expo-notifications', {
        icon: './assets/images/icon.png',
        color: '#0052FF'
      }],
      withGooglePayWebView,
    ],

    experiments: { typedRoutes: true },

    // Good hygiene if you later use EAS Update
    runtimeVersion: { policy: 'sdkVersion' },

    extra: {
      eas: {
        projectId: '981ff535-f8bf-4fac-97ef-1cdbc9038e85'
      }
    }
};

export default config;