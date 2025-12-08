/**
 * ============================================================================
 * SHARED STATE MANAGEMENT - LIGHTWEIGHT GLOBAL STATE
 * ============================================================================
 *
 * PURPOSE:
 * Alternative to React Context for cross-tab/cross-screen state sharing.
 * Used for demo purposes - production apps should use Redux/Zustand/React Query.
 *
 * STATE CATEGORIES:
 *
 * 1. WALLET ADDRESSES (currentWalletAddress, currentSolanaAddress, manualWalletAddress)
 *    - EVM address: Smart Account or EOA from CDP
 *    - Solana address: Solana account from CDP
 *    - Manual address: Testing-only input for sandbox mode
 *    - getCurrentWalletAddress(): Network-aware resolution (see below)
 *
 * 2. NETWORK TRACKING (currentNetwork)
 *    - Tracks selected blockchain network (Base, Ethereum, Solana, etc.)
 *    - Updated by OnrampForm when user changes network dropdown
 *    - Used for address resolution logic
 *
 * 3. PHONE VERIFICATION (verifiedPhone, verifiedPhoneAt)
 *    - Stored in AsyncStorage (persists across app restarts)
 *    - Required for Apple Pay transactions
 *    - 60-day expiry (PHONE_TTL_MS constant)
 *    - hydrateVerifiedPhone(): Called in _layout.tsx on app start
 *
 * 4. REGION (currentCountry, currentSubdivision)
 *    - Determines available payment methods and currencies
 *    - US requires subdivision (state) for compliance
 *    - Triggers OnrampForm remount on change (key prop)
 *
 * 5. SANDBOX MODE (sandboxMode)
 *    - Defaults to ON for safety (prevents accidental real transactions)
 *    - Resets to default ON every app restart
 *    - Test mode: uses mock data, optional verification
 *    - Production mode: real transactions, strict validation
 *
 * 6. TRANSACTION TRACKING (currentPartnerUserRef, pendingTransactionForm)
 *    - partnerUserRef: Unique identifier for transaction history lookup
 *    - pendingForm: Stores form data when user needs phone verification
 *
 * ============================================================================
 * WALLET ADDRESS PRIORITY SYSTEM - NETWORK-AWARE ROUTING
 * ============================================================================
 *
 * getCurrentWalletAddress() returns different addresses based on:
 * - Current network (EVM vs Solana vs Unsupported)
 * - Sandbox vs Production mode
 * - Available wallet types
 *
 * SANDBOX MODE (testing with flexibility):
 * ┌─────────────────┬──────────────────────────────────────┐
 * │ Network Type    │ Address Priority                     │
 * ├─────────────────┼──────────────────────────────────────┤
 * │ Solana/SOL      │ manual > SOL wallet > null           │
 * │ EVM (eth, base) │ manual > EVM wallet > null           │
 * │ Other (bitcoin) │ manual > EVM wallet > null           │
 * └─────────────────┴──────────────────────────────────────┘
 *
 * PRODUCTION MODE (strict network-wallet matching):
 * ┌─────────────────┬──────────────────────────────────────┐
 * │ Network Type    │ Address Priority                     │
 * ├─────────────────┼──────────────────────────────────────┤
 * │ SOL             │ SOL wallet ONLY > null               │
 * │ EVM (eth, base) │ EVM wallet ONLY > null               │
 * │ Other (bitcoin) │ NULL (unsupported)                   │
 * └─────────────────┴──────────────────────────────────────┘
 *
 * EXAMPLES:
 * - User has EVM + SOL wallets, selects "Solana" → returns SOL address
 * - User has EVM wallet only, selects "Base" → returns EVM address
 * - User has EVM wallet only, selects "Bitcoin" (prod) → returns null (shows error card)
 * - User in sandbox with manual address, selects any network → returns manual address
 *
 * WHY THIS DESIGN?
 * - Sandbox: Flexibility for testing any network with demo addresses
 * - Production: Safety - prevent sending crypto to wrong address type
 * - Network-aware: Same user can have multiple wallets for different chains
 *
 * @see components/onramp/OnrampForm.tsx for network change handling
 * @see app/(tabs)/index.tsx for address updates on network changes
 * @see app/(tabs)/profile.tsx for manual address input (sandbox only)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const PHONE_KEY = 'verifiedPhone';
const PHONE_AT_KEY = 'verifiedPhoneAt';
const PHONE_USER_KEY = 'verifiedPhoneUserId'; // Track which user verified this phone
export const PHONE_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

let currentPartnerUserRef: string | null = null;
let currentWalletAddress: string | null = null;
let currentSolanaAddress: string | null = null;

let verifiedPhone: string | null = null;
let verifiedPhoneAt: number | null = null;
let verifiedPhoneUserId: string | null = null; // Track which user verified this phone

let currentCountry: string = 'US';
let currentSubdivision: string = 'CA';

let manualWalletAddress: string | null = null;
let currentNetwork: string = 'Base'; // Track selected network

let pendingTransactionForm: any = null;

export const setPendingForm = (form: any) => { pendingTransactionForm = form; };
export const getPendingForm = () => pendingTransactionForm;
export const clearPendingForm = () => { pendingTransactionForm = null; };

export const getCountry = () => currentCountry;
export const setCountry = (c: string) => { currentCountry = c; };

export const getSubdivision = () => currentSubdivision;
export const setSubdivision = (s: string) => { currentSubdivision = s; };

let phoneVerifyCanceled = false;

export const markPhoneVerifyCanceled = () => { phoneVerifyCanceled = true; };
export const getPhoneVerifyWasCanceled = () => phoneVerifyCanceled;
export const clearPhoneVerifyWasCanceled = () => { phoneVerifyCanceled = false; };

// Sandbox mode - always defaults to ON for safety (prevents accidental real transactions)
// Does NOT persist across app restarts - intentional design
let sandboxMode: boolean = true;

export const getSandboxMode = () => sandboxMode;
export const setSandboxMode = (enabled: boolean) => {
  sandboxMode = enabled;
  console.log('Sandbox mode:', enabled ? 'ENABLED' : 'DISABLED');
};

// Initialize sandbox mode - always starts as ON for safety
export const hydrateSandboxMode = async () => {
  sandboxMode = true;
  console.log('ℹ️ Sandbox mode initialized to default: ENABLED (for safety)');
};

// ============================================================================
// TEST ACCOUNT SESSION (TestFlight Only)
// ============================================================================
// Stores mock session for TestFlight reviewers who use test account
// Persists until sign out (email) or unlink phone

const TEST_SESSION_KEY = '@onramp_test_session';

let testSessionActive = false;
let testWalletEvm: string | null = null;
let testWalletSol: string | null = null;

export const setTestSession = async (evmAddress: string, solAddress: string) => {
  testSessionActive = true;
  testWalletEvm = evmAddress;
  testWalletSol = solAddress;

  await AsyncStorage.setItem(TEST_SESSION_KEY, JSON.stringify({
    active: true,
    evm: evmAddress,
    sol: solAddress
  }));

  console.log('✅ Test session activated (TestFlight)');
};

export const clearTestSession = async () => {
  testSessionActive = false;
  testWalletEvm = null;
  testWalletSol = null;

  await AsyncStorage.removeItem(TEST_SESSION_KEY);
  console.log('❌ Test session cleared');
};

export const hydrateTestSession = async () => {
  try {
    const data = await AsyncStorage.getItem(TEST_SESSION_KEY);
    if (data) {
      const parsed = JSON.parse(data);

      // Safety check: Validate test session data
      if (parsed.active && parsed.evm && parsed.sol) {
        testSessionActive = true;
        testWalletEvm = parsed.evm;
        testWalletSol = parsed.sol;
        console.log('🔄 Test session hydrated from storage');
      } else {
        // Invalid data, clear it
        console.warn('⚠️ Invalid test session data, clearing');
        await clearTestSession();
      }
    }
  } catch (error) {
    console.error('❌ Error hydrating test session:', error);
    await clearTestSession();
  }
};

export const isTestSessionActive = () => testSessionActive;
export const getTestWalletEvm = () => testWalletEvm;
export const getTestWalletSol = () => testWalletSol;


export const setCurrentPartnerUserRef = (ref: string | null) => {
  currentPartnerUserRef = ref;
  console.log('Global state updated - currentPartnerUserRef:', ref);
};

export const getCurrentPartnerUserRef = () => {
  console.log('Getting global state - currentPartnerUserRef:', currentPartnerUserRef);
  return currentPartnerUserRef;
};

export const setManualWalletAddress = (addr: string | null) => {
  manualWalletAddress = addr;
};

export const getManualWalletAddress = () => manualWalletAddress;

export const clearManualAddress = () => {
  manualWalletAddress = '';
  console.log('🧹 [SHARED STATE] Manual address cleared (production mode)');
};

export const setCurrentWalletAddress = (addr: string | null) => {
  currentWalletAddress = addr;
};

export const setCurrentSolanaAddress = (addr: string | null) => {
  currentSolanaAddress = addr;
};

export const setCurrentNetwork = (network: string) => {
  currentNetwork = network;
};

export const getCurrentNetwork = () => currentNetwork;

// utils/sharedState.ts - document wallet address priority
/**
 * Wallet address priority system:
 *
 * SANDBOX MODE:
 * - SOL network: manual > SOL wallet
 * - EVM and ANY other network: manual > EVM wallet
 *
 * PRODUCTION MODE:
 * - SOL network: SOL wallet only
 * - EVM networks: EVM wallet only
 * - Unsupported networks: null (no address)
 */
