/**
 * Auth Gate - Enforces authentication before app access
 *
 * Wraps the entire app to ensure users are logged in.
 * Shows loading spinner while checking auth status.
 * Redirects to login screen if not authenticated.
 *
 * TestFlight accounts bypass this check automatically.
 */

import { COLORS } from '@/constants/Colors';
import { isTestSessionActive } from '@/utils/sharedState';
import { useIsInitialized, useIsSignedIn } from '@coinbase/cdp-hooks';
import { useRootNavigationState, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const { DARK_BG, BLUE } = COLORS;

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { isSignedIn } = useIsSignedIn();
  const { isInitialized } = useIsInitialized();
  const segments = useSegments();
  const navigationState = useRootNavigationState();
  const testSession = isTestSessionActive();
  const [isReady, setIsReady] = useState(false);
  const [hasCheckedAuth, setHasCheckedAuth] = useState(false);

  // TestFlight bypass OR real CDP auth
  const isAuthenticated = testSession || isSignedIn;

  // Track when isSignedIn changes unexpectedly
  useEffect(() => {
    console.log('🔐 [AUTH GATE] isSignedIn changed:', {
      isSignedIn,
      testSession,
      isAuthenticated,
      isInitialized,
      hasCheckedAuth,
      timestamp: new Date().toISOString()
    });
  }, [isSignedIn]);

  // Wait for navigation to be ready before attempting any navigation
  useEffect(() => {
    if (navigationState?.key) {
      setIsReady(true);
    }
  }, [navigationState?.key]);

  // Add a delay after initialization to let CDP load stored credentials
  useEffect(() => {
    if (isInitialized) {
      // Give CDP time to load stored credentials before checking auth
      const timer = setTimeout(() => {
        console.log('✅ [AUTH GATE] Credential loading delay complete');
        setHasCheckedAuth(true);
      }, 2000); // 2 seconds - increased for CDP session loading
      return () => clearTimeout(timer);
    }
  }, [isInitialized]);

  useEffect(() => {
    // Only run navigation logic after the router is ready
    if (!isReady) {
      console.log('⏳ [AUTH GATE] Router not ready');
      return;
    }

    // Wait for CDP to initialize before making auth decisions
    if (!isInitialized) {
      console.log('⏳ [AUTH GATE] Waiting for CDP SDK to initialize...');
      return;
    }

    // Wait for credential loading delay
    if (!hasCheckedAuth) {
      console.log('⏳ [AUTH GATE] Waiting for CDP to load stored credentials...');
      return;
    }

    // Additional safety: Don't run auth checks too frequently
    // This prevents rapid re-checks during navigation transitions
    console.log('✅ [AUTH GATE] All initialization complete, running auth check');

    const inAuthGroup = segments[0] === 'auth';

    // Allow unauthenticated access to email/phone verification flows (for sign-in)
    const publicRoutes = ['email-verify', 'email-code', 'phone-verify', 'phone-code'];
    const isPublicRoute = publicRoutes.includes(segments[0]);

    console.log('🔍 [AUTH GATE] Auth check:', {
      isAuthenticated,
      isSignedIn,
      testSession,
      inAuthGroup,
      isPublicRoute,
      segments: segments.join('/'),
      timestamp: new Date().toISOString()
    });

    if (!isAuthenticated && !inAuthGroup && !isPublicRoute) {
      // Not logged in and not on login/public screen → redirect
      console.warn('🚫 [AUTH GATE] LOGGING OUT USER - Not authenticated', {
        isSignedIn,
        testSession,
        currentPath: segments.join('/'),
        timestamp: new Date().toISOString()
      });
      // Use setTimeout to defer navigation to next tick
      setTimeout(() => {
        try {
          const router = require('expo-router').router;
          router.replace('/auth/login');
        } catch (e) {
          console.error('Navigation error:', e);
        }
      }, 0);
    } else if (isAuthenticated && inAuthGroup) {
      // Logged in but still on login screen → redirect to home
      console.log('✅ [AUTH GATE] Already authenticated, redirecting to home');
      setTimeout(() => {
        try {
          const router = require('expo-router').router;
          router.replace('/(tabs)');
        } catch (e) {
          console.error('Navigation error:', e);
        }
      }, 0);
    }
  }, [isReady, isInitialized, hasCheckedAuth, isAuthenticated, isSignedIn, testSession, segments]);

  // Show loading spinner while navigation or CDP is initializing or loading credentials
  if (!isReady || !isInitialized || !hasCheckedAuth) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={BLUE} />
        <View style={styles.debugBox}>
          <View style={styles.debugRow}>
            <View style={[styles.dot, isReady ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.debugText}>Navigation Ready</Text>
          </View>
          <View style={styles.debugRow}>
            <View style={[styles.dot, isInitialized ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.debugText}>CDP Initialized</Text>
          </View>
          <View style={styles.debugRow}>
            <View style={[styles.dot, hasCheckedAuth ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.debugText}>Credentials Loaded</Text>
          </View>
          <View style={styles.debugRow}>
            <View style={[styles.dot, testSession ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.debugText}>Test Session</Text>
          </View>
          <View style={styles.debugRow}>
            <View style={[styles.dot, isSignedIn ? styles.dotGreen : styles.dotRed]} />
            <Text style={styles.debugText}>CDP Signed In</Text>
          </View>
        </View>
      </View>
    );
  }

  // Navigation ready → render children (let navigation happen via useEffect)
  return <>{children}</>;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: DARK_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  debugBox: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    gap: 8,
  },
  debugRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  debugText: {
    fontSize: 12,
    color: '#999',
  },
  debugHint: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
    lineHeight: 16,
    paddingHorizontal: 20,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotGreen: {
    backgroundColor: '#4CAF50',
  },
  dotRed: {
    backgroundColor: '#F44336',
  },
});
