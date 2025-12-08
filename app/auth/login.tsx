/**
 * Login Screen - Branded authentication page
 *
 * Full-screen login UI with Coinbase branding.
 * Users must connect wallet to access the app.
 * TestFlight accounts auto-proceed after brief display.
 */

import { COLORS } from '@/constants/Colors';
import { isTestSessionActive } from '@/utils/sharedState';
import { useIsSignedIn } from '@coinbase/cdp-hooks';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

const { DARK_BG, CARD_BG, TEXT_PRIMARY, TEXT_SECONDARY, BLUE, WHITE, BORDER } = COLORS;

export default function LoginScreen() {
  const { isSignedIn } = useIsSignedIn();
  const router = useRouter();
  const testSession = isTestSessionActive();
  const [showTestMessage, setShowTestMessage] = useState(false);

  // TestFlight auto-login
  useEffect(() => {
    if (testSession) {
      setShowTestMessage(true);
      // Brief delay to show message, then proceed
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 1500);
    }
  }, [testSession]);

  // Real user logged in → navigate to app
  useEffect(() => {
    if (isSignedIn && !testSession) {
      router.replace('/(tabs)');
    }
  }, [isSignedIn, testSession]);

  const handleEmailLogin = () => {
    router.push({
      pathname: '/email-verify',
      params: { mode: 'signin' }
    });
  };

  const handlePhoneLogin = () => {
    router.push({
      pathname: '/phone-verify',
      params: { mode: 'signin' }
    });
  };

  // TestFlight loading state
  if (showTestMessage) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.testMessageContainer}>
            <ActivityIndicator size="large" color={BLUE} style={{ marginBottom: 16 }} />
            <Text style={styles.testTitle}>🧪 TestFlight Mode</Text>
            <Text style={styles.testSubtitle}>Test account detected{'\n'}Auto-login enabled...</Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Coinbase Logo */}
        <Image
          source={require('@/assets/images/Coinbase_Wordmark.png')}
          style={styles.logo}
          resizeMode="contain"
        />

        {/* App Title */}
        <Text style={styles.title}>Onramp V2 Demo</Text>
        <Text style={styles.subtitle}>
          Buy crypto with your wallet{'\n'}
          Powered by Coinbase Developer Platform
        </Text>

        {/* Auth Method Selection */}
        <View style={styles.authButtonsContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.authButton,
              styles.primaryAuthButton,
              pressed && { opacity: 0.85 }
            ]}
            onPress={handleEmailLogin}
          >
            <Ionicons name="mail-outline" size={24} color={WHITE} style={styles.buttonIcon} />
            <Text style={styles.authButtonText}>Continue with Email</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.authButton,
              styles.secondaryAuthButton,
              pressed && { opacity: 0.85 }
            ]}
            onPress={handlePhoneLogin}
          >
            <Ionicons name="call-outline" size={24} color={BLUE} style={styles.buttonIcon} />
            <Text style={styles.secondaryAuthButtonText}>Continue with Phone</Text>
          </Pressable>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Secure authentication via{'\n'}
            Coinbase Developer Platform SDK
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    width: 200,
    height: 50,
    marginBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    marginBottom: 12,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 64,
  },
  authButtonsContainer: {
    width: '100%',
    gap: 16,
  },
  authButton: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAuthButton: {
    backgroundColor: BLUE,
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  secondaryAuthButton: {
    backgroundColor: CARD_BG,
    borderWidth: 2,
    borderColor: BLUE,
  },
  buttonIcon: {
    marginRight: 12,
  },
  authButtonText: {
    color: WHITE,
    fontSize: 18,
    fontWeight: '600',
  },
  secondaryAuthButtonText: {
    color: BLUE,
    fontSize: 18,
    fontWeight: '600',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 18,
  },
  testMessageContainer: {
    alignItems: 'center',
    backgroundColor: CARD_BG,
    padding: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  testTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    marginBottom: 8,
  },
  testSubtitle: {
    fontSize: 16,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 24,
  },
});