export const getCurrentWalletAddress = () => {
  const networkLower = (currentNetwork || '').toLowerCase();
  const isSolanaNetwork = ['solana', 'sol'].some(k => networkLower.includes(k));
  const isEvmNetwork = ['ethereum', 'base', 'unichain', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'avax', 'bsc', 'fantom', 'linea', 'zksync', 'scroll'].some(k => networkLower.includes(k));

  if (sandboxMode) {
    // Sandbox mode: allow testing with any address
    if (isSolanaNetwork) {
      // SOL network: prefer manual, fallback to SOL wallet
      return manualWalletAddress || currentSolanaAddress || null;
    } else {
      // EVM and ANY other network (including unsupported): prefer manual, fallback to EVM wallet
      return manualWalletAddress || currentWalletAddress || null;
    }
  } else {
    // Production mode: strict network-wallet matching
    if (isSolanaNetwork) {
      // SOL network: SOL wallet only
      return currentSolanaAddress || null;
    } else if (isEvmNetwork) {
      // EVM networks: EVM wallet only
      return currentWalletAddress || null;
    } else {
      // Unsupported networks (Bitcoin, Noble, etc.): NO address
      return null;
    }
  }
};

export const setVerifiedPhone = async (phone: string | null, userId?: string) => {
  verifiedPhone = phone;
  verifiedPhoneAt = phone ? Date.now() : null;
  verifiedPhoneUserId = userId || null;
  if (phone) {
    await AsyncStorage.multiSet([
      [PHONE_KEY, phone],
      [PHONE_AT_KEY, String(verifiedPhoneAt)],
      [PHONE_USER_KEY, userId || '']
    ]);
  } else {
    verifiedPhoneUserId = null;
    await AsyncStorage.multiRemove([PHONE_KEY, PHONE_AT_KEY, PHONE_USER_KEY]);
  }
};

