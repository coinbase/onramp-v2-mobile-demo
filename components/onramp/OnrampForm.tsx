/**
 * ============================================================================
 * ONRAMP FORM - MAIN USER INTERFACE FOR CRYPTO PURCHASES
 * ============================================================================
 *
 * This is the central form where users configure their crypto purchase.
 * It handles complex relationships between assets, networks, payment methods.
 *
 * DYNAMIC FILTERING (Many-to-Many Relationships):
 *
 * Assets and Networks have a many-to-many relationship:
 * - USDC available on: Base, Ethereum, Polygon, Solana, etc.
 * - Base supports: USDC, ETH
 *
 * Form behavior:
 * 1. Select "Base" network → filters assets to only those available on Base
 * 2. Select "USDC" asset → filters networks to only those supporting USDC
 * 3. Auto-clears invalid selections when options change
 *
 * Implementation:
 * - getAvailableNetworks(asset) → returns networks for selected asset
 * - getAvailableAssets(network) → returns assets for selected network
 * - useEffect hooks auto-reset to first valid option if current becomes invalid
 *
 * NETWORK CHANGE HANDLING:
 *
 * When user changes network, address must update (network-aware routing):
 * 1. User selects "Solana" network
 * 2. Form detects network change (useEffect with prevNetworkRef)
 * 3. Calls getCurrentWalletAddress() from sharedState
 * 4. Gets Solana-specific address
 * 5. Calls onAddressChange() to update parent (index.tsx)
 * 6. Parent updates both address and connectedAddress states
 *
 * Using ref (prevNetworkRef) prevents infinite loops:
 * - Without ref: network change → address update → re-render → network change → loop
 * - With ref: only triggers when network actually changes, ignores address changes
 *
 * VALIDATION LOGIC:
 *
 * Three validation layers:
 * 1. Amount: Must be positive number, within payment method limits
 * 2. Address: Format validation based on network type
 *    - EVM: 0x + 40 hex characters
 *    - Solana: 32-44 base58 characters (no 0, O, I, l)
 *    - Sandbox: Any non-empty string (testing flexibility)
 * 3. Network Support: EVM/SOL only in production, any in sandbox
 *
 * NOTIFICATION CARDS (Context-Aware Messaging):
 *
 * Shows different cards based on state:
 * 1. Network Not Supported (prod, non-EVM/SOL): Orange warning
 * 2. Smart Account Required (prod, EVM, no smart account): Red error
 * 3. Wallet Required (prod, no address): Red error
 * 4. Address Required (sandbox, no address): Red error
 * 5. Sandbox Mode (sandbox, has address): Blue info
 * 6. Production Mode (prod, signed in): Red warning
 *
 * Card priority (first match wins):
 * - Unsupported network (highest priority - blocks all)
 * - Smart Account missing for EVM networks
 * - Invalid address for current network
 * - Sandbox/Production status info
 *
 * PAYMENT METHOD RESTRICTIONS:
 *
 * Apple Pay (GUEST_CHECKOUT_APPLE_PAY):
 * - USD only (auto-forces USD when selected)
 * - US residents only (filtered by country)
 * - $0-$500 limit
 *
 * Coinbase Widget (COINBASE_WIDGET):
 * - Multi-currency (based on buy options API)
 * - Multiple payment methods (Card, ACH, etc.)
 * - Limit depends on payment method selected in widget
 *
 * displayCurrencies memo:
 * - Apple Pay: Always ['USD']
 * - Widget: Uses paymentCurrencies from API (USD, EUR, GBP, etc.)
 *
 * @see hooks/useOnramp.ts for API orchestration
 * @see utils/sharedState.ts for getCurrentWalletAddress() logic
 * @see components/ui/SwipeToConfirm.tsx for submission gesture
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { COLORS } from '../../constants/Colors';
import { TEST_ACCOUNTS } from '../../constants/TestAccounts';
import { getCountry, getPendingForm, getSandboxMode, getSubdivision, isTestSessionActive, setCountry, setCurrentNetwork, setSandboxMode, setSubdivision } from '../../utils/sharedState';
import { SwipeToConfirm } from '../ui/SwipeToConfirm';

const { BLUE, DARK_BG, CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY, WHITE, SILVER } = COLORS;

export type OnrampFormData = {
  amount: string;
  asset: string;
  network: string;
  address: string;
  sandbox: boolean;
  paymentMethod: string;
  paymentCurrency: string;
  phoneNumber?: string;
  agreementAcceptedAt?: string;
};

type OnrampFormProps = {
  address: string;
  onAddressChange: (address: string) => void;
  onSubmit: (data: OnrampFormData) => void;
  isLoading: boolean;
  options: any;
  isLoadingOptions: boolean;
  getAvailableNetworks: (selectedAsset?: string) => any[];
  getAvailableAssets: (selectedNetwork?: string) => any[];
  currentQuote: any;
  isLoadingQuote: boolean;
  fetchQuote: (formData: any) => void;
  paymentCurrencies: string[];
  amount: string;
  onAmountChange: (amount: string) => void;
  sandboxMode?: boolean; // Add sandbox prop
  buyConfig?: any;
};

/**
 * Main form component with dynamic asset/network selection
 * Assets and networks are filtered based on each other (many-to-many relationship)
 */
