import { useSignInWithEmail, useLinkEmail, useIsSignedIn } from '@coinbase/cdp-hooks';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CoinbaseAlert } from '../components/ui/CoinbaseAlerts';
import { COLORS } from '../constants/Colors';

const { DARK_BG, CARD_BG, TEXT_PRIMARY, TEXT_SECONDARY, BORDER, BLUE, WHITE } = COLORS;

export default function EmailVerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialEmail = params.initialEmail as string || '';
  const mode = (params.mode as 'signin' | 'link') || 'signin'; // Default to signin for new flow

  const [email, setEmail] = useState(initialEmail);
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<{visible:boolean; title:string; message:string; type:'success'|'error'|'info'}>({
    visible:false, title:'', message:'', type:'info'
  });

  // CDP hooks - use different hook based on mode
  const { signInWithEmail } = useSignInWithEmail();
  const { linkEmail } = useLinkEmail();
  const { isSignedIn } = useIsSignedIn();

  const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const startEmailVerification = async () => {
    if (!isEmailValid) {
      setAlert({ visible:true, title:'Error', message:'Please enter a valid email address', type:'error' });
      return;
    }

    // For linking mode, ensure user is signed in
    if (mode === 'link' && !isSignedIn) {
      setAlert({
        visible: true,
        title: 'Not Signed In',
        message: 'You must be signed in before linking an email address. Please sign in first.',
        type: 'error'
      });
      return;
    }

    setSending(true);
    try {
      console.log(`📤 [Email] Starting ${mode} flow`);

      let result;
      if (mode === 'signin') {
        result = await signInWithEmail({ email });
      } else {
        result = await linkEmail(email); // linkEmail takes string directly
      }

      console.log(`✅ [Email] ${mode} email sent successfully`);

      // Navigate to code verification page
      router.push({
        pathname: '/email-code',
        params: { email, flowId: result.flowId, mode }
      });
    } catch (e: any) {
      console.error(`❌ [Email] ${mode} error:`, e);

      // Handle METHOD_ALREADY_LINKED - email already linked to this user
      if (e.code === 'METHOD_ALREADY_LINKED') {
        console.log('✅ Email already linked to your account');
        setAlert({
          visible: true,
          title: 'Already Linked',
          message: 'This email address is already linked to your account.',
          type: 'info'
        });
        setTimeout(() => router.back(), 2000);
        return;
      }

      // Handle ACCOUNT_EXISTS - email linked to different account
      if (e.code === 'ACCOUNT_EXISTS') {
        setAlert({
          visible: true,
          title: mode === 'signin' ? 'Sign In Instead?' : 'Email Already Used',
          message: mode === 'signin'
            ? 'This email is already associated with another account. Would you like to sign in with that account instead?'
            : 'This email is associated with another account. Please use a different email or sign in with that account.',
          type: 'error'
        });
        return;
      }

      // Generic error
      setAlert({
        visible: true,
        title: 'Error',
        message: e.message || 'Failed to send email',
        type: 'error'
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
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
              {mode === 'signin' ? 'Sign in with email' : 'Link your email'}
            </Text>
            <Text style={styles.subtitle}>
              {mode === 'signin'
                ? "We'll send you a verification code to sign in and access your wallet."
                : "We'll send you a verification code to link your email. This is required for Apple Pay checkout."}
            </Text>

            <View style={styles.emailInputContainer}>
              <TextInput
                style={styles.emailInput}
                value={email}
                onChangeText={setEmail}
                placeholder="your.email@example.com"
                placeholderTextColor={TEXT_SECONDARY}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!sending}
                autoFocus
              />
            </View>

            <Pressable
              style={[styles.continueButton, (!isEmailValid || sending) && styles.disabledButton]}
              onPress={startEmailVerification}
              disabled={!isEmailValid || sending}
            >
              {sending ? (
                <ActivityIndicator color={WHITE} />
              ) : (
                <Text style={styles.continueButtonText}>Continue</Text>
              )}
            </Pressable>
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
  emailInputContainer: {
    marginBottom: 32,
    width: '100%',
  },
  emailInput: {
    backgroundColor: CARD_BG,
    borderWidth: 2,
    borderColor: BLUE,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 20,
    fontSize: 18,
    color: TEXT_PRIMARY,
    textAlign: 'center',
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
});