export const hydrateVerifiedPhone = async () => {
  const [p, at, userId] = await AsyncStorage.multiGet([PHONE_KEY, PHONE_AT_KEY, PHONE_USER_KEY]);
  verifiedPhone = p?.[1] || null;
  verifiedPhoneAt = at?.[1] ? Number(at[1]) : null;
  verifiedPhoneUserId = userId?.[1] || null;
};

export const getVerifiedPhone = () => verifiedPhone;
export const getVerifiedPhoneAt = () => verifiedPhoneAt;
export const getVerifiedPhoneUserId = () => verifiedPhoneUserId;

export const isPhoneFresh60d = () => {
  if (!verifiedPhoneAt) return false;
  return Date.now() - verifiedPhoneAt < PHONE_TTL_MS;
};

export const phoneExpiry = () => (verifiedPhoneAt ? new Date(verifiedPhoneAt + PHONE_TTL_MS) : null);

// Developer tool: Force unverify phone for testing
export const forceUnverifyPhone = async () => {
  verifiedPhone = null;
  verifiedPhoneAt = null;
  verifiedPhoneUserId = null;
  await AsyncStorage.multiRemove([PHONE_KEY, PHONE_AT_KEY, PHONE_USER_KEY]);
  console.log('🔧 [DEV] Phone verification forcefully cleared');
};
export const daysUntilExpiry = () => {
  if (!verifiedPhoneAt) return -1;
  const rem = verifiedPhoneAt + PHONE_TTL_MS - Date.now();
  return Math.ceil(rem / (24 * 60 * 60 * 1000));
};