export function OnrampForm({
  address,
  onAddressChange,
  onSubmit,
  isLoading,
  options,
  isLoadingOptions,
  getAvailableNetworks,
  getAvailableAssets,
  currentQuote,
  isLoadingQuote,
  fetchQuote,
  paymentCurrencies,
  amount,
  onAmountChange,
  sandboxMode,
  buyConfig
}: OnrampFormProps) {
  // Import hooks for production card visibility and Smart Account check
  const { useIsSignedIn, useCurrentUser } = require('@coinbase/cdp-hooks');
  const { isSignedIn } = useIsSignedIn();
  const { currentUser } = useCurrentUser();

  const [asset, setAsset] = useState("USDC");
  const [network, setNetwork] = useState("Base");
  const [paymentMethod, setPaymentMethod] = useState("GUEST_CHECKOUT_APPLE_PAY");
  const [assetPickerVisible, setAssetPickerVisible] = useState(false);
  const [networkPickerVisible, setNetworkPickerVisible] = useState(false);
  const [paymentPickerVisible, setPaymentPickerVisible] = useState(false);
  const [paymentCurrency, setPaymentCurrency] = useState("USD");
  const [paymentCurrencyPickerVisible, setPaymentCurrencyPickerVisible] = useState(false);
  const [isSwipeActive, setIsSwipeActive] = useState(false);
  const [agreementTimestamp, setAgreementTimestamp] = useState<number | null>(null);
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetTranslate = useRef(new Animated.Value(300)).current;
  const isApplePay = paymentMethod === 'GUEST_CHECKOUT_APPLE_PAY';
  const [localSandboxEnabled, setLocalSandboxEnabled] = useState(getSandboxMode());
  const [countryPickerVisible, setCountryPickerVisible] = useState(false);
const [subPickerVisible, setSubPickerVisible] = useState(false);
const [country, setCountryLocal] = useState(getCountry());
const [subdivision, setSubdivisionLocal] = useState(getSubdivision());

const countries = useMemo(() => {
  const src = buyConfig?.countries ?? options?.countries;
  return src?.map((c: any) => c.id).filter(Boolean) ?? [];
}, [buyConfig, options]);

const usSubs = useMemo(() => {
  const src = buyConfig?.countries ?? options?.countries;
  return src?.find((c: any) => c.id === 'US')?.subdivisions ?? [];
}, [buyConfig, options]);

  const isEvmNetwork = (() => {
    const n = (network || '').toLowerCase();
    const evmList = [
      'ethereum','base','polygon','arbitrum','optimism','avalanche','avax','bsc',
      'fantom','linea','zksync','scroll'
    ];
    return evmList.some((k) => n.includes(k));
  })();

  const isSolanaNetwork = (() => {
    const n = (network || '').toLowerCase();
    const solanaList = ['solana', 'sol'];
    return solanaList.some((k) => n.includes(k));
  })();

  const displayCurrencies = React.useMemo(() => {
    const list = Array.isArray(paymentCurrencies) && paymentCurrencies.length ? paymentCurrencies : ['USD'];
    return isApplePay ? ['USD'] : list;
  }, [isApplePay, paymentCurrencies]);

  useEffect(() => {
    // if Apple Pay selected, force USD
    if (isApplePay && paymentCurrency !== 'USD')
      setPaymentCurrency('USD');
  }, [isApplePay, paymentCurrency]);

  // Track network changes in shared state
  useEffect(() => {
    setCurrentNetwork(network);
  }, [network]);

  // Separate effect to update address when network changes (to avoid recursion)
  const prevNetworkRef = useRef(network);
  useEffect(() => {
    // Only run when network actually changes (not on initial mount or address changes)
    if (prevNetworkRef.current === network) return;
    prevNetworkRef.current = network;

    if (!localSandboxEnabled && (isEvmNetwork || isSolanaNetwork)) {
      // Only update address for supported networks (EVM/Solana) in production mode
      // For unsupported networks (Noble, etc.), don't auto-update
      const { getCurrentWalletAddress } = require('../../utils/sharedState');
      const newAddress = getCurrentWalletAddress();
      if (newAddress && newAddress !== address) {
        onAddressChange(newAddress);
      }
    }
  }, [network, address, onAddressChange, isEvmNetwork, isSolanaNetwork, localSandboxEnabled]);
  

  const amountNumber = useMemo(() => {
    const cleaned = amount.replace(/,/g, "");
    const parsed = Number.parseFloat(cleaned);
    return Number.isFinite(parsed) ? parsed : NaN;
  }, [amount]);

  const isAmountValid = Number.isFinite(amountNumber) && amountNumber > 0;
  const isEvmAddressValid = /^0x[0-9a-fA-F]{40}$/.test(address);
  const isSolanaAddressValid = (() => {
    // Basic Solana address validation: 32-44 characters, base58 encoded
    if (!address || address.length < 32 || address.length > 44) return false;
    // Check if it looks like base58 (no 0, O, I, l characters)
    return /^[1-9A-HJ-NP-Za-km-z]+$/.test(address);
  })();

  // Use local state as single source of truth for sandbox mode
  const isSandbox = localSandboxEnabled;

  // Check if Smart Account is available for EVM networks (production only)
  // TestFlight reviewers use hardcoded address as their "smart account"
  const isTestFlight = isTestSessionActive();
  const smartAccount = isTestFlight
    ? TEST_ACCOUNTS.wallets.evm  // TestFlight: Use hardcoded address
    : (currentUser?.evmSmartAccounts?.[0] as string | undefined); // Real users: Use CDP Smart Account
  const needsSmartAccount = !isSandbox && isEvmNetwork;
  const hasSmartAccount = !!smartAccount;

  const hasValidAddress = isSandbox
    ? !!address && address.trim().length > 0  // In sandbox, just need any non-empty address
    : (isEvmNetwork ? isEvmAddressValid :
       isSolanaNetwork ? isSolanaAddressValid : false); // In production, need valid address for supported networks

  // For production EVM networks, must have Smart Account
  const isFormValid = isAmountValid && !!network && !!asset && hasValidAddress && (!needsSmartAccount || hasSmartAccount);

  /**
   * Dynamic filtering: changing asset updates available networks, and vice versa
   * 
   * Data Flow:
   * 1. fetchBuyOptions() → loads all combinations
   * 2. getAvailableAssets(network) → filters by network
   * 3. getAvailableNetworks(asset) → filters by asset
   * 4. useEffect hooks → auto-clear invalid selections
   */

  const availableNetworks = useMemo(() => {
    if (!getAvailableNetworks) return ["ethereum", "base"]; // Fallback (shouldn't happen)
    return getAvailableNetworks(asset);
  }, [asset, getAvailableNetworks]);

  const availableAssets = useMemo(() => {
    if (!getAvailableAssets) return ["USDC", "ETH"]; // Fallback (shouldn't happen)
    return getAvailableAssets(network);
  }, [network, getAvailableAssets]);

  const methods = useMemo(() => {
    const arr = [{ display: 'Coinbase Widget', value: 'COINBASE_WIDGET' }];
    if (country === 'US' && paymentCurrency === 'USD') {
      arr.push({ display: 'Apple Pay API', value: 'GUEST_CHECKOUT_APPLE_PAY' });
    }
    return arr;
  }, [country, paymentCurrency]);
  
  useEffect(() => {
    if (!displayCurrencies.includes(paymentCurrency)) {
      setPaymentCurrency(displayCurrencies[0] || 'USD');
    }
  }, [displayCurrencies, paymentCurrency]);

  useEffect(() => {
    if (!paymentCurrencies?.length) return;
    if (!paymentCurrencies.includes(paymentCurrency)) {
      setPaymentCurrency(paymentCurrencies[0] || 'USD');
    }
  }, [paymentCurrencies, paymentCurrency]);

  useEffect(() => {
    if (!methods.some(m => m.value === paymentMethod)) {
      setPaymentMethod(methods[0]?.value || 'COINBASE_WIDGET');
    }
  }, [methods, paymentMethod]);

  // Initialize sandbox mode from shared state on mount only
  // After that, local state is the single source of truth
  useEffect(() => {
    const sharedSandboxMode = getSandboxMode();
    console.log('🔄 [SANDBOX INIT] Initializing from shared state:', sharedSandboxMode);
    setLocalSandboxEnabled(sharedSandboxMode);
  }, []); // Only run once on mount

  // Reset sandbox mode to true (safe default) when user signs in/out
  // EXCEPT when there's a pending form - restore user's choice from pending form
  useEffect(() => {
    if (currentUser?.userId) {
      const pending = getPendingForm();
      if (pending && typeof pending.sandbox === 'boolean') {
        // User is returning from phone re-verification with a saved form
        // Restore their sandbox choice from the pending form
        console.log('👤 [SANDBOX RESTORE] Restoring from pending form, sandbox =', pending.sandbox);
        setLocalSandboxEnabled(pending.sandbox);
        setSandboxMode(pending.sandbox);
      } else {
        // Fresh login - reset to safe default (sandbox mode)
        console.log('👤 [SANDBOX RESET] Fresh login, resetting to safe default (true)');
        setLocalSandboxEnabled(true);
        setSandboxMode(true);
      }
    }
  }, [currentUser?.userId]);

  const getPaymentMethodDisplay = (value: string) => {
    const method = methods.find(m => m.value === value);
    return method?.display || value;
  };

  // Auto-clear invalid selections when options change
  useEffect(() => {
    // If current network is no longer valid for selected asset, reset to first available
    if (asset && availableNetworks.length > 0) {
      const networkExists = availableNetworks.some((net: any) => 
        net.display_name === network || net.name === network
      );
      if (!networkExists) {
        const firstNetwork: any = availableNetworks[0];
        setNetwork(firstNetwork?.display_name || firstNetwork?.name || "");
      }
    }
  }, [asset, availableNetworks, network]);

  useEffect(() => {
    // If current asset isn't available for selected network, clear it
    if (network && availableAssets.length > 0) {
      const assetExists = availableAssets.some((assetObj: any) => 
        assetObj.name === asset || assetObj.symbol === asset
      );
      if (!assetExists) {
        const firstAsset: any = availableAssets[0];
        setAsset(firstAsset?.name || firstAsset?.symbol || "");
      }
    }
  }, [network, availableAssets, asset]);

  useEffect(() => {
    if (assetPickerVisible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(sheetTranslate, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 90 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(sheetTranslate, { toValue: 300, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [assetPickerVisible]);

  useEffect(() => {
    if (networkPickerVisible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(sheetTranslate, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 90 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(sheetTranslate, { toValue: 300, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [networkPickerVisible]);

  useEffect(() => {
    if (paymentPickerVisible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(sheetTranslate, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 90 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(sheetTranslate, { toValue: 300, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [paymentPickerVisible]);

  useEffect(() => {
    if (paymentCurrencyPickerVisible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(sheetTranslate, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 90 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(sheetTranslate, { toValue: 300, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [paymentCurrencyPickerVisible]);

  // Animate country picker modal
  useEffect(() => {
    if (countryPickerVisible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(sheetTranslate, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 90 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(sheetTranslate, { toValue: 300, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [countryPickerVisible]);

  // Animate subdivision picker modal
  useEffect(() => {
    if (subPickerVisible) {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(sheetTranslate, { toValue: 0, useNativeDriver: true, damping: 20, stiffness: 90 }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(backdropOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.timing(sheetTranslate, { toValue: 300, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [subPickerVisible]);

  // If user switches to a non‑supported network, clear the address (only in production mode)
  // In sandbox mode, allow any address for any network
  useEffect(() => {
    if (!localSandboxEnabled && !isEvmNetwork && !isSolanaNetwork && address) {
      onAddressChange('');
    }
  }, [isEvmNetwork, isSolanaNetwork, address, onAddressChange, localSandboxEnabled]);

  const getCurrencyLimits = useCallback(() => {
    if (!options?.payment_currencies) return null;
    
    const currency = options.payment_currencies.find((c: any) => c.id === paymentCurrency);
    if (!currency?.limits) return null;
    
    if (paymentMethod === 'GUEST_CHECKOUT_APPLE_PAY') {
      return {
        min: 0,
        max: 500,
        currency: paymentCurrency,
        display: `$0 - $500 ${paymentCurrency}`,
        quotePaymentMethod: 'GUEST_CHECKOUT_APPLE_PAY'
      };
    } else if (paymentMethod === 'COINBASE_WIDGET') {
      const allLimits = currency.limits || [];
      if (!allLimits.length) return null;
      
      // Find the best payment method for current amount
      let bestMethod = 'CARD'; // default fallback
      if (Number.isFinite(amountNumber) && amountNumber > 0) {
        // First check if CARD can handle this amount
        const cardLimit = allLimits.find((l: any) => l.id === 'CARD');
        if (cardLimit && amountNumber >= Number(cardLimit.min) && amountNumber <= Number(cardLimit.max)) {
          bestMethod = 'CARD'; // Use CARD if it can handle the amount
        } else {
          // CARD can't handle it, find alternative with higher limit
          const validMethods = allLimits.filter((l: any) => {
            const min = Number(l.min);
            const max = Number(l.max);
            return amountNumber >= min && amountNumber <= max && Number(l.max) > Number(cardLimit?.max || 0);
          });
          
          if (validMethods.length > 0) {
            // Use the method with highest limit among valid alternatives
            bestMethod = validMethods.reduce((best: any, current: any) => 
              Number(current.max) > Number(best.max) ? current : best
            ).id;
          }
        }
      }
      
      const limitTexts = allLimits.map((l: any) => {
        const method = l.id.replace('_', ' ').toLowerCase();
        const min = Number(l.min).toLocaleString();
        const max = Number(l.max).toLocaleString();
        return `${method}: ${min}-${max} ${paymentCurrency}`;
      });
      
      return {
        min: Math.min(...allLimits.map((l: any) => Number(l.min))),
        max: Math.max(...allLimits.map((l: any) => Number(l.max))),
        currency: paymentCurrency,
        display: limitTexts.join(' • '),
        quotePaymentMethod: bestMethod
      };
    }
    
    return null;
  }, [options, paymentCurrency, paymentMethod, amountNumber]);

  const limits = getCurrencyLimits();

  // Debounced quote fetching
  useEffect(() => {    
    const timeoutId = setTimeout(() => {
      if (amount && asset && network) {
        const limits = getCurrencyLimits();
        const quoteMethod = limits?.quotePaymentMethod || 'CARD';
        
        fetchQuote?.({ 
          amount, 
          asset, 
          network, 
          paymentCurrency, 
          paymentMethod: paymentMethod === 'COINBASE_WIDGET' ? quoteMethod : paymentMethod
        });
      } else {
        console.log('Missing required fields for quote');
      }
    }, 500);
    
    return () => clearTimeout(timeoutId);
  }, [amount, asset, network, paymentCurrency, fetchQuote, paymentMethod, getCurrencyLimits]);

  const amountError = useMemo(() => {
    if (!limits || !amount || !Number.isFinite(amountNumber)) return null;
    
    if (amountNumber < limits.min) {
      return `Minimum amount is ${limits.min.toLocaleString()} ${limits.currency}`;
    }
    
    if (amountNumber > limits.max) {
      return `Maximum amount is ${limits.max.toLocaleString()} ${limits.currency}`;
    }
    
    return null;
  }, [limits, amount, amountNumber]);

  /**
   * Form submission: directly calls API
   * Validation: amount > 0, valid 0x address, asset/network selected
   */
  const handleSwipeConfirm = useCallback((reset: () => void) => {
    if (!isFormValid) {
      console.log('Form is invalid or no quote, resetting slider');
      reset();
      return;
    }

    // localSandboxEnabled is the single source of truth
    console.log('🔍 [FORM SUBMIT] Submitting with sandbox =', localSandboxEnabled);

    onSubmit({
      amount: amount,
      asset,
      network,
      address,
      paymentMethod,
      paymentCurrency,
      sandbox: localSandboxEnabled, // Single source of truth
      agreementAcceptedAt: agreementTimestamp ? new Date(agreementTimestamp).toISOString() : new Date().toISOString(),
    });
  }, [isFormValid, currentQuote, asset, network, address, localSandboxEnabled, paymentMethod, paymentCurrency, onSubmit, agreementTimestamp]);
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      scrollEnabled={!isSwipeActive}
      contentInsetAdjustmentBehavior="automatic"
      removeClippedSubviews={false}
      bounces
      overScrollMode="always"
    >
      {/* Environment Card (Sandbox / Production) */}
      <View style={styles.card}>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentLabel}>
            {localSandboxEnabled ? 'Sandbox Environment' : 'Production Environment'}
          </Text>
          <Switch
            value={localSandboxEnabled}
            onValueChange={(value) => {
              console.log('🔄 [SANDBOX TOGGLE] User toggled sandbox to:', value);
              setLocalSandboxEnabled(value); // Single source of truth
              setSandboxMode(value); // Sync to shared state for other components
            }}
            trackColor={{ true: BLUE, false: BORDER }}
            thumbColor={Platform.OS === 'android' ? (localSandboxEnabled ? '#ffffff' : '#f4f3f4') : undefined}
          />
        </View>
        <Text style={styles.helper}>
          {localSandboxEnabled ? 'Test without real transactions' : 'Real transactions will be executed'}
        </Text>
      </View>

      {/* Buy Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Buy</Text>
        <View style={styles.inputRow}>
        <TextInput
          value={amount}
            onChangeText={onAmountChange}
            placeholder="0"
            placeholderTextColor={TEXT_SECONDARY}
            keyboardType="decimal-pad"
            style={styles.amountInput}
          />
          <Pressable 
            style={styles.currencyTag}
            onPress={() => setPaymentCurrencyPickerVisible(true)} // Make it clickable
          >
            <Text style={styles.currencyText}>{paymentCurrency}</Text>
            <Ionicons name="chevron-down" size={16} color={TEXT_SECONDARY} />
          </Pressable>
        </View>
          {/* Show error or limits */}
          {amountError ? (
            <Text style={styles.errorText}>{amountError}</Text>
          ) : limits ? (
            <View>
            <Text style={styles.limitsText}>
              {limits.display}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Receive Card */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Receive</Text>
        <View style={styles.inputRow}>
          <View style={styles.receiveAmountContainer}>
            {isLoadingQuote ? (
              <ActivityIndicator size="small" color={BLUE} />
            ) : (
              <Text style={styles.receiveAmount}>
                {currentQuote?.purchase_amount?.value || '0'}
              </Text>
            )}
      </View>
          <Pressable style={styles.assetSelect} onPress={() => setAssetPickerVisible(true)}>
            <View style={styles.selectContent}>
              {(() => {
                const selectedAssetObj = availableAssets.find((assetObj: any) => 
                  assetObj.name === asset || assetObj.symbol === asset
                );
                return selectedAssetObj?.icon_url && (
                  <Image 
                    source={{ uri: selectedAssetObj.icon_url }} 
                    style={styles.assetIcon}
                  />
                );
              })()}
              <Text style={styles.assetText}>{asset}</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color={TEXT_SECONDARY} />
        </Pressable>
      </View>

        {/* Network Row */}
        <View style={styles.networkRow}>
          <Text style={styles.networkLabel}>Network</Text>
          <Pressable style={styles.networkSelect} onPress={() => setNetworkPickerVisible(true)}>
            <View style={styles.selectContent}>
              {(() => {
                const selectedNetworkObj = availableNetworks.find((net: any) => 
                  net.display_name === network || net.name === network
                );
                return selectedNetworkObj?.icon_url && (
                  <Image 
                    source={{ uri: selectedNetworkObj.icon_url }} 
                    style={styles.networkIcon}
                  />
                );
              })()}
               <View style={styles.selectTextContainer}>
                 <Text style={styles.networkText}>{network}</Text>
               </View>
               </View>
             <Ionicons name="chevron-down" size={16} color={TEXT_SECONDARY} style={styles.selectChevron} />
          </Pressable>
        </View>
      </View>

      {/* Payment Method Card */}
      <View style={styles.card}>
        <View style={styles.paymentRow}>
          <Text style={styles.paymentLabel}>Pay with</Text>
          <Pressable style={styles.paymentSelect} onPress={() => setPaymentPickerVisible(true)}>
            <View style={styles.selectContent}>
              <Text style={styles.paymentText}>{getPaymentMethodDisplay(paymentMethod)}</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color={TEXT_SECONDARY} />
        </Pressable>
        </View>
      </View>

  
      {/* Sandbox Toggle
      <View style={styles.switchRow}>
        <Text style={styles.label}>Sandbox Environment</Text>
        <Switch
          value={sandbox}
          onValueChange={setSandbox}
          trackColor={{ true: BLUE, false: BORDER }}
          thumbColor={Platform.OS === "android" ? (sandbox ? "#ffffff" : "#f4f3f4") : undefined}
        />
      </View> */}
  
      {/* Quote Summary */}
      {currentQuote && (
        <View style={styles.quoteCard}>
          <View style={styles.quoteRow}>
            <Text style={styles.quoteLabel}>Purchase amount</Text>
            <Text style={styles.quoteValue}>
              ${currentQuote.payment_subtotal?.value || currentQuote.paymentSubtotal?.value || '0'}
            </Text>
      </View>
          <View style={styles.quoteRow}>
            <Text style={styles.quoteLabel}>Coinbase fee</Text>
            <Text style={styles.quoteValue}>
              ${currentQuote.coinbase_fee?.value || currentQuote.coinbaseFee?.value || '0'}
            </Text>
          </View>
          <View style={styles.quoteRow}>
            <Text style={styles.quoteLabel}>Network fee</Text>
            <Text style={styles.quoteValue}>
              ${currentQuote.network_fee?.value || currentQuote.networkFee?.value || '0'}
            </Text>
          </View>
          <View style={[styles.quoteRow, styles.quoteTotalRow]}>
            <Text style={styles.quoteTotalLabel}>Total</Text>
            <Text style={styles.quoteTotalValue}>
              ${currentQuote.payment_total?.value || currentQuote.paymentTotal?.value || '0'}
            </Text>
          </View>
        </View>
      )}

        {/* Quote Disclaimer */}
        {currentQuote && paymentMethod === 'COINBASE_WIDGET' && limits?.quotePaymentMethod && (
        <View style={styles.disclaimerCard}>
          <Text style={styles.disclaimerText}>
            💡 Quote based on {limits.quotePaymentMethod} payment method. 
            Final pricing may vary if you select a different payment method during checkout.
          </Text>
        </View>
      )}

      {/* Wallet Notification */}
      {!localSandboxEnabled && !isEvmNetwork && !isSolanaNetwork ? (
        <View style={styles.notificationCard}>
          <View style={styles.notificationHeader}>
            <Ionicons name="information-circle" size={20} color="#FF8C00" />
            <Text style={styles.notificationTitle}>Network Not Supported</Text>
          </View>
          <Text style={styles.notificationText}>
            This network is available for Onramp, but Embedded Wallet is not supported at the moment. Try it out in Sandbox mode, or select an EVM or Solana network to proceed.
          </Text>
        </View>
      ) : needsSmartAccount && !hasSmartAccount ? (
        <View style={[styles.notificationCard, styles.errorCard]}>
          <View style={styles.notificationHeader}>
            <Ionicons name="alert-circle" size={20} color="#FF6B6B" />
            <Text style={[styles.notificationTitle, { color: '#FF6B6B' }]}>Smart Account Required</Text>
          </View>
          <Text style={styles.notificationText}>
            EVM onramp transactions require a Smart Account to receive funds. Your balances are stored in the Smart Account. Please ensure your Embedded Wallet is properly initialized.
          </Text>
        </View>
      ) : !localSandboxEnabled && !hasValidAddress ? (
        <View style={[styles.notificationCard, styles.errorCard]}>
          <View style={styles.notificationHeader}>
            <Ionicons name="alert-circle" size={20} color="#FF6B6B" />
            <Text style={[styles.notificationTitle, { color: '#FF6B6B' }]}>Wallet Required</Text>
          </View>
          <Text style={styles.notificationText}>
            Connect a valid {isEvmNetwork ? 'EVM' : isSolanaNetwork ? 'Solana' : 'wallet'} address to continue
          </Text>
        </View>
      ) : localSandboxEnabled && !address ? (
        <View style={[styles.notificationCard, styles.errorCard]}>
          <View style={styles.notificationHeader}>
            <Ionicons name="alert-circle" size={20} color="#FF6B6B" />
            <Text style={[styles.notificationTitle, { color: '#FF6B6B' }]}>Address Required</Text>
          </View>
          <Text style={styles.notificationText}>
            Enter a wallet address in Profile → Sandbox Wallet, or connect an Embedded Wallet to continue testing.
          </Text>
        </View>
      ) : localSandboxEnabled ? (
        <View style={[styles.notificationCard, styles.sandboxCard]}>
          <View style={styles.notificationHeader}>
            <Ionicons name="flask" size={20} color={BLUE} />
            <Text style={[styles.notificationTitle, { color: BLUE }]}>Sandbox Mode</Text>
          </View>
          <Text style={styles.notificationText}>
            Testing with address:{' '}
            <Text style={styles.addressMono}>{address}</Text>
          </Text>

          <Text style={[styles.notificationText, styles.italicNote]}>
            Head to the <Text style={styles.badgeProd}>Wallet</Text> page to override with a manual wallet address.
          </Text>
        </View>
      ) : isSignedIn ? (
        <View style={[styles.notificationCard, styles.productionCard]}>
          <View style={styles.notificationHeader}>
            <Ionicons name="warning" size={20} color="#FF6B6B" />
            <Text style={[styles.notificationTitle, { color: '#FF6B6B' }]}>Production Mode</Text>
          </View>
          <Text style={[styles.notificationText, { fontWeight: '600' }]}>
            Real transactions will be executed on-chain if successful
          </Text>
          {address ? (
            <Text style={[styles.notificationText, { marginTop: 8, fontFamily: 'monospace' }]}>
              Using wallet: {address}
            </Text>
          ) : !isEvmNetwork && !isSolanaNetwork ? (
            <Text style={[styles.notificationText, { marginTop: 8, fontStyle: 'italic', color: TEXT_SECONDARY }]}>
              Network not supported for embedded wallets
            </Text>
          ) : null}
        </View>
      ) : null}
  
      <SwipeToConfirm
        label="Swipe to Deposit"
        disabled={!isFormValid}
        onConfirm={handleSwipeConfirm}
        isLoading={isLoading}
        onSwipeStart={() => setIsSwipeActive(true)}
        onSwipeEnd={() => setIsSwipeActive(false)}
      />

      {/* Terms Agreement */}
      <View style={styles.termsContainer}>
        <Text style={styles.termsText}>
          By proceeding, I agree to Coinbase's{' '}
          <Text style={styles.termsLink} onPress={() => Linking.openURL('https://www.coinbase.com/legal/guest-checkout/us')}>Guest Checkout Terms</Text>,{' '}
          <Text style={styles.termsLink} onPress={() => Linking.openURL('https://www.coinbase.com/legal/user_agreement/united_states')}>User Agreement</Text>, and{' '}
          <Text style={styles.termsLink} onPress={() => Linking.openURL('https://www.coinbase.com/legal/privacy')}>Privacy Policy</Text>
        </Text>
      </View>

      {/* Region (Country / Subdivision) */}
      <View style={[styles.card, styles.regionCard]}>
        <Text style={styles.cardTitle}>Available Asset Options</Text>

        <View style={styles.paymentRow}>
          <Text style={styles.regionLabel}>Country</Text>
          <Pressable style={styles.regionSelect} onPress={() => setCountryPickerVisible(true)}>
            <View style={styles.selectContent}>
              <Text style={styles.regionSelectText}>{country}</Text>
            </View>
            <Ionicons name="chevron-down" size={16} color={TEXT_SECONDARY} />
          </Pressable>
        </View>

        {country === 'US' && (
          <View style={[styles.paymentRow, { marginTop: 8 }]}>
            <Text style={styles.regionLabel}>Subdivision</Text>
            <Pressable style={styles.regionSelect} onPress={() => setSubPickerVisible(true)}>
              <View style={styles.selectContent}>
                <Text style={styles.regionSelectText}>{subdivision || 'Select'}</Text>
              </View>
              <Ionicons name="chevron-down" size={16} color={TEXT_SECONDARY} />
            </Pressable>
          </View>
        )}
      </View>
  
      {/* All existing modals */}
      {/* Payment Currency picker modal */}
      <Modal 
        visible={paymentCurrencyPickerVisible} 
        transparent 
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={() => setPaymentCurrencyPickerVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {/* Backdrop - click to dismiss */}
          <Animated.View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropOpacity }]}
          >
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setPaymentCurrencyPickerVisible(false)} />
          </Animated.View>

          {/* Sheet with handle */}
          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetTranslate }] }]}>
            {/* Handle bar */}
            <View style={styles.modalHandle} />
            
            <ScrollView 
              style={styles.modalScrollView}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
            {displayCurrencies.map((currency, index) => {
              const isSelected = currency === paymentCurrency;
              return (
                <Pressable
                  key={`currency-${index}-${currency}`}
                  onPress={() => {
                    setPaymentCurrency(currency);
                    setPaymentCurrencyPickerVisible(false);
                  }}
                  style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                >
                    <View style={styles.modalItemContent}>
                      <View style={styles.modalItemLeft}>
                        <Text style={[styles.modalItemText, isSelected && styles.modalItemTextSelected]}>
                          {currency}
                        </Text>
                      </View>
                      <View style={styles.modalItemRight}>
                        {isSelected && (
                          <Ionicons name="checkmark" size={20} color={BLUE} />
                        )}
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
      {/* Asset picker modal */}
      <Modal
        visible={assetPickerVisible}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={() => setAssetPickerVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          {/* Backdrop - click to dismiss */}
          <Animated.View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropOpacity }]}
          >
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setAssetPickerVisible(false)} />
          </Animated.View>

          {/* Sheet with handle */}
          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetTranslate }] }]}>
            {/* Handle bar */}
            <View style={styles.modalHandle} />
            
            <ScrollView 
              style={styles.modalScrollView}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {availableAssets.map((assetOption: any, index: number) => {
                const displayName = assetOption.name || assetOption.symbol || 'Unknown Asset';
                const iconUrl = assetOption.icon_url;
                const isSelected = displayName === asset;
                
                return (
              <Pressable
                    key={`asset-${index}-${displayName}`}
                onPress={() => {
                      setAsset(displayName);
                  setAssetPickerVisible(false);
                }}
                    style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                  >
                    <View style={styles.modalItemContent}>
                      <View style={styles.modalItemLeft}>
                        {iconUrl && (
                          <Image 
                            source={{ uri: iconUrl }} 
                            style={styles.modalItemIcon}
                          />
                        )}
                        <Text style={[styles.modalItemText, isSelected && styles.modalItemTextSelected]}>
                          {displayName}
                        </Text>
          </View>
                      {isSelected && (
                        <Ionicons name="checkmark" size={20} color={BLUE} />
                      )}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Network picker modal */}
      <Modal
        visible={networkPickerVisible}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={() => setNetworkPickerVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropOpacity }]}
          >
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setNetworkPickerVisible(false)} />
          </Animated.View>

          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetTranslate }] }]}>
            <View style={styles.modalHandle} />
            
            <ScrollView 
              style={styles.modalScrollView}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {isLoadingOptions ? (
                <View style={styles.modalItem}>
                  <Text style={styles.modalItemText}>Loading networks...</Text>
                </View>
              ) : (
                availableNetworks.map((networkOption: any, index: number) => {
                  const displayName = networkOption.display_name || networkOption.name || 'Unknown Network';
                  const iconUrl = networkOption.icon_url;
                  const isSelected = displayName === network;
                  
                  return (
              <Pressable
                      key={`network-${index}-${displayName}`}
                onPress={() => {
                        setNetwork(displayName);
                  setNetworkPickerVisible(false);
                }}
                      style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                    >
                      <View style={styles.modalItemContent}>
                        <View style={styles.modalItemLeft}>
                          {iconUrl && (
                            <Image 
                              source={{ uri: iconUrl }} 
                              style={styles.modalItemIcon}
                            />
                          )}
                          <Text style={[styles.modalItemText, isSelected && styles.modalItemTextSelected]}>
                            {displayName}
                          </Text>
          </View>
                        {isSelected && (
                          <Ionicons name="checkmark" size={20} color={BLUE} />
                        )}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Payment method picker modal */}
      <Modal
        visible={paymentPickerVisible}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={() => setPaymentPickerVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View
            style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropOpacity }]}
          >
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setPaymentPickerVisible(false)} />
          </Animated.View>

          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetTranslate }] }]}>
            <View style={styles.modalHandle} />
            
            <ScrollView 
              style={styles.modalScrollView}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {methods.map((method, index) => {
                const isSelected = method.value === paymentMethod;
                
                return (
              <Pressable
                    key={`payment-${index}-${method.value}`}
                onPress={() => {
                      setPaymentMethod(method.value);
                  setPaymentPickerVisible(false);
                }}
                    style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                  >
                    <View style={styles.modalItemContent}>
                      <View style={styles.modalItemLeft}>
                        <Text style={[styles.modalItemText, isSelected && styles.modalItemTextSelected]}>
                          {method.display}
                        </Text>
                      </View>
                      {isSelected && (
                        <Ionicons name="checkmark" size={20} color={BLUE} />
                      )}
                    </View>
              </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>

      {/* Country picker modal */}
      <Modal
        visible={countryPickerVisible}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={() => setCountryPickerVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropOpacity }]}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setCountryPickerVisible(false)} />
          </Animated.View>

          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetTranslate }] }]}>
            <View style={styles.modalHandle} />
            <ScrollView style={styles.modalScrollView} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {countries.map((c: string, index: number) => {
                const isSelected = c === country;
                return (
                  <Pressable
                    key={`country-${index}-${c}`}
                    onPress={() => {
                      setCountry(c);
                      setCountryLocal(c);
                      if (c === 'US') {
                        const curr = getSubdivision();
                        if (!curr) {
                          setSubdivision('CA');
                          setSubdivisionLocal('CA');
                        }
                      } else {
                        setSubdivision('');
                        setSubdivisionLocal('');
                      }
                      setCountryPickerVisible(false);
                    }}
                    style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                  >
                    <View style={styles.modalItemContent}>
                      <View style={styles.modalItemLeft}>
                        <Text style={[styles.modalItemText, isSelected && styles.modalItemTextSelected]}>{c}</Text>
                      </View>
                      {isSelected && <Ionicons name="checkmark" size={20} color={BLUE} />}
                    </View>
            </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
          </View>
      </Modal>

      {/* Subdivision picker modal */}
      <Modal
        visible={subPickerVisible}
        transparent
        animationType="none"
        presentationStyle="overFullScreen"
        onRequestClose={() => setSubPickerVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.5)', opacity: backdropOpacity }]}>
            <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setSubPickerVisible(false)} />
          </Animated.View>

          <Animated.View style={[styles.modalSheet, { transform: [{ translateY: sheetTranslate }] }]}>
            <View style={styles.modalHandle} />
            <ScrollView style={styles.modalScrollView} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {usSubs.map((s: string, index: number) => {
                const isSelected = s === subdivision;
                return (
                  <Pressable
                    key={`sub-${index}-${s}`}
                    onPress={() => {
                      setSubdivision(s);
                      setSubdivisionLocal(s);
                      setSubPickerVisible(false);
                    }}
                    style={[styles.modalItem, isSelected && styles.modalItemSelected]}
                  >
                    <View style={styles.modalItemContent}>
                      <View style={styles.modalItemLeft}>
                        <Text style={[styles.modalItemText, isSelected && styles.modalItemTextSelected]}>{s}</Text>
                      </View>
                      {isSelected && <Ionicons name="checkmark" size={20} color={BLUE} />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 16,
    gap: 12,
    backgroundColor: DARK_BG,
    paddingBottom: 20, // Reduced from 100 to bring region section closer
  },
  fieldGroup: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: TEXT_SECONDARY,
  },
  // Input row styles
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  currencySymbol: {
    fontSize: 32,
    fontWeight: '300',
    color: TEXT_SECONDARY,
  },
  amountInput: {
    flex: 1,
    fontSize: 32,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    padding: 0,
  },
  currencyTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BORDER,
    paddingHorizontal: 12,      
    paddingVertical: 8,        
    borderRadius: 16,
    gap: 8,                    
    minWidth: 80,              
    maxWidth: 120,             
  },
  currencyText: {
    fontSize: 14,
    fontWeight: '500',
    color: TEXT_PRIMARY,
  },
  limitsText: {
  fontSize: 12,
  color: TEXT_SECONDARY,
  marginTop: 8,
},
  // Receive styles
  receiveAmountContainer: {
    flex: 1,
    minWidth: 100,              
    height: 40,                 
    justifyContent: 'center',   
    alignItems: 'flex-start',   
  },
  receiveAmount: {
    fontSize: 32,
    fontWeight: '300',
    color: TEXT_PRIMARY,
    minWidth: 100,          
  },
  assetSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BORDER,
    paddingHorizontal: 12,    
    paddingVertical: 8,        
    borderRadius: 16,
    gap: 8,                    
    maxWidth: 140,             
  },
  assetIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 4,            
  },
  assetText: {
    fontSize: 14,              
    fontWeight: '500',
    color: TEXT_PRIMARY,
  },
  // Network row
  networkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  networkLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: TEXT_PRIMARY,
  },
  networkSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BORDER,
    paddingHorizontal: 12,     
    paddingVertical: 8,        
    borderRadius: 16,
    gap: 8,                    
    maxWidth: 180,
    position: 'relative',
    paddingRight: 28, // space for absolute chevron
  },
  networkIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginRight: 4,           
  },
  networkText: {
    fontSize: 14,             
    fontWeight: '500',
    color: TEXT_PRIMARY,
    flex: 1,
    flexShrink: 1,
    lineHeight: 20,
  },
  // Payment styles
  paymentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  paymentLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: TEXT_PRIMARY,
  },
  paymentSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BORDER,
    paddingHorizontal: 12,     
    paddingVertical: 8,        
    borderRadius: 16,
    gap: 8,                    
    maxWidth: 180,           
  },
  paymentText: {
    fontSize: 14,            
    fontWeight: '500',
    color: TEXT_PRIMARY,
  },
  applePayIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'transparent',  
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  applePayText: {
    fontSize: 14,
  },
  // Quote summary
  quoteCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },
  quoteRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  quoteLabel: {
    fontSize: 14,
    color: TEXT_SECONDARY,
  },
  quoteValue: {
    fontSize: 14,
    fontWeight: '500',
    color: TEXT_PRIMARY,
  },
  quoteTotalRow: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  quoteTotalLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  quoteTotalValue: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  quoteLoader: {
    marginRight: 8,
  },
  disclaimerCard: {
    backgroundColor: BLUE + '10', // Very light blue background
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: BLUE,
  },
  disclaimerText: {
    fontSize: 12,
    color: TEXT_SECONDARY,
    lineHeight: 16,
  },
  addressMono: {
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  
  italicNote: {
    marginTop: 4,
    fontStyle: 'italic',
  },
  
  badgeProd: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
    fontWeight: '600',
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
    color: '#2563EB',
  },
  input: {
    backgroundColor: CARD_BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,       
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '400',
  },
  inputDisabled: {
    opacity: 0.8,
  },
  helper: {
    marginTop: 6,
    fontSize: 12,
    color: TEXT_SECONDARY,
  },
  select: {
    backgroundColor: CARD_BG,     
    borderColor: BORDER,
    borderWidth: 1,              
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: Platform.select({ ios: 16, android: 14, default: 16 }),
    
    // Same focus styling as input
    shadowColor: BLUE,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    flexDirection: 'row',      
    alignItems: 'center',       
    justifyContent: 'space-between', 
  },
  selectText: {
    color: TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: '400',         
  },
  switchRow: {
    marginTop: 6,             
    paddingVertical: 8,
    paddingHorizontal: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  errorText: {
    color: "#FF6B6B",           
    fontSize: 12,
    marginTop: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 11, 13, 0.8)", 
    justifyContent: "flex-end",
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: BORDER,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  modalSheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '50%',
    width: '100%',
    minHeight: 320,
    paddingBottom: 20,
    paddingTop: 8,
  },
  modalItem: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  modalItemSelected: {
    backgroundColor: BLUE + '15', // Light blue background for selected
  },
  modalItemText: {
    fontSize: 18,
    fontWeight: '500',
    color: TEXT_PRIMARY,
    flex: 1,
  },
  modalItemTextSelected: {
    color: BLUE,
    fontWeight: '600',
  },
  modalScrollView: {},
  modalItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between', // Add this
  },
  modalItemIcon: {
    width: 32,
    height: 32,
    marginRight: 16,
    borderRadius: 16,
  },
  modalItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  modalItemMeta: {
    fontSize: 16,
    color: TEXT_SECONDARY,
    marginLeft: 8,
  },
  flagEmoji: {
    fontSize: 20,
    lineHeight: 20,
    marginRight: 12,
  },
  selectContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
    paddingRight: 0,
  },
  selectIcon: {
    width: 24,
    height: 24,
    marginRight: 12,
    borderRadius: 12,
  },
  selectTextContainer: {
    flex: 1,
    minWidth: 0,
    paddingRight: 8,
    justifyContent: 'center',
  },
  selectChevron: {
    position: 'absolute',
    right: 8,
    top: 10, // centers visually with 20px icon + 8px vertical padding
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 12,           
    padding: 16,                
    borderWidth: 1,
    borderColor: BORDER,
    
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },  
    shadowOpacity: 0.05,        
    shadowRadius: 4,            
    elevation: 2,              
  },
  cardTitle: {
    fontSize: 14,              
    fontWeight: '600',
    color: TEXT_SECONDARY,
    marginBottom: 12,          
  },
  termsContainer: {
    marginTop: 0,
    marginBottom: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: BORDER,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2, // Align with first line of text
  },
  notificationCard: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  errorCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF6B6B',
    backgroundColor: '#FF6B6B' + '08', // Very light red tint
  },
  sandboxCard: {
    borderLeftWidth: 4,
    borderLeftColor: BLUE,
    backgroundColor: BLUE + '08', // Very light blue tint
  },
  productionCard: {
    borderLeftWidth: 4,
    borderLeftColor: '#FF6B6B',
    backgroundColor: '#FF6B6B08', // Very light red tint
  },
  regionCard: {
    padding: 12,
  },
  regionLabel: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    fontWeight: '500',
  },
  regionSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: BORDER,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    gap: 8,
    maxWidth: 160,
  },
  regionSelectText: {
    fontSize: 14,
    fontWeight: '500',
    color: TEXT_PRIMARY,
  },
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  notificationTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  notificationText: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    lineHeight: 18,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    color: TEXT_SECONDARY,
    lineHeight: 20,
  },
  termsLink: {
    color: BLUE,
    textDecorationLine: 'underline',
  },
  modalItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});