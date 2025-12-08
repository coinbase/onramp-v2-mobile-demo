/**
 * ============================================================================
 * ONRAMP HOOK - CENTRAL STATE & API ORCHESTRATION
 * ============================================================================
 *
 * This hook manages all onramp-related state and coordinates API calls.
 * It's the single source of truth for the onramp flow.
 *
 * RESPONSIBILITIES:
 * 1. Fetch available options (assets, networks, payment methods, currencies)
 * 2. Dynamic quote fetching (real-time pricing with fees)
 * 3. Order creation (Apple Pay native flow)
 * 4. Widget session creation (Coinbase-hosted checkout)
 * 5. Form validation state management
 *
 * DATA FLOW:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ 1. USER SELECTS REGION (Profile) → fetchOptions()               │
 * │    ↓                                                             │
 * │ 2. LOADS ASSETS/NETWORKS → getAvailableAssets/Networks()        │
 * │    ↓                                                             │
 * │ 3. USER ENTERS AMOUNT/SELECTS ASSET → fetchQuote() (debounced)  │
 * │    ↓                                                             │
 * │ 4. SHOWS FEES/TOTAL → User reviews                              │
 * │    ↓                                                             │
 * │ 5. USER SLIDES CONFIRM → createOrder() OR createWidgetSession() │
 * │    ↓                                                             │
 * │ 6. PAYMENT FLOW → ApplePayWidget OR Browser Redirect            │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * TWO PAYMENT PATHS:
 *
 * A. APPLE PAY (GUEST_CHECKOUT_APPLE_PAY):
 *    - Native iOS Apple Pay sheet
 *    - Requires phone verification (60-day cache)
 *    - USD only
 *    - Hidden WebView handles v2 orders API
 *    - Real-time transaction tracking via post-events
 *    Flow: createOrder() → ApplePayWidget → Native sheet → Blockchain
 *
 * B. COINBASE WIDGET (COINBASE_WIDGET):
 *    - Browser-based checkout (Linking.openURL)
 *    - NO phone verification required
 *    - Multi-currency support (USD, EUR, GBP, etc.)
 *    - User can select payment method in widget (Card, ACH, etc.)
 *    - Coinbase-hosted page handles payment
 *    Flow: createWidgetSession() → Browser → Coinbase page → Return to app
 *
 * API DATA FORMAT MAPPING (Critical for integration):
 *
 * Coinbase API uses TWO different name formats:
 * 1. DISPLAY NAMES (for UI): "USD Coin", "Base", "Ethereum"
 * 2. API VALUES (for submission): "USDC", "base", "ethereum"
 *
 * Helper functions:
 * - getAssetSymbolFromName(): "USD Coin" → "USDC"
 * - getNetworkNameFromDisplayName(): "Base" → "base"
 *
 * These ensure form selects (display names) are properly converted
 * before sending to Coinbase API (needs lowercase network names, uppercase symbols).
 *
 * @see components/onramp/OnrampForm.tsx for form UI and validation
 * @see utils/createApplePayOrder.ts for Apple Pay API integration
 * @see utils/createOnrampSession.ts for Widget session API
 * @see utils/fetchBuyQuote.ts for quote generation logic
 */

import { createOnrampSession } from "@/utils/createOnrampSession";
import { fetchBuyConfig } from "@/utils/fetchBuyConfig";
import { useCurrentUser } from "@coinbase/cdp-hooks";
import { useCallback, useMemo, useState } from "react";
import { OnrampFormData } from "../components/onramp/OnrampForm";
import { TEST_ACCOUNTS } from "../constants/TestAccounts";
import { createApplePayOrder } from "../utils/createApplePayOrder";
import { fetchBuyOptions } from "../utils/fetchBuyOptions";
import { fetchBuyQuote } from "../utils/fetchBuyQuote";
import { getCountry, getSandboxMode, getSubdivision, getVerifiedPhone, getVerifiedPhoneAt, isPhoneFresh60d, isTestSessionActive, setCurrentPartnerUserRef, setSubdivision } from "../utils/sharedState";


