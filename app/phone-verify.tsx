import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CoinbaseAlert } from '../components/ui/CoinbaseAlerts';
import { COLORS } from '../constants/Colors';
import { TEST_ACCOUNTS } from '../constants/TestAccounts';
import { PHONE_COUNTRIES } from '../constants/PhoneCountries';
import { clearPendingForm, markPhoneVerifyCanceled } from '../utils/sharedState';
import { useSignInWithSms, useLinkSms, useCurrentUser, useIsSignedIn, useSignOut } from '@coinbase/cdp-hooks';

const { DARK_BG, CARD_BG, TEXT_PRIMARY, TEXT_SECONDARY, BORDER, BLUE, WHITE } = COLORS;

// Use shared phone countries constant
const SUPPORTED_COUNTRIES = PHONE_COUNTRIES;

export default function PhoneVerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const initialPhone = params.initialPhone as string || '';
  const mode = (params.mode as 'signin' | 'link' | 'reverify') || 'link'; // Default to link for backwards compat
  const autoSend = params.autoSend === 'true'; // Flag to auto-send OTP

  const [selectedCountry, setSelectedCountry] = useState(SUPPORTED_COUNTRIES[0]); // Default to US
  const [phoneNumber, setPhoneNumber] = useState(''); // Just the digits, no country code
  const [sending, setSending] = useState(false);
  const [alert, setAlert] = useState<{visible:boolean; title:string; message:string; type:'success'|'error'|'info'}>({
    visible:false, title:'', message:'', type:'info'
  });
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
  const [hasAutoSent, setHasAutoSent] = useState(false); // Track if we've auto-sent SMS

  // CDP hooks - use different hook based on mode
  const { signInWithSms } = useSignInWithSms();
  const { linkSms } = useLinkSms();
  const { isSignedIn } = useIsSignedIn();
  const { currentUser } = useCurrentUser();
  const { signOut } = useSignOut();

  // Parse initialPhone and pre-fill form
  React.useEffect(() => {
    if (initialPhone) {
      // Parse E164 phone number (e.g., +6583331214)
      const country = SUPPORTED_COUNTRIES.find(c => initialPhone.startsWith(c.code));
      if (country) {
        setSelectedCountry(country);
        setPhoneNumber(initialPhone.slice(country.code.length)); // Remove country code
      }
    }
  }, [initialPhone]);

  // Auto-send SMS for reverify mode (when user is still signed in but phone expired)
  // OR when autoSend flag is set (from profile re-verify button)
  React.useEffect(() => {
    const shouldAutoSend =
      (mode === 'reverify' && initialPhone && isSignedIn) || // Reverify: user still signed in
      (autoSend && initialPhone); // Profile re-verify: explicit auto-send flag

    // Only auto-send if phoneNumber is actually populated and valid
    const isReady = phoneNumber && phoneNumber.length >= selectedCountry.minDigits;

    if (shouldAutoSend && isReady && !hasAutoSent && !sending) {
      console.log('🔄 [PHONE-VERIFY] Auto-sending SMS:', { mode, autoSend, isSignedIn, phoneNumber });
      setHasAutoSent(true);
      // Trigger SMS send after a short delay to ensure UI is ready
      setTimeout(() => {
        startSms();
      }, 500);
    }
  }, [mode, initialPhone, hasAutoSent, sending, isSignedIn, autoSend, phoneNumber, selectedCountry]);

  // Handle phone number input
  const handlePhoneChange = (input: string) => {
    // Remove all non-digits
    const digits = input.replace(/\D/g, '');
    setPhoneNumber(digits);
  };

  // Get full E164 phone number
  const getE164Phone = () => {
    if (!phoneNumber) return '';
    return `${selectedCountry.code}${phoneNumber}`;
  };

  // Validate phone number based on selected country
  const isPhoneValid = phoneNumber.replace(/\D/g, '').length >= selectedCountry.minDigits;

  const startSms = async () => {
    if (!isPhoneValid) {
      setAlert({ visible:true, title:'Error', message:`Please enter at least ${selectedCountry.minDigits} digits for ${selectedCountry.name}`, type:'error' });
      return;
    }

    // For linking mode, ensure user is signed in
    if (mode === 'link' && !isSignedIn) {
      setAlert({
        visible: true,
        title: 'Not Signed In',
        message: 'You must be signed in before linking a phone number. Please sign in first.',
        type: 'error'
      });
      return;
    }

    const phoneE164 = getE164Phone();

    setSending(true);
    try {
      // Check if this is test phone (TestFlight) - bypass CDP
      if (phoneE164 === TEST_ACCOUNTS.phone) {
        console.log(`🧪 Test phone detected, skipping CDP SMS (mode: ${mode})`);

        // Navigate directly to code screen
        router.push({
          pathname: '/phone-code',
          params: { phone: phoneE164, mode }
        });
        return;
      }

      // Real phone verification flow via CDP
      console.log(`📤 [SMS] Starting ${mode} flow for phone`);
      console.log('Debug info:', {
        phoneE164,
        isSignedIn,
        mode,
        linkSmsType: typeof linkSms,
        signInWithSmsType: typeof signInWithSms,
        hasCurrentUser: !!currentUser,
        userId: currentUser?.userId
      });

      let result;
      try {
        if (mode === 'signin' || mode === 'reverify') {
          // Use signInWithSms for both signin and reverify
          // For reverify: sends OTP to already-linked phone without creating new session
          console.log(`Calling signInWithSms (${mode}) with:`, { phoneNumber: phoneE164 });
          result = await signInWithSms({ phoneNumber: phoneE164 });
        } else {
          console.log('Calling linkSms with:', phoneE164);
          result = await linkSms(phoneE164); // linkSms takes string directly
        }
      } catch (authError: any) {
        // Handle "already authenticated" error - sign out and let user retry manually
        if (authError.message?.toLowerCase().includes('already authenticated')) {
          console.error('❌ [PHONE-VERIFY] Already authenticated error - signing out user');

          // Automatically sign out and show helpful message
          try {
            await signOut();
            console.log('✅ [PHONE-VERIFY] Signed out successfully');
          } catch (signOutError) {
            console.error('❌ [PHONE-VERIFY] Failed to sign out:', signOutError);
          }

          // Show user-friendly error with guidance
          const friendlyError: any = new Error('You were already signed in. We\'ve signed you out.\n\nPlease tap "Continue" again to send a new verification code.');
          friendlyError.code = 'AUTO_SIGNED_OUT';
          throw friendlyError;
        } else {
          throw authError; // Re-throw if not the expected error
        }
      }

      console.log('Result from CDP:', result);

      console.log(`✅ [SMS] ${mode} SMS sent successfully`);

      // Navigate to code verification page
      router.push({
        pathname: '/phone-code',
        params: { phone: phoneE164, flowId: result.flowId, mode }
      });
    } catch (e: any) {
      console.error(`❌ [SMS] ${mode} error:`, e);
      console.error('Error type:', typeof e);
      console.error('Error constructor:', e?.constructor?.name);
      console.error('Error details:', {
        message: e.message,
        code: e.code,
        status: e.status,
        statusCode: e.statusCode,
        stack: e.stack,
        cause: e.cause,
        response: e.response,
        data: e.data
      });

      // Try to log the original error if it's wrapped
      if (e.cause) {
        console.error('Original error cause:', e.cause);
      }
      if (e.response) {
        console.error('Response data:', e.response);
      }

      // Handle METHOD_ALREADY_LINKED - phone already linked to this user
      if (e.code === 'METHOD_ALREADY_LINKED') {
        console.log('✅ Phone already linked to your account');
        setAlert({
          visible: true,
          title: 'Already Linked',
          message: 'This phone number is already linked to your account.',
          type: 'info'
        });
        // Navigate back after acknowledgment
        setTimeout(() => router.back(), 2000);
        return;
      }

      // Handle ACCOUNT_EXISTS - phone linked to different account
      if (e.code === 'ACCOUNT_EXISTS') {
        setAlert({
          visible: true,
          title: mode === 'signin' ? 'Sign In Instead?' : 'Phone Already Used',
          message: mode === 'signin'
            ? 'This phone number is already associated with another account. Would you like to sign in with that account instead?'
            : 'This phone number is associated with another account. Please use a different number or sign in with that account.',
          type: 'error'
        });
        return;
      }

      // Build comprehensive error message with all available details
      let errorMessage = e.message || 'Failed to send SMS';

      // Add all error properties to the message for TestFlight debugging
      const errorDetails: string[] = [];

      if (e.code) errorDetails.push(`Code: ${e.code}`);
      if (e.status) errorDetails.push(`Status: ${e.status}`);
      if (e.statusCode) errorDetails.push(`Status Code: ${e.statusCode}`);
      if (e.correlationId) errorDetails.push(`Correlation ID: ${e.correlationId}`);
      if (e.requestId) errorDetails.push(`Request ID: ${e.requestId}`);
      if (e.errorId) errorDetails.push(`Error ID: ${e.errorId}`);
      if (e.type) errorDetails.push(`Type: ${e.type}`);
      if (e.name && e.name !== 'Error') errorDetails.push(`Name: ${e.name}`);

      // Try to stringify the entire error object to catch any additional fields
      try {
        const errorJson = JSON.stringify(e, null, 2);
        if (errorJson !== '{}') {
          errorDetails.push(`\nFull Error Object:\n${errorJson}`);
        }
      } catch (jsonError) {
        // If JSON.stringify fails, try to get enumerable properties
        const props = Object.keys(e);
        if (props.length > 0) {
          errorDetails.push(`\nError Properties: ${props.join(', ')}`);
        }
      }

      if (errorDetails.length > 0) {
        errorMessage += '\n\n' + errorDetails.join('\n');
      }

      // Generic error with full details
      setAlert({
        visible: true,
        title: 'Error',
        message: errorMessage,
        type: 'error'
      });
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => {
    clearPendingForm();
    markPhoneVerifyCanceled();

    // If in re-verify mode and user is not signed in (they signed out),
    // navigate to home instead of back (prevents getting stuck in navigation stack)
    if (mode === 'reverify' && !isSignedIn) {
      console.log('🔙 [PHONE-VERIFY] Re-verify canceled after sign out - returning to home');
      router.replace('/(tabs)');
      return;
    }

    // Check if we can actually go back (there's a previous screen)
    // If not, navigate to home instead
    if (router.canGoBack()) {
      router.back();
    } else {
      console.log('🔙 [PHONE-VERIFY] No previous screen - navigating to home');
      router.replace('/(tabs)');
    }
  };

  return (
    <SafeAreaView style={styles.container} >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={handleBack} style={styles.backButton}>
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
              {mode === 'signin' ? 'Sign in with phone' : mode === 'reverify' ? 'Re-verify your phone' : 'Link your phone number'}
            </Text>
            <Text style={styles.subtitle}>
              {mode === 'signin'
                ? "We'll text you a code to sign in. Standard message rates may apply."
                : mode === 'reverify'
                ? "We'll text you a code to verify you still have access to this phone. This is required for Apple Pay checkout."
                : "We'll text you a code to link your phone. This is required for Apple Pay checkout."}
            </Text>

            {!selectedCountry.applePayCompatible && (mode === 'link' || mode === 'reverify') && (
              <View style={styles.warningBox}>
                <Ionicons name="information-circle" size={20} color="#FFA500" />
                <Text style={styles.warningText}>
                  Only US phone numbers work with Apple Pay checkout. Other countries can use alternative payment methods.
                </Text>
              </View>
            )}

            <View style={styles.phoneInputContainer}>
              <Pressable
                onPress={() => setCountryPickerVisible(true)}
                style={styles.countryButton}
                disabled={sending}
              >
                <Text style={styles.flagEmoji}>{selectedCountry.flag}</Text>
                <Text style={styles.countryCode}>{selectedCountry.code}</Text>
                <Ionicons name="chevron-down" size={16} color={TEXT_SECONDARY} />
              </Pressable>
              <TextInput
                style={styles.phoneInput}
                value={phoneNumber}
                onChangeText={handlePhoneChange}
                placeholder={`Phone number`}
                placeholderTextColor={TEXT_SECONDARY}
                keyboardType="phone-pad"
                editable={!sending}
                autoFocus
              />
            </View>

            <Pressable
              style={[styles.continueButton, (!isPhoneValid || sending) && styles.disabledButton]}
              onPress={startSms}
              disabled={!isPhoneValid || sending}
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

      {/* Country Picker Modal */}
      {countryPickerVisible && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Country</Text>
              <Pressable onPress={() => setCountryPickerVisible(false)}>
                <Ionicons name="close" size={28} color={TEXT_PRIMARY} />
              </Pressable>
            </View>
            <ScrollView style={styles.countryList}>
              {SUPPORTED_COUNTRIES.map((country) => (
                <Pressable
                  key={country.code + country.name}
                  style={[
                    styles.countryItem,
                    selectedCountry.code === country.code && selectedCountry.name === country.name && styles.selectedCountryItem
                  ]}
                  onPress={() => {
                    setSelectedCountry(country);
                    setCountryPickerVisible(false);
                  }}
                >
                  <Text style={styles.countryItemFlag}>{country.flag}</Text>
                  <Text style={styles.countryItemName}>{country.name}</Text>
                  <Text style={styles.countryItemCode}>{country.code}</Text>
                  {country.applePayCompatible && (
                    <Text style={styles.applePayBadge}>Apple Pay ✓</Text>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      )}
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
  topPadding: {
    height: 20,
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
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 165, 0, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 165, 0, 0.3)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 24,
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    color: '#FFA500',
    lineHeight: 18,
  },
  phoneInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 32,
    width: '100%',
  },
  countryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 12,
    marginRight: 12,
    borderRightWidth: 1,
    borderRightColor: BORDER,
  },
  flagEmoji: {
    fontSize: 24,
    marginRight: 8,
  },
  countryCode: {
    fontSize: 18,
    color: TEXT_PRIMARY,
    marginRight: 4,
    fontWeight: '500',
  },
  phoneInput: {
    flex: 1,
    fontSize: 18,
    color: TEXT_PRIMARY,
    padding: 0,
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
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: DARK_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '70%',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: BORDER,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  countryList: {
    flex: 1,
  },
  countryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  selectedCountryItem: {
    backgroundColor: CARD_BG,
  },
  countryItemFlag: {
    fontSize: 24,
    marginRight: 12,
  },
  countryItemName: {
    flex: 1,
    fontSize: 16,
    color: TEXT_PRIMARY,
  },
  countryItemCode: {
    fontSize: 16,
    color: TEXT_SECONDARY,
    marginRight: 8,
  },
  applePayBadge: {
    fontSize: 12,
    color: '#34C759',
    fontWeight: '600',
  },
});