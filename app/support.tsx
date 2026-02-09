/**
 * ============================================================================
 * SUPPORT SCREEN - FAILED TRANSACTION SUPPORT FLOW
 * ============================================================================
 *
 * This screen demonstrates the support flow for failed transactions using
 * simulated data that matches the Transaction Status API response format.
 *
 * PARTNER INTEGRATION NOTE:
 * In production, partners should fetch real transaction data from:
 *
 * Transaction Status API: GET /v1/buy/user/{partnerUserRef}/transactions
 * @see https://docs.cdp.coinbase.com/onramp-&-offramp/onramp-apis/transaction-status
 * @see https://docs.cdp.coinbase.com/api-reference/rest-api/onramp-offramp/get-onramp-transactions-by-id
 *
 * The dummy data below mirrors the exact response format from that API.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState, useMemo } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { FailedTransactionCard } from "../components/ui/FailedTransactionCard";
import { COLORS } from "../constants/Colors";
import { GuestCheckoutDebugInfo } from "../utils/supportEmail";
import { getRandomBytes } from "expo-crypto";

const { BLUE, DARK_BG, CARD_BG, BORDER, TEXT_PRIMARY, TEXT_SECONDARY } = COLORS;

const HEX_CHARS = "0123456789abcdef";

// Helper to generate cryptographically secure random hex characters
const getRandomHexChars = (length: number): string => {
  const bytes = getRandomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    // Map each byte to a hex digit using modulo to avoid out-of-range indices
    const idx = bytes[i] % 16;
    result += HEX_CHARS[idx];
  }
  return result;
};

// Helper to generate realistic UUIDs (version 4) using secure randomness
const generateUUID = () => {
  let uuid = "";
  // We need 36 characters total, minus 4 hyphens and 2 fixed chars = 30 random hex chars
  const randomHex = getRandomHexChars(30);
  let randomIndex = 0;

  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) {
      uuid += "-";
    } else if (i === 14) {
      uuid += "4"; // UUID version 4
    } else if (i === 19) {
      // Set the variant bits: 8, 9, a, or b
      const byte = getRandomBytes(1)[0] & 0x3f; // 6 random bits
      const variantValue = (byte % 4) + 8; // 8-11 => 8,9,a,b
      uuid += HEX_CHARS[variantValue];
    } else {
      uuid += randomHex[randomIndex++];
    }
  }
  return uuid;
};

// Helper to generate realistic hash (for appVersion, entityHash, etc.)
const generateHash = (length: number = 40) => {
  return getRandomHexChars(length);
};

// Transaction interface matching Transaction Status API response
// GET /v1/buy/user/{partnerUserRef}/transactions
interface Transaction {
  transaction_id: string;
  status: string;
  purchase_currency: string;
  purchase_network: string;
  purchase_amount: { value: string; currency: string };
  payment_total: { value: string; currency: string };
  payment_method: string;
  wallet_address: string;
  tx_hash: string;
  created_at: string;
  user_type: string;
  failure_reason?: string;
  // Simulated app ID (in production this comes from your CDP project)
  simulated_app_id: string;
}

type SimulationType = 'authenticated' | 'guest' | null;

export default function SupportScreen() {
  const router = useRouter();
  const [showFailedModal, setShowFailedModal] = useState(false);
  const [selectedSimulation, setSelectedSimulation] = useState<SimulationType>(null);


  /**
   * DUMMY DATA - Simulates Transaction Status API response
   *
   * In production, partners would fetch this data from:
   * GET /v1/buy/user/{partnerUserRef}/transactions
   *
   * @see https://docs.cdp.coinbase.com/api-reference/rest-api/onramp-offramp/get-onramp-transactions-by-id
   */
  const dummyTransactions = useMemo(() => ({
    // Authenticated user transaction (CARD payment)
    // user_type: USER_TYPE_AUTHED
    authenticated: {
      transaction_id: generateUUID(),
      status: 'ONRAMP_TRANSACTION_STATUS_FAILED',
      purchase_currency: 'USDC',
      purchase_network: 'base',
      purchase_amount: { value: '7.79', currency: 'USDC' },
      payment_total: { value: '10.00', currency: 'USD' },
      payment_method: 'CARD',
      wallet_address: '0x' + generateHash(40),
      tx_hash: '',
      created_at: new Date().toISOString(),
      user_type: 'USER_TYPE_AUTHED',
      failure_reason: 'FAILURE_REASON_BUY_FAILED',
      simulated_app_id: generateUUID(),
    } as Transaction,

    // Guest user transaction (APPLE_PAY)
    // user_type: USER_TYPE_GUEST
    guest: {
      transaction_id: generateUUID(),
      status: 'ONRAMP_TRANSACTION_STATUS_FAILED',
      purchase_currency: 'USDC',
      purchase_network: 'base',
      purchase_amount: { value: '5.00', currency: 'USDC' },
      payment_total: { value: '5.00', currency: 'USD' },
      payment_method: 'APPLE_PAY',
      wallet_address: '0x' + generateHash(40),
      tx_hash: '',
      created_at: new Date().toISOString(),
      user_type: 'USER_TYPE_GUEST',
      failure_reason: 'FAILURE_REASON_BUY_FAILED',
      simulated_app_id: generateUUID(),
    } as Transaction,
  }), []);

  // Get selected transaction based on simulation type
  const selectedTransaction = selectedSimulation
    ? dummyTransactions[selectedSimulation]
    : null;

  // Handle selecting a simulation type - shows the failed transaction modal
  const handleSelectSimulation = (type: SimulationType) => {
    setSelectedSimulation(type);
    setShowFailedModal(true);
  };

  // Get the debug info for the selected transaction (for the FailedTransactionCard)
  // Uses simulated app ID instead of real CDP project ID
  const getDebugInfoForCard = (): GuestCheckoutDebugInfo | undefined => {
    if (!selectedTransaction) return undefined;

    const isGuest = selectedTransaction.user_type === 'USER_TYPE_GUEST';

    return {
      flowType: isGuest ? 'guest' : 'authenticated',
      appId: selectedTransaction.simulated_app_id, // Use simulated app ID
      partnerName: 'Demo Partner App',
      deviceId: generateUUID(),
      guestEntityHash: generateHash(32),
      guestTransactionIdAtCreate: selectedTransaction.transaction_id,
      guestAsset: selectedTransaction.purchase_currency,
      guestNetwork: selectedTransaction.purchase_network,
      guestAmount: selectedTransaction.payment_total.value,
      guestCurrency: selectedTransaction.payment_total.currency,
      guestPaymentMethod: selectedTransaction.payment_method,
      errorMessage: selectedTransaction.failure_reason || 'FAILURE_REASON_BUY_FAILED',
      debugMessage: `Simulated ${isGuest ? 'guest' : 'authenticated'} transaction failure`,
    };
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={TEXT_PRIMARY} />
        </Pressable>
        <Text style={styles.title}>Support Demo</Text>
        <View style={styles.placeholder} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Introduction Card */}
        <View style={styles.infoCard}>
          <View style={styles.infoHeader}>
            <Ionicons name="bug" size={24} color={BLUE} />
            <Text style={styles.infoTitle}>Simulate Failed Transaction</Text>
          </View>
          <Text style={styles.infoText}>
            Select a transaction type to simulate a failed transaction.
            The debug info format matches the Transaction Status API response.
          </Text>
          <View style={styles.apiNote}>
            <Ionicons name="information-circle" size={16} color={BLUE} />
            <Text style={styles.apiNoteText}>
              Partners: Fetch real data via GET /v1/buy/user/{'{partnerUserRef}'}/transactions
            </Text>
          </View>
        </View>

        {/* Simulation Options */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Choose Transaction Type</Text>

          {/* Authenticated User (CARD) */}
          <Pressable
            style={({ pressed }) => [
              styles.simulationButton,
              pressed && styles.buttonPressed
            ]}
            onPress={() => handleSelectSimulation('authenticated')}
          >
            <View style={styles.simulationButtonContent}>
              <Ionicons
                name="card"
                size={28}
                color={TEXT_PRIMARY}
              />
              <View style={styles.simulationButtonText}>
                <Text style={styles.simulationButtonTitle}>
                  Authenticated User (CARD)
                </Text>
                <Text style={styles.simulationButtonDescription}>
                  USER_TYPE_AUTHED • CARD payment
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={TEXT_SECONDARY} />
          </Pressable>

          {/* Guest User (APPLE_PAY) */}
          <Pressable
            style={({ pressed }) => [
              styles.simulationButton,
              pressed && styles.buttonPressed
            ]}
            onPress={() => handleSelectSimulation('guest')}
          >
            <View style={styles.simulationButtonContent}>
              <Ionicons
                name="logo-apple"
                size={28}
                color={TEXT_PRIMARY}
              />
              <View style={styles.simulationButtonText}>
                <Text style={styles.simulationButtonTitle}>
                  Guest User (APPLE_PAY)
                </Text>
                <Text style={styles.simulationButtonDescription}>
                  USER_TYPE_GUEST • Apple Pay
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={20} color={TEXT_SECONDARY} />
          </Pressable>
        </View>
      </ScrollView>

      {/* Failed Transaction Modal */}
      <Modal
        visible={showFailedModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowFailedModal(false)}
      >
        <FailedTransactionCard
          title="Transaction Failed"
          message={selectedTransaction?.user_type === 'USER_TYPE_GUEST'
            ? "Your Apple Pay transaction could not be completed."
            : "Your card payment could not be processed."
          }
          debugInfo={getDebugInfoForCard()}
          errorMessage={selectedTransaction?.failure_reason || 'FAILURE_REASON_BUY_FAILED'}
          onDismiss={() => setShowFailedModal(false)}
          showDismiss={true}
        />
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: CARD_BG,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: TEXT_PRIMARY,
  },
  placeholder: {
    width: 32,
  },
  content: {
    padding: 20,
    gap: 24,
  },
  infoCard: {
    backgroundColor: BLUE + '10',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BLUE + '30',
  },
  infoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: BLUE,
  },
  infoText: {
    fontSize: 14,
    color: TEXT_SECONDARY,
    lineHeight: 20,
    marginBottom: 8,
  },
  apiNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CARD_BG,
    padding: 10,
    borderRadius: 6,
  },
  apiNoteText: {
    fontSize: 11,
    color: BLUE,
    fontFamily: 'monospace',
    flex: 1,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
  },
  buttonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  simulationButton: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  simulationButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  simulationButtonText: {
    flex: 1,
  },
  simulationButtonTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    marginBottom: 4,
  },
  simulationButtonDescription: {
    fontSize: 13,
    color: TEXT_SECONDARY,
  },
});
