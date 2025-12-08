import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Push Notification Utilities
 *
 * Handles:
 * - Push token registration
 * - Permission requests
 * - Notification display configuration
 * - Token storage (for webhook usage)
 */

// Configure how notifications are displayed when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Helper: Get EAS project ID from multiple sources
 */
function getProjectId(): string | undefined {
  const fromEasConfig = (Constants as any).easConfig?.projectId;
  const fromExpoConfig = (Constants as any).expoConfig?.extra?.eas?.projectId;
  const fromEnv = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  return fromEasConfig ?? fromExpoConfig ?? fromEnv;
}

/**
 * Helper: Determine runtime environment
 */
function getRuntimeKind(): 'expo-go' | 'dev-build' | 'standalone' {
  const own = Constants.appOwnership;
  if (own === 'expo') return 'expo-go';
  if (own === 'guest') return 'dev-build';
  return 'standalone';
}

/**
 * Helper: Send debug ping to server
 */
async function ping(source: string, payload: any = {}) {
  try {
    await fetch(`${process.env.EXPO_PUBLIC_BASE_URL}/push-tokens/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, ...payload, ts: new Date().toISOString() }),
    });
  } catch {}
}

/**
 * Request notification permissions and get push token
 * Returns the appropriate push token based on environment:
 * - Standalone builds: Native device token (for direct APNs/FCM)
 * - Expo Go: Expo push token (for Expo push service)
 *
 * Enhanced with comprehensive debugging for TestFlight troubleshooting
 */
export async function registerForPushNotifications(): Promise<{ token: string; type: 'native' | 'expo' } | null> {
  try {
    // Skip push notification registration on simulator
    // BUGFIX: Constants.isDevice can be unreliable in TestFlight builds
    // In production/TestFlight, always attempt registration even if isDevice is false
    const isProduction = !__DEV__;
    const shouldSkip = !Constants.isDevice && !isProduction;

    if (shouldSkip) {
      await ping('register-skip-simulator', { isDevice: Constants.isDevice, isProduction });
      console.log('ℹ️ [PUSH] Skipping push notification registration on simulator (requires real device)');
      return null;
    }

    await ping('register-proceeding', {
      isDevice: Constants.isDevice,
      isProduction,
      platform: Platform.OS,
      note: 'Proceeding despite isDevice check (production build)'
    });
    console.log('🔍 [PUSH] Proceeding with registration - isDevice:', Constants.isDevice, '| isProduction:', isProduction);

    const runtime = getRuntimeKind();
    await ping('register-start', {
      runtime,
      appOwnership: Constants.appOwnership,
      bundleId: (Constants as any).expoConfig?.ios?.bundleIdentifier,
    });
    console.log('🔍 [PUSH] Starting registration - Runtime:', runtime);

    // 1) Check existing permissions
    const perms0 = await Notifications.getPermissionsAsync();
    await ping('perm-status-initial', perms0);
    console.log('🔍 [PUSH] Initial permission status:', perms0.status);

    let finalStatus = perms0.status;
    if (finalStatus !== 'granted') {
      console.log('📱 [PUSH] Requesting permissions...');
      const req = await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: true, allowAnnouncements: true } as any,
      });
      finalStatus = req.status;
      await ping('perm-status-requested', req);
      console.log('📱 [PUSH] Permission request result:', req.status);
    }

    if (finalStatus !== 'granted') {
      await ping('perm-denied', { finalStatus });
      console.log('⚠️ [PUSH] Permission not granted for push notifications. Status:', finalStatus);
      return null;
    }

    // 2) Get push token based on runtime environment
    const wantExpoToken = runtime !== 'standalone';
    try {
      if (wantExpoToken) {
        // Expo Go or dev build: Get Expo push token
        const projectId = getProjectId();
        if (!projectId) {
          await ping('expo-token-missing-projectId');
          console.error('❌ [PUSH] No EAS project ID found');
          return null;
        }
        const tok = await Notifications.getExpoPushTokenAsync({ projectId });
        await ping('expo-token-success', { len: tok.data?.length });
        console.log('✅ [PUSH] Expo push token obtained:', tok.data);
        return { token: tok.data, type: 'expo' };
      } else {
        // Standalone build: Get native device token (for direct APNs)
        const tok = await Notifications.getDevicePushTokenAsync();
        await ping('native-token-success', { type: tok.type, len: tok.data?.length });
        console.log('✅ [PUSH] Native device push token obtained:', tok.data);
        console.log('📱 [PUSH] Build environment - isDevice:', Constants.isDevice, '| Platform:', Platform.OS);

        // iOS-specific: Register notification categories
        if (Platform.OS === 'ios') {
          await Notifications.setNotificationCategoryAsync('transaction', [
            {
              identifier: 'view',
              buttonTitle: 'View Details',
              options: {
                opensAppToForeground: true,
              },
            },
          ]);
        }

        return { token: tok.data, type: 'native' };
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      await ping('token-fetch-error', {
        runtime,
        platform: Platform.OS,
        message: msg,
        stack: e?.stack?.slice?.(0, 500),
      });
      console.error('❌ [PUSH] Error fetching token:', msg);

      // Helpful hint if it's the common APNs entitlement issue
      if (Platform.OS === 'ios' && /aps-environment/i.test(msg)) {
        await ping('hint-missing-aps-environment', { note: 'Check archive entitlements: production' });
        console.error('💡 [PUSH] HINT: Missing aps-environment entitlement. Check Xcode archive entitlements - should be "production"');
      }
      return null;
    }
  } catch (e: any) {
    await ping('register-unexpected-error', { message: String(e?.message ?? e) });
    console.error('❌ [PUSH] Unexpected error registering for push notifications:', e);
    return null;
  }
}

/**
 * Send push token to server for webhook notifications
 */
export async function sendPushTokenToServer(pushToken: string, userId: string, getAccessToken: () => Promise<string | null>, tokenType: 'native' | 'expo' = 'native'): Promise<void> {
  try {
    const accessToken = await getAccessToken();

    if (!accessToken) {
      console.warn('⚠️ [PUSH] No access token available, skipping push token registration');
      return;
    }

    const response = await fetch(`${process.env.EXPO_PUBLIC_BASE_URL}/push-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        userId,
        pushToken,
        platform: Platform.OS,
        tokenType, // Tell server which type of token this is
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send push token: ${response.status}`);
    }

    console.log('✅ [PUSH] Push token sent to server');
  } catch (error) {
    console.error('❌ [PUSH] Error sending push token to server:', error);
  }
}

/**
 * Show local notification (for testing)
 */
export async function showLocalNotification(title: string, body: string, data?: any): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: true,
      data,
    },
    trigger: null, // Show immediately
  });
}
