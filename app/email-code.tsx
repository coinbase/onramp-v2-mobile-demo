import { useCurrentUser, useIsInitialized, useSignInWithEmail, useVerifyEmailOTP, useLinkEmail } from '@coinbase/cdp-hooks';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CoinbaseAlert } from '../components/ui/CoinbaseAlerts';
import { COLORS } from '../constants/Colors';
import { isTestAccount, TEST_ACCOUNTS } from '../constants/TestAccounts';
import { setCurrentSolanaAddress, setCurrentWalletAddress, setTestSession } from '../utils/sharedState';

const { DARK_BG, CARD_BG, TEXT_PRIMARY, TEXT_SECONDARY, BORDER, BLUE, WHITE } = COLORS;
const RESEND_SECONDS = 30;

export default function EmailCodeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const email = params.email as string;
  const flowId = params.flowId as string;
  const mode = (params.mode as 'signin' | 'link') || 'signin'; // Default to signin for new flow

  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [sending, setSending] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(RESEND_SECONDS);
  const [alert, setAlert] = useState<{visible:boolean; title:string; message:string; type:'success'|'error'|'info'}>({
    visible:false, title:'', message:'', type:'info'
  });

  // CDP hooks - use different hook based on mode (use same verify hook for both)
  const { signInWithEmail } = useSignInWithEmail();
  const { verifyEmailOTP } = useVerifyEmailOTP();
  const { linkEmail } = useLinkEmail();
  const { currentUser } = useCurrentUser();
  const { isInitialized } = useIsInitialized();

  const canResend = resendSeconds <= 0 && !sending && !verifying;

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const t = setInterval(() => setResendSeconds(s => s - 1), 1000);
    return () => clearInterval(t);
  }, [resendSeconds]);

  const resendCode = async () => {
    // Skip resend for test accounts
    if (isTestAccount(email)) {
      setResendSeconds(RESEND_SECONDS);
      return;
    }

    setSending(true);
    try {
      console.log(`📤 [Email Resend] Resending code for ${mode} flow`);

      let result;
      if (mode === 'signin') {
        result = await signInWithEmail({ email });
      } else {
        result = await linkEmail(email); // linkEmail takes string directly
      }

      console.log('✅ [Email Resend] Email sent successfully');
      setResendSeconds(RESEND_SECONDS);
    } catch (e: any) {
      console.error('❌ [Email Resend] Error:', e);

      // Handle METHOD_ALREADY_LINKED - already linked, just reset timer
      if (e.code === 'METHOD_ALREADY_LINKED') {
        setResendSeconds(RESEND_SECONDS);
        return;
      }

      setAlert({
        visible: true,
        title: 'Error',
        message: e.message || 'Failed to resend email',
        type: 'error'
      });
    } finally {
      setSending(false);
    }
  };

  const verifyEmail = async () => {
    if (!flowId || !otp) return;
    setVerifying(true);
    try {
      // Check if this is a test account (TestFlight) - only for signin mode
      if (isTestAccount(email) && mode === 'signin') {
        console.log('🧪 Test account detected, activating mock session');

        // Verify OTP matches
        if (otp !== TEST_ACCOUNTS.otp) {
          throw new Error(`Test account OTP must be: ${TEST_ACCOUNTS.otp}`);
        }

        // Set up mock session (no CDP involved)
        await setTestSession(TEST_ACCOUNTS.wallets.evm, TEST_ACCOUNTS.wallets.solana);
        setCurrentWalletAddress(TEST_ACCOUNTS.wallets.evm);
        setCurrentSolanaAddress(TEST_ACCOUNTS.wallets.solana);

        setAlert({
          visible: true,
          title: 'TestFlight Mode',
          message: `Welcome, TestFlight Reviewer!\n\nTest Credentials:\n• Email: ${TEST_ACCOUNTS.email}\n• OTP: ${TEST_ACCOUNTS.otp}\n• Phone: ${TEST_ACCOUNTS.phone}\n• SMS Code: ${TEST_ACCOUNTS.smsCode}\n\nYou can test the full production flow without payment.`,
          type: 'info'
        });

        // Navigate immediately
        router.dismissAll();
        return;
      }

      // Real account flow via CDP
      console.log(`📤 [Email Verify] Verifying ${mode} flow`);

      // Use same verification hook for both signin and link
      await verifyEmailOTP({ flowId, otp });

      if (mode === 'signin') {
        // Sign in with email - creates wallet
        // Wait for CDP to finish wallet initialization
        console.log('⏳ Waiting for wallet creation...');
        const maxWaitTime = 10000; // 10 second timeout
        const startTime = Date.now();

        while (!isInitialized) {
          if (Date.now() - startTime > maxWaitTime) {
            console.warn('⚠️ Wallet initialization timeout - navigating anyway');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 200)); // Check every 200ms
        }

        // Register push notifications after successful sign-in
        console.log('✅ Email sign-in successful, wallet ready');

        // Send ping FIRST to confirm we reached this code (visible in Vercel logs)
        fetch(`${process.env.EXPO_PUBLIC_BASE_URL}/push-tokens/ping`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'email-code-signin',
            hasCurrentUser: !!currentUser,
            userId: currentUser?.userId,
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});

        // Wait a moment for currentUser to be available
        await new Promise(resolve => setTimeout(resolve, 500));

        // Register push token now that user is signed in
        const { registerForPushNotifications, sendPushTokenToServer } = await import('@/utils/pushNotifications');
        const { getAccessTokenGlobal } = await import('@/utils/getAccessTokenGlobal');

        try {
          const result = await registerForPushNotifications();
          if (result && currentUser?.userId) {
            console.log('📱 [EMAIL-CODE] Registering push token after sign-in:', currentUser.userId);
            await sendPushTokenToServer(result.token, currentUser.userId, getAccessTokenGlobal, result.type);
          } else {
            console.log('⚠️ [EMAIL-CODE] No push token result:', { hasResult: !!result, hasUserId: !!currentUser?.userId });
          }
        } catch (pushError) {
          console.error('⚠️ [EMAIL-CODE] Push registration failed (non-blocking):', pushError);
        }

        router.dismissAll();
      } else {
        // Link email to existing account
        console.log('✅ Email linked successfully');

        // Show success message
        setAlert({
          visible: true,
          title: 'Email Verified',
          message: 'Your email address has been linked to your account.',
          type: 'success'
        });

        setTimeout(() => router.dismissAll(), 1500);
      }
    } catch (e: any) {
      console.error(`❌ [Email Verify] ${mode} error:`, e);
      setAlert({
        visible: true,
        title: 'Verification Failed',
        message: e.message || 'Invalid code. Please try again.',
        type: 'error'
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="chevron-back" size={24} color={TEXT_PRIMARY} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.stepContainer}>
            <Text style={styles.title}>
              {mode === 'signin' ? 'Check your email' : 'Link your email'}
            </Text>
            <Text style={styles.subtitle}>
              {mode === 'signin'
                ? `Please enter the verification code we sent to ${email}`
                : `Please enter the verification code we sent to ${email} to link this email.`}
            </Text>

            <View style={styles.codeInputContainer}>
              <TextInput
                style={styles.codeInput}
                value={otp}
                onChangeText={setOtp}
                placeholder=""
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                keyboardType="number-pad"
                maxLength={6}
                editable={!verifying}
                selectTextOnFocus={true}
                autoFocus
              />
            </View>

            <Pressable
              style={[styles.continueButton, (verifying || otp.length < 4) && styles.disabledButton]}
              onPress={verifyEmail}
              disabled={verifying || otp.length < 4}
            >
              {verifying ? (
                <ActivityIndicator color={WHITE} />
              ) : (
                <Text style={styles.continueButtonText}>Verify</Text>
              )}
            </Pressable>

            <View style={styles.resendContainer}>
              {resendSeconds > 0 ? (
                <Text style={styles.resendText}>You can resend in {resendSeconds}s</Text>
              ) : (
                <Pressable onPress={resendCode} disabled={!canResend}>
                  <Text style={[styles.resendButton, !canResend && styles.disabledText]}>
                    Resend code
                  </Text>
                </Pressable>
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <CoinbaseAlert
        visible={alert.visible}
        title={alert.title}
        message={alert.message}
        type={alert.type}
        onConfirm={() => setAlert(a => ({ ...a, visible:false }))}
      />
    </SafeAreaView>
  );
}

// Use the same styles as phone-code.tsx
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  stepContainer: {
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    textAlign: 'center',
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 40,
    paddingHorizontal: 20,
  },
  codeInputContainer: {
    marginBottom: 32,
    width: '100%',
  },
  codeInput: {
    backgroundColor: CARD_BG,
    borderWidth: 2,
    borderColor: BLUE,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 20,
    fontSize: 24,
    color: TEXT_PRIMARY,
    textAlign: 'center',
    letterSpacing: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  continueButton: {
    backgroundColor: BLUE,
    borderRadius: 25,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  continueButtonText: {
    color: WHITE,
    fontSize: 18,
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.5,
  },
  resendContainer: {
    marginTop: 24,
    alignItems: 'center',
  },
  resendText: {
    color: TEXT_SECONDARY,
    fontSize: 14,
  },
  resendButton: {
    color: BLUE,
    fontSize: 16,
    fontWeight: '600',
  },
  disabledText: {
    color: TEXT_SECONDARY,
  },
});