export type PaymentMethodOption = { display: string; value: string };
export function useOnramp() {
  // These states from index.tsx:
  const [applePayVisible, setApplePayVisible] = useState(false);
  const [hostedUrl, setHostedUrl] = useState('');
  const [transactionStatus, setTransactionStatus] = useState<'pending' | 'success' | 'error' | null>(null);
  const [options, setOptions] = useState<any>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [currentQuote, setCurrentQuote] = useState<any>(null);
  const [isLoadingQuote, setIsLoadingQuote] = useState(false);
  const { currentUser } = useCurrentUser();
  const [buyConfig, setBuyConfig] = useState<any>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);


  /**
     * API Data Format Mapping
     * Coinbase API uses different formats for display vs. submission:
     * - Display: asset.name ("USD Coin") + network.display_name ("Base") 
     * - API Submission: asset.symbol ("USDC") + network.name ("base")
     * 
     * Helper functions handle this mapping:
     * - getAssetSymbolFromName(): "USD Coin" → "USDC" 
     * - getNetworkNameFromDisplayName(): "Base" → "base"
     */
  const getAssetSymbolFromName = useCallback((assetName: string) => {
    if (!options?.purchase_currencies) return assetName;
    const asset = options.purchase_currencies.find((a: any) => a.name === assetName);
    return asset?.symbol || assetName;
  }, [options]);

  const getNetworkNameFromDisplayName = useCallback((displayName: string) => {
    if (!options?.purchase_currencies) return displayName;
    
    for (const asset of options.purchase_currencies) {
      const network = asset.networks.find((n: any) => n.display_name === displayName);
      if (network) return network.name;
    }
    return displayName;
  }, [options]);

  /**
   * Creates an onramp order and triggers Apple Pay flow
   * Flow: Form validation → API call → WebView → Apple Pay → Transaction tracking
   */
  const createOrder = useCallback(async (formData: OnrampFormData) => {
    try {
      setIsProcessingPayment(true); // Start loading

      // Check if this is a test session (used throughout the function)
      const isTestSession = isTestSessionActive();
      const currentSandboxMode = getSandboxMode();

      console.log('🔍 [APPLE PAY] Sandbox detection:', {
        isTestSession,
        getSandboxMode: currentSandboxMode,
        shouldUseSandbox: currentSandboxMode || isTestSession
      });

      // Generate unique user reference for transaction tracking
      // Apple Pay: Use userId with sandbox prefix for sandbox environment OR test accounts
      const sandboxPrefix = (currentSandboxMode || isTestSession) ? "sandbox-" : "";
      const userId = currentUser?.userId || 'unknown-user';
      const partnerUserRef = `${sandboxPrefix}${userId}`;

      console.log('🔍 [APPLE PAY] partnerUserRef:', partnerUserRef);
      setCurrentPartnerUserRef(partnerUserRef);

      // IMPORTANT: Register push token before transaction (ensures webhook can send notification)
      try {
        const { registerForPushNotifications, sendPushTokenToServer } = await import('@/utils/pushNotifications');
        const { getAccessTokenGlobal } = await import('@/utils/getAccessTokenGlobal');

        console.log('📱 [TRANSACTION] Pre-registering push token for:', partnerUserRef);
        const pushToken = await registerForPushNotifications();
        if (pushToken) {
          await sendPushTokenToServer(pushToken.token, partnerUserRef, getAccessTokenGlobal, pushToken.type);
          console.log('✅ [TRANSACTION] Push token registered successfully');
        }
      } catch (pushError) {
        console.warn('⚠️ [TRANSACTION] Failed to register push token:', pushError);
        // Don't block transaction if push token fails
      }

      // Apple Pay Guest Checkout requires BOTH email and phone
      // For test sessions, use test account credentials
      const userEmail = isTestSession
        ? TEST_ACCOUNTS.email
        : (currentUser?.authenticationMethods.email?.email || null);
      const cdpPhone = isTestSession
        ? TEST_ACCOUNTS.phone
        : (currentUser?.authenticationMethods.sms?.phoneNumber || null);

      let phone = getVerifiedPhone();
      let phoneAt = getVerifiedPhoneAt();

      // Check for missing auth methods (non-sandbox only)
      if (!getSandboxMode()) {
        // Note: Non-US phones can now go through the verification flow for experience
        // The actual Apple Pay order will fail at Coinbase API level for non-US phones
        // This allows international users to experience the flow with disclaimers

        // Check if email is missing or not linked
        if (!userEmail) {
          const missingEmailError: any = new Error('Email verification required for Apple Pay');
          missingEmailError.code = 'MISSING_EMAIL';
          throw missingEmailError;
        }

        // Check if phone is missing or not linked to CDP
        if (!cdpPhone) {
          const missingPhoneError: any = new Error('Phone verification required for Apple Pay');
          missingPhoneError.code = 'MISSING_PHONE';
          throw missingPhoneError;
        }

        // Check if CDP phone matches verified phone AND is fresh (60 days)
        if (phone !== cdpPhone || !isPhoneFresh60d()) {
          console.log('🚫 [APPLE PAY] Phone verification failed:', {
            phoneMatch: phone === cdpPhone,
            isFresh: isPhoneFresh60d()
          });
          const missingPhoneError: any = new Error('Phone verification required for Apple Pay. Please verify your phone on the Profile page.');
          missingPhoneError.code = 'MISSING_PHONE';
          throw missingPhoneError;
        }
      } else {
        console.log('🧪 [APPLE PAY] Sandbox mode - skipping phone validation');

        // CRITICAL: Apple Pay is US-only, so always use TEST_ACCOUNTS US phone in sandbox
        // This allows international users to test Apple Pay flow
        phone = TEST_ACCOUNTS.phone; // US phone: +12345678901
        phoneAt = Date.now();
        console.log('🧪 [APPLE PAY] Using TEST_ACCOUNTS US phone for sandbox:', phone);
      }

      // Production: require fresh phone verification
      if (!getSandboxMode() && (!phone || !isPhoneFresh60d())) {
        const phoneExpiredError: any = new Error('Phone verification has expired. Please re-verify your phone to continue with Apple Pay.');
        phoneExpiredError.code = 'PHONE_EXPIRED';
        throw phoneExpiredError;
      }

      // CRITICAL: For EVM networks (Base, Ethereum), MUST use Smart Account
      // App only shows Smart Account balances - funds sent to EOA would be invisible
      const networkName = getNetworkNameFromDisplayName(formData.network);
      const isEvmNetwork = ['base', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'linea', 'zksync'].includes(networkName.toLowerCase());
      const isSandbox = getSandboxMode();

      let destinationAddress = formData.address;

      if (!isSandbox && isEvmNetwork) {
        // TestFlight reviewers use hardcoded address as their "smart account"
        const isTestFlight = isTestSessionActive();
        const smartAccount = isTestFlight
          ? TEST_ACCOUNTS.wallets.evm  // TestFlight: Use hardcoded address
          : (currentUser?.evmSmartAccounts?.[0] as string); // Real users: Use CDP Smart Account

        if (!smartAccount) {
          throw new Error('Smart Account required for EVM onramp transactions. Your balances are stored in the Smart Account. Please ensure your Embedded Wallet is properly initialized.');
        }
        destinationAddress = smartAccount;
        console.log('🔒 [ONRAMP] Using Smart Account for EVM transaction:', smartAccount);
      }

      // Map form values to API format (display names → API values)
      // Order creation: API call to Coinbase (auth handled by authenticatedFetch)
      const result = await createApplePayOrder({
        paymentAmount: formData.amount,
        paymentCurrency: formData.paymentCurrency,
        purchaseCurrency: getAssetSymbolFromName(formData.asset),
        paymentMethod: "GUEST_CHECKOUT_APPLE_PAY",
        destinationNetwork: networkName,
        destinationAddress: destinationAddress,
        email: userEmail || 'noemail@test.com', // Fallback (should never happen due to validation above)
        phoneNumber: phone,
        phoneNumberVerifiedAt: new Date(phoneAt!).toISOString(),
        partnerUserRef: partnerUserRef,
        agreementAcceptedAt: new Date().toISOString(),
        webhookUrl: `${process.env.EXPO_PUBLIC_BASE_URL}/webhooks/onramp`, // Webhook for push notifications
        isQuote: false
      });


      // Extract hosted URL and show WebView
      if (result.hostedUrl) {
        setHostedUrl(result.hostedUrl);
        setApplePayVisible(true);
      } else {
        throw new Error('No payment URL received');
      }
      
    
    } catch (error: any) {
      // Don't log expected validation errors (they're handled gracefully by the UI)
      if (error?.code !== 'MISSING_EMAIL' && error?.code !== 'MISSING_PHONE') {
        console.error('API Error:', error);
      }
      setIsProcessingPayment(false);
      throw error;
    }
  }, [getAssetSymbolFromName, getNetworkNameFromDisplayName, currentUser]);

  const createWidgetSession = useCallback(async (formData: OnrampFormData) => {
    setIsProcessingPayment(true);
    try {
      const assetSymbol = getAssetSymbolFromName(formData.asset);
      const networkName = getNetworkNameFromDisplayName(formData.network);
      const country = getCountry();
      let subdivision = getSubdivision();
      if (country === 'US' && !subdivision) {
        subdivision = 'CA';
        setSubdivision('CA');
      }

      // Generate unique user reference for transaction tracking
      // Widget: Use userId directly (no sandbox prefix needed)
      const userId = currentUser?.userId || 'unknown-user';
      const partnerUserRef = userId;
      setCurrentPartnerUserRef(partnerUserRef);

      // IMPORTANT: Register push token before transaction (ensures webhook can send notification)
      try {
        const { registerForPushNotifications, sendPushTokenToServer } = await import('@/utils/pushNotifications');
        const { getAccessTokenGlobal } = await import('@/utils/getAccessTokenGlobal');

        console.log('📱 [TRANSACTION] Pre-registering push token for:', partnerUserRef);
        const pushToken = await registerForPushNotifications();
        if (pushToken) {
          await sendPushTokenToServer(pushToken.token, partnerUserRef, getAccessTokenGlobal, pushToken.type);
          console.log('✅ [TRANSACTION] Push token registered successfully');
        }
      } catch (pushError) {
        console.warn('⚠️ [TRANSACTION] Failed to register push token:', pushError);
        // Don't block transaction if push token fails
      }

      // CRITICAL: For EVM networks, MUST use Smart Account (same as Apple Pay)
      const isEvmNetwork = ['base', 'ethereum', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'linea', 'zksync'].includes(networkName.toLowerCase());
      const isSolanaNetwork = networkName.toLowerCase().includes('solana');
      const isSandbox = getSandboxMode();

      let destinationAddress = formData.address;

      console.log('🎯 [WIDGET SESSION] Address before processing:', {
        formDataAddress: formData.address,
        network: networkName,
        isEvmNetwork,
        isSolanaNetwork,
        isSandbox,
        currentUserSolana: currentUser?.solanaAccounts?.[0],
        currentUserEvm: currentUser?.evmSmartAccounts?.[0]
      });

      if (!isSandbox && isEvmNetwork) {
        // TestFlight reviewers use hardcoded address as their "smart account"
        const isTestFlight = isTestSessionActive();
        const smartAccount = isTestFlight
          ? TEST_ACCOUNTS.wallets.evm  // TestFlight: Use hardcoded address
          : (currentUser?.evmSmartAccounts?.[0] as string); // Real users: Use CDP Smart Account

        if (!smartAccount) {
          throw new Error('Smart Account required for EVM onramp transactions. Your balances are stored in the Smart Account. Please ensure your Embedded Wallet is properly initialized.');
        }
        destinationAddress = smartAccount;
        console.log('🔒 [ONRAMP] Using Smart Account for EVM widget transaction:', smartAccount);
      } else if (!isSandbox && isSolanaNetwork) {
        // For Solana in production, use real Solana address from CDP
        const isTestFlight = isTestSessionActive();
        const solanaAddress = isTestFlight
          ? TEST_ACCOUNTS.wallets.solana  // TestFlight: Use hardcoded address
          : (currentUser?.solanaAccounts?.[0] as string); // Real users: Use CDP Solana Account

        if (!solanaAddress) {
          throw new Error('Solana account required for Solana onramp transactions. Please ensure your Embedded Wallet is properly initialized.');
        }
        destinationAddress = solanaAddress;
        console.log('🔒 [ONRAMP] Using Solana Account for Solana widget transaction:', solanaAddress);
      }

      // Auth handled by authenticatedFetch
      const res = await createOnrampSession({
        purchaseCurrency: assetSymbol,
        destinationNetwork: networkName,
        destinationAddress: destinationAddress,
        paymentAmount: formData.amount,
        paymentCurrency: formData.paymentCurrency,
        country,
        subdivision,
        webhookUrl: `${process.env.EXPO_PUBLIC_BASE_URL}/webhooks/onramp`, // Webhook for push notifications
      });

      let url = res?.session?.onrampUrl;
      const isTestSession = isTestSessionActive();

      // Replace URL for sandbox mode OR test accounts
      if ((getSandboxMode() || isTestSession) && url) {
        url = url.replace('pay.coinbase.com', 'pay-sandbox.coinbase.com');
      }

      // Add partnerUserId as URL parameter (temporary workaround until supported as body param)
      if (url) {
        const separator = url.includes('?') ? '&' : '?';
        url = `${url}${separator}partnerUserId=${encodeURIComponent(partnerUserRef)}`;
      }

      if (!url) throw new Error('No onrampUrl returned');
      return url;
    } finally {
      setIsProcessingPayment(false);
    }
  }, [getAssetSymbolFromName, getNetworkNameFromDisplayName, setIsProcessingPayment]);

  const closeApplePay = useCallback(() => {
    setApplePayVisible(false);
    setHostedUrl('');
    setIsProcessingPayment(false);
    setTransactionStatus(null);
  }, []);

  /**
   * Fetches available assets/networks from Coinbase API
   * Used to populate form dropdowns dynamically
   */
  const fetchOptions = useCallback(async () => {
    setIsLoadingOptions(true);
    setOptionsError(null); // Clear previous error
    try {
      const country = getCountry();
      let subdivision = getSubdivision();
      if (country === 'US' && !subdivision) subdivision = 'CA';
      const [opts, cfg] = await Promise.all([
        fetchBuyOptions({ country, subdivision }),
        fetchBuyConfig(),
      ]);
      setOptions(opts);
        // Filter countries to only those with CARD payment method (Buy & Send)
        const filteredConfig = {
          ...cfg,
          countries: (cfg?.countries || []).filter((country: any) =>
            country.payment_methods?.some((pm: any) => pm.id === 'CARD')
          )
      };
      setBuyConfig(filteredConfig);
      setOptionsError(null); // Success - clear error
    } catch (error) {
      console.error('Failed to fetch options:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load payment options';
      setOptionsError(errorMessage);
      // Keep any existing options instead of clearing (better UX)
    } finally {
      setIsLoadingOptions(false);
    }
  }, []);

  // hooks/useOnramp.ts - add comment about dual quote system
  /**
   * Quote fetching strategy:
   * - Apple Pay: Uses v2 orders API (USD only, requires phone)
   * - Coinbase Widget: Uses v2 session API (multi-currency based on options, no phone required)
   */
  const fetchQuote = useCallback(async (formData: {
    amount: string;
    asset: string;
    network: string;
    paymentCurrency: string;
    paymentMethod?: string;
  }) => {
    const amt = Number.parseFloat(formData?.amount as any);
    if (!formData.amount || !formData.asset || !formData.network || !Number.isFinite(amt) || amt <= 0) {
      setCurrentQuote(null);
      return;
    }

    try {
      setIsLoadingQuote(true);
      const assetSymbol = getAssetSymbolFromName(formData.asset);
      const networkName = getNetworkNameFromDisplayName(formData.network);

      // Auth handled by authenticatedFetch
      const quote = await fetchBuyQuote({
        paymentAmount: formData.amount,
        paymentCurrency: formData.paymentCurrency,
        purchaseCurrency: assetSymbol,
        destinationNetwork: networkName,
        paymentMethod: formData.paymentMethod || 'COINBASE_WIDGET'
      });

      setCurrentQuote(quote);
    } catch (error) {
      console.log('Failed to fetch quote (unsupported network or demo address unavailable):', error);
      setCurrentQuote(null);
    } finally {
      setIsLoadingQuote(false);
    }
  }, [getAssetSymbolFromName, getNetworkNameFromDisplayName]);

  // Helper functions that use the stored options
  const getAvailableNetworks = useCallback((selectedAsset?: string) => {
    if (!options?.purchase_currencies) return [
      { name: "ethereum", display_name: "Ethereum", icon_url: null },
      { name: "base", display_name: "Base", icon_url: null }
    ];
    
    if (!selectedAsset) {
      const allNetworks = options.purchase_currencies.flatMap((asset: any) => asset.networks);
      return [...new Map(allNetworks.map((net: any) => [net.name, net])).values()]; // Dedupe by name
    }
    
    const asset = options.purchase_currencies.find((a: any) => a.name === selectedAsset);
    return asset?.networks || [];
  }, [options]);

  const getAvailableAssets = useCallback((selectedNetwork?: string) => {
    if (!options?.purchase_currencies) return [
      { name: "USDC", symbol: "USDC", icon_url: null },
      { name: "ETH", symbol: "ETH", icon_url: null }
    ];
    
    if (!selectedNetwork) {
      return options.purchase_currencies; // Return full objects with icon_url
    }
    
    return options.purchase_currencies.filter((asset: any) => 
      asset.networks.some((network: any) => network.display_name === selectedNetwork)
    );
  }, [options]);

  const paymentCurrencies = useMemo(() => {
    const country = getCountry();
  
    // Try v1 options first (supports array of strings or objects with id)
    const fromOptions = Array.isArray(options?.payment_currencies)
      ? options.payment_currencies.map((c: any) => (typeof c === 'string' ? c : c?.id)).filter(Boolean)
      : [];
  
    if (fromOptions.length) return fromOptions;
  
    // Else derive from buyConfig by country
    const entry = Array.isArray(buyConfig?.countries)
      ? buyConfig.countries.find((c: any) => c.id === country)
      : null;
  
    const fromConfig =
      (Array.isArray(entry?.payment_currencies) && entry.payment_currencies) ||
      (Array.isArray(entry?.currencies) && entry.currencies) ||
      [];
  
    return fromConfig.length ? fromConfig : ['USD'];
  }, [options, buyConfig]);


  return {
    // State
    applePayVisible,
    hostedUrl,
    isProcessingPayment,
    transactionStatus,
    options,
    isLoadingOptions,
    optionsError,
    isLoadingQuote,
    currentQuote,
    paymentCurrencies,
    buyConfig,
    // Actions
    createOrder,
    createWidgetSession,
    closeApplePay,
    fetchOptions,
    getAvailableNetworks,
    getAvailableAssets,
    setTransactionStatus,
    setIsProcessingPayment,
    fetchQuote,
    // Helpers
    getNetworkNameFromDisplayName,
    getAssetSymbolFromName,
  };
}