export const formatPhoneDisplay = (phone: string | null): string => {
  if (!phone) return '';

  // Import phone countries from shared constants
  const { PHONE_COUNTRIES } = require('../constants/PhoneCountries');

  // Check if phone already has + prefix
  if (!phone.startsWith('+')) {
    // No prefix - assume US format for backward compatibility
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      const areaCode = digits.slice(0, 3);
      const exchange = digits.slice(3, 6);
      const number = digits.slice(6, 10);
      return `+1 (${areaCode}) ${exchange}-${number}`;
    }
    return phone; // Fallback
  }

  // Find matching country by checking if phone starts with the country code
  // Sort by code length (descending) to match longer codes first (e.g., +971 before +97)
  const sortedCountries = [...PHONE_COUNTRIES].sort((a, b) => b.code.length - a.code.length);
  const country = sortedCountries.find(c => phone.startsWith(c.code));

  if (!country) {
    // Unknown country - return as-is
    return phone;
  }

  // Extract the local number (without country code)
  const localNumber = phone.slice(country.code.length).replace(/\D/g, '');

  // Format based on country
  if (country.code === '+1') {
    // US/Canada: +1 (XXX) XXX-XXXX
    if (localNumber.length === 10) {
      const areaCode = localNumber.slice(0, 3);
      const exchange = localNumber.slice(3, 6);
      const number = localNumber.slice(6, 10);
      return `${country.flag} ${country.code} (${areaCode}) ${exchange}-${number}`;
    }
  } else if (country.code === '+65') {
    // Singapore: +65 XXXX XXXX
    if (localNumber.length === 8) {
      const part1 = localNumber.slice(0, 4);
      const part2 = localNumber.slice(4, 8);
      return `${country.flag} ${country.code} ${part1} ${part2}`;
    }
  } else if (country.code === '+44') {
    // UK: +44 XXXX XXXXXX
    if (localNumber.length === 10) {
      const part1 = localNumber.slice(0, 4);
      const part2 = localNumber.slice(4);
      return `${country.flag} ${country.code} ${part1} ${part2}`;
    }
  } else if (country.code === '+61') {
    // Australia: +61 XXX XXX XXX
    if (localNumber.length === 9) {
      const part1 = localNumber.slice(0, 3);
      const part2 = localNumber.slice(3, 6);
      const part3 = localNumber.slice(6);
      return `${country.flag} ${country.code} ${part1} ${part2} ${part3}`;
    }
  }

  // Generic format for other countries: flag + code + number in groups
  const groups: string[] = [];
  if (localNumber.length <= 4) {
    groups.push(localNumber);
  } else if (localNumber.length <= 7) {
    groups.push(localNumber.slice(0, 3));
    groups.push(localNumber.slice(3));
  } else if (localNumber.length <= 10) {
    // Split into 3-3-4 or similar
    const groupSize1 = Math.floor(localNumber.length / 3);
    const groupSize2 = Math.floor((localNumber.length - groupSize1) / 2);
    const groupSize3 = localNumber.length - groupSize1 - groupSize2;
    groups.push(localNumber.slice(0, groupSize1));
    groups.push(localNumber.slice(groupSize1, groupSize1 + groupSize2));
    groups.push(localNumber.slice(groupSize1 + groupSize2));
  } else {
    // Very long: group by 4
    for (let i = 0; i < localNumber.length; i += 4) {
      groups.push(localNumber.slice(i, i + 4));
    }
  }

  return `${country.flag} ${country.code} ${groups.join(' ')}`;
};