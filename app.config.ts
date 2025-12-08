import 'dotenv/config';
import { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
    name: 'Onramp V2 Demo',
    slug: 'onramp-v2-demo',
    version: '1.0.0',
    scheme: 'onrampdemo',
    userInterfaceStyle: 'automatic',
    newArchEnabled: false,
    icon: './assets/images/icon.png',

    ios: {
      bundleIdentifier: 'com.coinbase.cdp-onramp', 
      buildNumber: process.env.IOS_BUILD_NUMBER ?? '1.0.0', // bump each submit
      supportsTablet: false,
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false
      }
    },

    android: {
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        backgroundColor: '#ffffff'
      },
      edgeToEdgeEnabled: true,
      package: "com.coinbase.cdp-onramp"
    },

    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png'
    },

    plugins: [
      'expo-router',
      'expo-secure-store',
      ['expo-splash-screen', { image: './assets/images/splash-icon.png', imageWidth: 200, resizeMode: 'contain', backgroundColor: '#ffffff' }],
      ['expo-build-properties', { ios: { deploymentTarget: '15.1' } }],
      ['expo-notifications', {
        icon: './assets/images/icon.png',
        color: '#0052FF'
      }]
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