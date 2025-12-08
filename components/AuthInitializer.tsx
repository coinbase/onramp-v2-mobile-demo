/**
 * Auth Initializer Component
 *
 * Initializes:
 * - Global access token getter for API calls
 * - Push notification registration
 *
 * Must be placed inside CDPHooksProvider to access useGetAccessToken.
 *
 * Usage:
 * <CDPHooksProvider>
 *   <AuthInitializer>
 *     <YourApp />
 *   </AuthInitializer>
 * </CDPHooksProvider>
 */

import { useGetAccessToken, useCurrentUser } from '@coinbase/cdp-hooks';
import { initializeAccessTokenGetter } from '@/utils/getAccessTokenGlobal';
import { registerForPushNotifications, sendPushTokenToServer } from '@/utils/pushNotifications';
import { useEffect } from 'react';

export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { getAccessToken } = useGetAccessToken();
  const { currentUser } = useCurrentUser();

  console.log('🔍 [AUTH INITIALIZER] Component rendered, currentUser:', {
    hasUser: !!currentUser,
    userId: currentUser?.userId
  });

  useEffect(() => {
    // Initialize the global token getter once
    initializeAccessTokenGetter(getAccessToken);
    console.log('✅ [AUTH INITIALIZER] Access token getter initialized');
  }, [getAccessToken]);

  // Register for push notifications when user logs in
  // REVERTED TO SIMPLE Oct 27 approach that worked with CDP 0.0.42
  // Added server-side logging via ping endpoint for TestFlight debugging
  useEffect(() => {
    // Send ping to show useEffect fired (visible in Vercel logs)
    fetch(`${process.env.EXPO_PUBLIC_BASE_URL}/push-tokens/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'AuthInitializer-useEffect',
        hasUserId: !!currentUser?.userId,
        userId: currentUser?.userId,
        timestamp: new Date().toISOString()
      })
    }).catch(() => {});

    if (currentUser?.userId) {
      // Use userId as partnerUserRef (matches transaction format)
      const partnerUserRef = currentUser.userId;

      console.log('📱 [APP] Registering push notifications for user:', partnerUserRef);

      // Send ping before registerForPushNotifications to confirm we reached this point
      fetch(`${process.env.EXPO_PUBLIC_BASE_URL}/push-tokens/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'AuthInitializer-before-register',
          userId: partnerUserRef,
          timestamp: new Date().toISOString()
        })
      }).catch(() => {});

      registerForPushNotifications().then(async (result) => {
        // Send ping with result
        fetch(`${process.env.EXPO_PUBLIC_BASE_URL}/push-tokens/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'AuthInitializer-after-register',
            userId: partnerUserRef,
            hasResult: !!result,
            resultType: result?.type,
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});

        if (result) {
          console.log('✅ [APP] Push token obtained, sending to server:', partnerUserRef, `(${result.type})`);
          await sendPushTokenToServer(result.token, partnerUserRef, getAccessToken, result.type);
          console.log('✅ [APP] Push token successfully sent to server');
        } else {
          console.log('ℹ️ [APP] No push token (likely simulator or permission denied)');
        }
      }).catch((error) => {
        console.error('❌ [APP] Failed to register push notifications:', error);
        // Send ping with error
        fetch(`${process.env.EXPO_PUBLIC_BASE_URL}/push-tokens/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'AuthInitializer-error',
            userId: partnerUserRef,
            error: error?.message || 'Unknown error',
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});
      });
    } else {
      console.log('⚠️ [APP] No currentUser.userId, skipping push notification setup');
    }
  }, [currentUser?.userId, getAccessToken]); // Back to simple deps that worked

  return <>{children}</>;
}
